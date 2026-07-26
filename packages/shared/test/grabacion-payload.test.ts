import { describe, it, expect } from 'vitest';
import {
  GRABAR_TAREA_JOB_KIND,
  PROMOVER_GRABACION_JOB_KIND,
  isGrabacionJobPayload,
  parseGrabacionJobPayload,
} from '../src/jobs/grabacion-payload.js';
import { isSitioJobPayload } from '../src/jobs/sitio-payload.js';
import { isTareaWebJobPayload } from '../src/jobs/tarea-web-payload.js';

/**
 * PAYLOADS de los jobs de grabacion. Dos propiedades importan: que el discriminador no se solape con
 * el de ningun otro tipo de job, y que NINGUN payload pueda llevar un dato de sesion (no existe un
 * campo donde ponerlo).
 */

describe('isGrabacionJobPayload', () => {
  it('reconoce los dos kinds propios y ninguno ajeno', () => {
    expect(isGrabacionJobPayload({ kind: GRABAR_TAREA_JOB_KIND })).toBe(true);
    expect(isGrabacionJobPayload({ kind: PROMOVER_GRABACION_JOB_KIND })).toBe(true);
    expect(isGrabacionJobPayload({ kind: 'tarea_web' })).toBe(false);
    expect(isGrabacionJobPayload({ kind: 'conectar_sitio' })).toBe(false);
    expect(isGrabacionJobPayload({ messages: [] })).toBe(false);
    expect(isGrabacionJobPayload(null)).toBe(false);
  });

  it('los discriminadores de grabacion NO son de sitio ni de tarea web (ramificacion inequivoca)', () => {
    for (const kind of [GRABAR_TAREA_JOB_KIND, PROMOVER_GRABACION_JOB_KIND]) {
      expect(isSitioJobPayload({ kind })).toBe(false);
      expect(isTareaWebJobPayload({ kind })).toBe(false);
    }
  });
});

describe('parseGrabacionJobPayload (grabar_tarea)', () => {
  it('exige conexion y grabacion', () => {
    const ok = parseGrabacionJobPayload({
      kind: GRABAR_TAREA_JOB_KIND,
      connectionId: 'con-1',
      grabacionId: 'gra-1',
    });
    expect(ok).toEqual({
      success: true,
      data: { kind: GRABAR_TAREA_JOB_KIND, connectionId: 'con-1', grabacionId: 'gra-1' },
    });
    expect(parseGrabacionJobPayload({ kind: GRABAR_TAREA_JOB_KIND, connectionId: 'con-1' }).success).toBe(false);
    expect(parseGrabacionJobPayload({ kind: GRABAR_TAREA_JOB_KIND, grabacionId: '' }).success).toBe(false);
  });

  it('descarta cualquier campo extra: al worker solo le llegan los dos ids', () => {
    const parsed = parseGrabacionJobPayload({
      kind: GRABAR_TAREA_JOB_KIND,
      connectionId: 'con-1',
      grabacionId: 'gra-1',
      password: 'hunter2',
      contexto: 'cookies',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(Object.keys(parsed.data).sort()).toEqual(['connectionId', 'grabacionId', 'kind']);
  });
});

describe('parseGrabacionJobPayload (promover_grabacion)', () => {
  it('acepta la lista de datos marcados y la normaliza cuando falta', () => {
    const conVariables = parseGrabacionJobPayload({
      kind: PROMOVER_GRABACION_JOB_KIND,
      grabacionId: 'gra-1',
      variables: [{ idx: 2, marcador: 'destinatario' }],
    });
    expect(conVariables).toEqual({
      success: true,
      data: {
        kind: PROMOVER_GRABACION_JOB_KIND,
        grabacionId: 'gra-1',
        variables: [{ idx: 2, marcador: 'destinatario' }],
      },
    });
    const sinVariables = parseGrabacionJobPayload({
      kind: PROMOVER_GRABACION_JOB_KIND,
      grabacionId: 'gra-1',
    });
    expect(sinVariables.success && sinVariables.data).toMatchObject({ variables: [] });
  });

  it('rechaza un marcador que no pertenece al vocabulario de las recetas', () => {
    const parsed = parseGrabacionJobPayload({
      kind: PROMOVER_GRABACION_JOB_KIND,
      grabacionId: 'gra-1',
      variables: [{ idx: 0, marcador: 'clave' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('el marcado NO transporta el valor: solo indice y tipo', () => {
    const parsed = parseGrabacionJobPayload({
      kind: PROMOVER_GRABACION_JOB_KIND,
      grabacionId: 'gra-1',
      variables: [{ idx: 0, marcador: 'monto', valor: '2400 MXN' }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === PROMOVER_GRABACION_JOB_KIND) {
      expect(parsed.data.variables[0]).toEqual({ idx: 0, marcador: 'monto' });
    }
  });
});

describe('kind desconocido', () => {
  it('no valida', () => {
    expect(parseGrabacionJobPayload({ kind: 'otro' }).success).toBe(false);
    expect(parseGrabacionJobPayload('x').success).toBe(false);
  });
});
