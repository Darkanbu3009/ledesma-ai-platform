import { describe, expect, it, vi } from 'vitest';

// Mock del modulo de subida para verificar que `subirArchivos` usa subirAdjunto por defecto.
const mocks = vi.hoisted(() => ({ subirAdjunto: vi.fn() }));
vi.mock('../src/lib/attachments', () => ({ subirAdjunto: mocks.subirAdjunto }));

import {
  MAX_ADJUNTOS,
  TEXTO_SOLO_ADJUNTOS,
  planificarEnvio,
  subirArchivos,
} from '../src/lib/attachment-upload';
import type { AttachmentRef } from '../src/lib/attachments';

function ref(name: string, kind: AttachmentRef['kind'] = 'pdf'): AttachmentRef {
  return { kind, url: `https://signed.test/${name}`, mimeType: 'application/pdf', name };
}

/** File de juguete; el contenido no importa porque `subir` esta mockeado. */
function archivo(name: string): File {
  return new File(['x'], name, { type: 'application/pdf' });
}

describe('subirArchivos', () => {
  it('por cada archivo seleccionado invoca subir y entrega la ref por onSubido', async () => {
    const subir = vi.fn(async (file: File) => ref(file.name));
    const subidos: AttachmentRef[] = [];
    const errores: string[] = [];

    await subirArchivos([archivo('a.pdf'), archivo('b.pdf')], 0, {
      subir,
      onSubido: (r) => subidos.push(r),
      onError: (m) => errores.push(m),
    });

    expect(subir).toHaveBeenCalledTimes(2);
    expect(subidos.map((r) => r.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(errores).toEqual([]);
  });

  it('un error de subida NO agrega el adjunto y reporta el mensaje', async () => {
    const subir = vi.fn(async (file: File) => {
      if (file.name === 'malo.pdf') throw new Error('No se pudo subir el archivo: boom');
      return ref(file.name);
    });
    const subidos: AttachmentRef[] = [];
    const errores: string[] = [];

    await subirArchivos([archivo('malo.pdf'), archivo('bueno.pdf')], 0, {
      subir,
      onSubido: (r) => subidos.push(r),
      onError: (m) => errores.push(m),
    });

    // El que fallo no entra; el otro si.
    expect(subidos.map((r) => r.name)).toEqual(['bueno.pdf']);
    expect(errores).toEqual(['No se pudo subir el archivo: boom']);
  });

  it('respeta el maximo: sube solo los cupos libres y avisa del exceso', async () => {
    const subir = vi.fn(async (file: File) => ref(file.name));
    const subidos: AttachmentRef[] = [];
    const errores: string[] = [];

    // Ya hay 4 cargados (cupo libre = 1) y se eligen 3 -> solo 1 sube, el resto se descarta con aviso.
    await subirArchivos([archivo('1.pdf'), archivo('2.pdf'), archivo('3.pdf')], 4, {
      subir,
      onSubido: (r) => subidos.push(r),
      onError: (m) => errores.push(m),
    });

    expect(subir).toHaveBeenCalledTimes(1);
    expect(subidos.map((r) => r.name)).toEqual(['1.pdf']);
    expect(errores).toEqual([`Solo puedes adjuntar hasta ${MAX_ADJUNTOS} archivos por mensaje`]);
  });

  it('por defecto (sin inyectar subir) usa subirAdjunto del modulo de adjuntos', async () => {
    mocks.subirAdjunto.mockReset().mockResolvedValue(ref('default.pdf'));
    const subidos: AttachmentRef[] = [];

    await subirArchivos([archivo('default.pdf')], 0, {
      onSubido: (r) => subidos.push(r),
      onError: () => {},
    });

    expect(mocks.subirAdjunto).toHaveBeenCalledTimes(1);
    expect(subidos.map((r) => r.name)).toEqual(['default.pdf']);
  });

  it('si no quedan cupos no sube nada y avisa', async () => {
    const subir = vi.fn(async (file: File) => ref(file.name));
    const errores: string[] = [];

    await subirArchivos([archivo('1.pdf')], MAX_ADJUNTOS, {
      subir,
      onSubido: () => {},
      onError: (m) => errores.push(m),
    });

    expect(subir).not.toHaveBeenCalled();
    expect(errores).toHaveLength(1);
  });
});

describe('planificarEnvio', () => {
  it('solo-texto: envia el texto recortado y sin adjuntos', () => {
    const plan = planificarEnvio({ draft: '  hola  ', adjuntos: [] });
    expect(plan?.envio).toEqual({ texto: 'hola', attachments: [] });
  });

  it('texto + adjuntos: conserva ambos', () => {
    const adjuntos = [ref('factura.pdf')];
    const plan = planificarEnvio({ draft: 'mira esto', adjuntos });
    expect(plan?.envio).toEqual({ texto: 'mira esto', attachments: adjuntos });
  });

  it('adjuntos solos: usa el texto por defecto', () => {
    const adjuntos = [ref('logo.png', 'image')];
    const plan = planificarEnvio({ draft: '   ', adjuntos });
    expect(plan?.envio.texto).toBe(TEXTO_SOLO_ADJUNTOS);
    expect(plan?.envio.attachments).toEqual(adjuntos);
  });

  it('sin texto y sin adjuntos: no hay nada que enviar (null)', () => {
    expect(planificarEnvio({ draft: '   ', adjuntos: [] })).toBeNull();
  });

  it('enviar limpia los adjuntos pendientes (estado siguiente vacio)', () => {
    const plan = planificarEnvio({ draft: 'hola', adjuntos: [ref('a.pdf'), ref('b.pdf')] });
    expect(plan?.siguiente).toEqual({ draft: '', adjuntos: [] });
  });
});
