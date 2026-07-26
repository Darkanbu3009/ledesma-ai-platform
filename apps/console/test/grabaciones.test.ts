import { describe, it, expect } from 'vitest';
import {
  TIPOS_DE_DATO,
  grabacionEnCurso,
  pasosConDatos,
  variablesDesdeMarcado,
  type Grabacion,
} from '../src/lib/grabaciones';

/**
 * Logica PURA de la grabacion en la consola. Lo que importa: que solo se le pidan al usuario los pasos
 * en los que escribio un dato, y que lo que se manda al servidor al guardar sean indices y tipos, nunca
 * el valor que escribio.
 */

function makeGrabacion(overrides: Partial<Grabacion> = {}): Grabacion {
  return {
    id: 'gra-1',
    connectionId: 'con-1',
    dominio: 'correo.ejemplo.com',
    descripcion: 'mandar el reporte semanal',
    estado: 'terminada',
    motivo: null,
    vistaEnVivoUrl: null,
    pasos: [
      { idx: 0, accion: 'navegar', valor: null },
      { idx: 1, accion: 'escribir', valor: 'ana@ejemplo.com' },
      { idx: 2, accion: 'click', valor: null },
      { idx: 3, accion: 'escribir', valor: 'Reporte semanal' },
      { idx: 4, accion: 'teclas', valor: null },
    ],
    creadaEn: '2026-07-24T00:00:00.000Z',
    actualizadaEn: '2026-07-24T00:05:00.000Z',
    ...overrides,
  };
}

describe('pasosConDatos', () => {
  it('solo devuelve los pasos en los que el usuario escribio algo', () => {
    expect(pasosConDatos(makeGrabacion()).map((p) => p.idx)).toEqual([1, 3]);
  });

  it('sin grabacion devuelve lista vacia (nada que revisar)', () => {
    expect(pasosConDatos(undefined)).toEqual([]);
  });
});

describe('grabacionEnCurso', () => {
  it('sigue en curso mientras esta grabando o mientras no llego todavia', () => {
    expect(grabacionEnCurso(undefined)).toBe(true);
    expect(grabacionEnCurso(makeGrabacion({ estado: 'grabando' }))).toBe(true);
  });

  it('deja de estarlo al terminar o al descartarse (el polling se apaga solo)', () => {
    expect(grabacionEnCurso(makeGrabacion({ estado: 'terminada' }))).toBe(false);
    expect(
      grabacionEnCurso(makeGrabacion({ estado: 'descartada', motivo: 'contrasena' })),
    ).toBe(false);
  });
});

describe('variablesDesdeMarcado', () => {
  it('manda solo indice y tipo, ordenados, y omite lo que quedo sin marcar', () => {
    expect(variablesDesdeMarcado({ 3: 'asunto', 1: 'destinatario', 5: undefined })).toEqual([
      { idx: 1, marcador: 'destinatario' },
      { idx: 3, marcador: 'asunto' },
    ]);
  });

  it('sin nada marcado no manda ninguna variable (todo es texto fijo)', () => {
    expect(variablesDesdeMarcado({})).toEqual([]);
  });

  it('el valor que el usuario escribio NUNCA vuelve al servidor', () => {
    const cuerpo = JSON.stringify(variablesDesdeMarcado({ 1: 'destinatario' }));
    expect(cuerpo).not.toContain('ana@ejemplo.com');
  });
});

describe('TIPOS_DE_DATO', () => {
  it('son exactamente los seis del contrato de recetas (si no, la sustitucion no encontraria el dato)', () => {
    expect([...TIPOS_DE_DATO]).toEqual([
      'destinatario',
      'asunto',
      'cuerpo',
      'monto',
      'producto',
      'cantidad',
    ]);
  });
});
