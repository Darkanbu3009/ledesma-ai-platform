import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks hoisteados para poder reconfigurar el cliente supabase por test.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  from: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    storage: { from: mocks.from },
  },
}));

import { subirAdjunto } from '../src/lib/attachments';

const USER_ID = '11111111-2222-3333-4444-555555555555';

/** Crea un File con un `size` controlable sin tener que reservar los bytes. */
function archivo(name: string, type: string, size = 1024): File {
  const file = new File(['contenido'], name, { type });
  if (file.size !== size) {
    Object.defineProperty(file, 'size', { value: size, configurable: true });
  }
  return file;
}

beforeEach(() => {
  mocks.getSession
    .mockReset()
    .mockResolvedValue({ data: { session: { user: { id: USER_ID } } } });
  mocks.from.mockReset().mockReturnValue({
    upload: mocks.upload,
    createSignedUrl: mocks.createSignedUrl,
  });
  mocks.upload
    .mockReset()
    .mockResolvedValue({ data: { path: 'ok' }, error: null });
  mocks.createSignedUrl
    .mockReset()
    .mockResolvedValue({ data: { signedUrl: 'https://signed.test/url' }, error: null });
});

describe('subirAdjunto validaciones', () => {
  it.each(['text/plain', 'video/mp4', ''])(
    'rechaza el tipo no permitido %s con error claro',
    async (tipo) => {
      await expect(subirAdjunto(archivo('x.bin', tipo))).rejects.toThrow(/no permitido/i);
      expect(mocks.upload).not.toHaveBeenCalled();
    },
  );

  it('rechaza archivos mayores a 10 MB con error claro', async () => {
    const grande = archivo('foto.png', 'image/png', 10 * 1024 * 1024 + 1);
    await expect(subirAdjunto(grande)).rejects.toThrow('El archivo supera el limite de 10 MB');
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('acepta exactamente 10 MB (no excede el limite)', async () => {
    const justo = archivo('foto.png', 'image/png', 10 * 1024 * 1024);
    await expect(subirAdjunto(justo)).resolves.toMatchObject({ kind: 'image' });
  });

  it('sin sesion lanza error claro y no sube nada', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    await expect(subirAdjunto(archivo('foto.png', 'image/png'))).rejects.toThrow(
      'Debes iniciar sesion para adjuntar archivos',
    );
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});

describe('subirAdjunto mapeo de kind', () => {
  it.each([
    ['image/png', 'image'],
    ['image/jpeg', 'image'],
    ['image/webp', 'image'],
    ['application/pdf', 'pdf'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'excel'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'word'],
  ])('mapea %s -> %s', async (mime, kind) => {
    const ref = await subirAdjunto(archivo('archivo', mime));
    expect(ref.kind).toBe(kind);
    expect(ref.mimeType).toBe(mime);
  });
});

describe('subirAdjunto path y RLS', () => {
  it('usa el userId como primera carpeta del path y sanitiza el nombre', async () => {
    await subirAdjunto(archivo('Mi Reporte Final (v2).pdf', 'application/pdf'));

    const path = mocks.upload.mock.calls[0]?.[0] as string;
    const partes = path.split('/');

    // El userId DEBE ser la primera carpeta o la RLS rechaza la subida.
    expect(partes[0]).toBe(USER_ID);
    expect(partes).toHaveLength(2);
    expect(path.startsWith(`${USER_ID}/`)).toBe(true);

    // Nombre sanitizado: sin espacios, sin parentesis, conservando la extension.
    expect(path).toMatch(/-mi-reporte-final-v2\.pdf$/);
    expect(path).not.toMatch(/\s/);
    expect(path).not.toMatch(/[()]/);
  });

  it('createSignedUrl recibe el mismo path que upload', async () => {
    await subirAdjunto(archivo('doc.pdf', 'application/pdf'));
    const pathSubido = mocks.upload.mock.calls[0]?.[0];
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(pathSubido, 600);
  });
});

describe('subirAdjunto subida y retorno', () => {
  it('sube con upsert true y contentType, y devuelve { kind, url, mimeType, name }', async () => {
    const file = archivo('grafico.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const ref = await subirAdjunto(file);

    expect(mocks.from).toHaveBeenCalledWith('adjuntos-chat');
    expect(mocks.upload).toHaveBeenCalledWith(expect.any(String), file, {
      upsert: true,
      contentType: file.type,
    });

    expect(ref).toEqual({
      kind: 'excel',
      url: 'https://signed.test/url',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name: 'grafico.xlsx',
    });
  });

  it('propaga error claro cuando falla la subida', async () => {
    mocks.upload.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(subirAdjunto(archivo('foto.png', 'image/png'))).rejects.toThrow(
      /No se pudo subir el archivo: boom/,
    );
  });

  it('propaga error claro cuando falla la signed url', async () => {
    mocks.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'nope' } });
    await expect(subirAdjunto(archivo('foto.png', 'image/png'))).rejects.toThrow(
      /No se pudo generar el enlace del archivo: nope/,
    );
  });
});
