import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mockeamos los parsers de PDF y Word (binarios/builds pesados) para testear el dispatch y el
// manejo de errores con texto controlado. El de Excel (xlsx) se usa REAL: generamos un workbook
// en memoria y verificamos la extraccion de punta a punta.
const { extractTextMock, extractRawTextMock } = vi.hoisted(() => ({
  extractTextMock: vi.fn(),
  extractRawTextMock: vi.fn(),
}));

vi.mock('unpdf', () => ({ extractText: extractTextMock }));
vi.mock('mammoth', () => ({
  default: { extractRawText: extractRawTextMock },
  extractRawText: extractRawTextMock,
}));

import * as XLSX from 'xlsx';
import {
  extractDocumentText,
  truncateText,
  AttachmentExtractionError,
} from '../src/attachments/extract.js';

/** fetch falso que entrega un buffer como Response minima (ok/status/headers/arrayBuffer). */
function fetchReturning(
  buffer: Buffer | Uint8Array,
  init?: { ok?: boolean; status?: number; contentLength?: string | null },
): typeof fetch {
  const copy = Uint8Array.from(buffer);
  return vi.fn(async () => ({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers: {
      get: (key: string) =>
        key.toLowerCase() === 'content-length' ? (init?.contentLength ?? null) : null,
    },
    arrayBuffer: async () => copy.buffer,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  extractTextMock.mockReset();
  extractRawTextMock.mockReset();
});

describe('extractDocumentText', () => {
  it('PDF: descarga y devuelve el texto extraido por unpdf', async () => {
    extractTextMock.mockResolvedValue({ totalPages: 2, text: 'TEXTO DEL PDF' });

    const out = await extractDocumentText(
      { kind: 'pdf', url: 'https://cdn.example.com/f.pdf', mimeType: 'application/pdf', name: 'f.pdf' },
      { fetchImpl: fetchReturning(Buffer.from('%PDF-1.4 contenido falso')) },
    );

    expect(out).toBe('TEXTO DEL PDF');
    expect(extractTextMock).toHaveBeenCalledTimes(1);
  });

  it('Excel: lee las hojas reales y las serializa a CSV legible', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nombre', 'Precio'],
      ['Pieza A', 100],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const out = await extractDocumentText(
      {
        kind: 'excel',
        url: 'https://cdn.example.com/f.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        name: 'f.xlsx',
      },
      { fetchImpl: fetchReturning(buf) },
    );

    expect(out).toContain('# Hoja: Inventario');
    expect(out).toContain('Nombre,Precio');
    expect(out).toContain('Pieza A,100');
  });

  it('Word: descarga y devuelve el texto plano de mammoth', async () => {
    extractRawTextMock.mockResolvedValue({ value: 'TEXTO DEL WORD', messages: [] });

    const out = await extractDocumentText(
      {
        kind: 'word',
        url: 'https://cdn.example.com/f.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        name: 'f.docx',
      },
      { fetchImpl: fetchReturning(Buffer.from('PK contenido falso')) },
    );

    expect(out).toBe('TEXTO DEL WORD');
    expect(extractRawTextMock).toHaveBeenCalledTimes(1);
  });

  it('tipo no soportado: lanza AttachmentExtractionError con mensaje claro (sin crashear)', async () => {
    await expect(
      extractDocumentText(
        // kind invalido a proposito (el endpoint lo valida con Zod; esto es defensa del modulo).
        { kind: 'csv' as never, url: 'https://cdn.example.com/f.csv', mimeType: 'text/csv', name: 'f.csv' },
        { fetchImpl: fetchReturning(Buffer.from('a,b,c')) },
      ),
    ).rejects.toMatchObject({
      name: 'AttachmentExtractionError',
      message: expect.stringContaining('no soportado'),
    });
  });

  it('archivo corrupto: el fallo del parser se traduce a un error claro (sin crashear)', async () => {
    extractTextMock.mockRejectedValue(new Error('Invalid PDF structure'));

    const promise = extractDocumentText(
      { kind: 'pdf', url: 'https://cdn.example.com/roto.pdf', mimeType: 'application/pdf', name: 'roto.pdf' },
      { fetchImpl: fetchReturning(Buffer.from('no es un pdf')) },
    );

    await expect(promise).rejects.toBeInstanceOf(AttachmentExtractionError);
    await expect(promise).rejects.toThrow(/corrupto/);
  });

  it('descarga fallida: HTTP no-ok lanza error claro', async () => {
    await expect(
      extractDocumentText(
        { kind: 'pdf', url: 'https://cdn.example.com/404.pdf', mimeType: 'application/pdf', name: '404.pdf' },
        { fetchImpl: fetchReturning(Buffer.from('x'), { ok: false, status: 404 }) },
      ),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('rechaza un adjunto cuyo content-length declarado supera el maximo', async () => {
    await expect(
      extractDocumentText(
        { kind: 'pdf', url: 'https://cdn.example.com/enorme.pdf', mimeType: 'application/pdf', name: 'enorme.pdf' },
        { fetchImpl: fetchReturning(Buffer.from('x'), { contentLength: String(21 * 1024 * 1024) }) },
      ),
    ).rejects.toThrow(/tamano maximo/);
  });

  it('traduce un AbortError de la descarga a un error de tiempo limite', async () => {
    const abortingFetch = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as unknown as typeof fetch;

    await expect(
      extractDocumentText(
        { kind: 'pdf', url: 'https://cdn.example.com/lento.pdf', mimeType: 'application/pdf', name: 'lento.pdf' },
        { fetchImpl: abortingFetch },
      ),
    ).rejects.toThrow(/tiempo limite/);
  });

  it('trunca el texto extraido cuando excede maxChars y deja la marca', async () => {
    extractTextMock.mockResolvedValue({ totalPages: 1, text: 'A'.repeat(500) });

    const out = await extractDocumentText(
      { kind: 'pdf', url: 'https://cdn.example.com/largo.pdf', mimeType: 'application/pdf', name: 'largo.pdf' },
      { fetchImpl: fetchReturning(Buffer.from('%PDF')), maxChars: 50 },
    );

    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith('[contenido truncado]')).toBe(true);
  });
});

describe('truncateText', () => {
  it('no toca textos dentro del limite', () => {
    expect(truncateText('hola', 100)).toBe('hola');
  });

  it('recorta y agrega la marca cuando excede', () => {
    const out = truncateText('B'.repeat(100), 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith('[contenido truncado]')).toBe(true);
  });

  it('garantia dura: nunca excede maxChars aunque sea menor que la marca o <= 0', () => {
    // maxChars menor que la marca de truncado (22 chars): recorte duro, sin desbordar el limite.
    expect(truncateText('Z'.repeat(100), 10).length).toBeLessThanOrEqual(10);
    expect(truncateText('Z'.repeat(100), 5).length).toBe(5);
    // maxChars <= 0: cadena vacia.
    expect(truncateText('Z'.repeat(100), 0)).toBe('');
    expect(truncateText('Z'.repeat(100), -3)).toBe('');
  });
});
