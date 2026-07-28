import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../src/lib/sse';
import { cierreTrasFalloDeStream, esErrorDeCredencialOModelo } from '../src/lib/cierre-turno';
import {
  crearSeguimientoTareasWeb,
  hayTareaWebCompletada,
  iniciarTurnoDeTareasWeb,
  registrarEventoDeTareaWeb,
  TOOL_EJECUTAR_TAREA_EN_SITIO,
  TOOL_REVISAR_TAREA_EN_SITIO,
} from '../src/lib/tarea-web-turno';

/**
 * CIERRE VERAZ DEL TURNO (caso real de produccion, 28 jul 2026): la tarea web termino con exito
 * (correo enviado), el ultimo poll devolvio 'completada', y DESPUES el stream SSE murio sin `done`.
 * El catch-all pintaba "UNKNOWN / Revisa tu key o el identificador del modelo" sobre un turno
 * exitoso. Estos tests fijan las dos reglas con las funciones reales compuestas, sin DOM.
 */

function toolUse(id: string, name: string, input: Record<string, unknown> = {}): AgentEvent {
  return { type: 'tool_use', id, name, input };
}

function toolResult(toolUseId: string, content: unknown, isError = false): AgentEvent {
  return { type: 'tool_result', toolUseId, content: JSON.stringify(content), isError };
}

describe('cierre del turno tras un fallo del stream sin done', () => {
  it('el caso de produccion: tarea completada y stream muerto -> cierre con exito, sin recuadro', () => {
    const seguimiento = crearSeguimientoTareasWeb();
    iniciarTurnoDeTareasWeb(seguimiento);
    registrarEventoDeTareaWeb(seguimiento, toolUse('t1', TOOL_EJECUTAR_TAREA_EN_SITIO, { objetivo: 'enviar un correo' }));
    registrarEventoDeTareaWeb(seguimiento, toolResult('t1', { job_id: 'job-1', estado: 'encolada' }));
    registrarEventoDeTareaWeb(seguimiento, toolUse('r1', TOOL_REVISAR_TAREA_EN_SITIO, { job_id: 'job-1' }));
    registrarEventoDeTareaWeb(seguimiento, toolResult('r1', { estado: 'completada', resultado: 'correo enviado' }));

    // Aca el stream lanza (corte de red tras el desenlace): el cierre suprime el error.
    const cierre = cierreTrasFalloDeStream(hayTareaWebCompletada(seguimiento));
    expect(cierre).toEqual({ tipo: 'exito' });
  });

  it('sin desenlace exitoso, el fallo del stream cierra con error de CONEXION, nunca de credencial', () => {
    const seguimiento = crearSeguimientoTareasWeb();
    iniciarTurnoDeTareasWeb(seguimiento);
    registrarEventoDeTareaWeb(seguimiento, toolUse('t1', TOOL_EJECUTAR_TAREA_EN_SITIO));
    registrarEventoDeTareaWeb(seguimiento, toolResult('t1', { job_id: 'job-1', estado: 'encolada' }));

    const cierre = cierreTrasFalloDeStream(hayTareaWebCompletada(seguimiento));
    expect(cierre).toEqual({ tipo: 'error', code: 'CONNECTION' });
    expect(esErrorDeCredencialOModelo(cierre.tipo === 'error' ? cierre.code : '')).toBe(false);
  });

  it('el exito de un turno ANTERIOR no suprime el error de un turno nuevo', () => {
    const seguimiento = crearSeguimientoTareasWeb();
    registrarEventoDeTareaWeb(seguimiento, toolUse('r1', TOOL_REVISAR_TAREA_EN_SITIO, { job_id: 'job-viejo' }));
    registrarEventoDeTareaWeb(seguimiento, toolUse('e0', TOOL_EJECUTAR_TAREA_EN_SITIO));
    registrarEventoDeTareaWeb(seguimiento, toolResult('e0', { job_id: 'job-viejo', estado: 'encolada' }));
    registrarEventoDeTareaWeb(seguimiento, toolUse('r2', TOOL_REVISAR_TAREA_EN_SITIO, { job_id: 'job-viejo' }));
    registrarEventoDeTareaWeb(seguimiento, toolResult('r2', { estado: 'completada' }));
    expect(hayTareaWebCompletada(seguimiento)).toBe(true);

    // Arranca un turno nuevo: los exitos del anterior dejan de contar.
    iniciarTurnoDeTareasWeb(seguimiento);
    expect(hayTareaWebCompletada(seguimiento)).toBe(false);
    expect(cierreTrasFalloDeStream(hayTareaWebCompletada(seguimiento))).toEqual({
      tipo: 'error',
      code: 'CONNECTION',
    });
  });

  it('una tarea que termino FALLIDA no cuenta como desenlace exitoso', () => {
    const seguimiento = crearSeguimientoTareasWeb();
    iniciarTurnoDeTareasWeb(seguimiento);
    registrarEventoDeTareaWeb(seguimiento, toolUse('t1', TOOL_EJECUTAR_TAREA_EN_SITIO));
    registrarEventoDeTareaWeb(seguimiento, toolResult('t1', { job_id: 'job-1', estado: 'encolada' }));
    registrarEventoDeTareaWeb(seguimiento, toolUse('r1', TOOL_REVISAR_TAREA_EN_SITIO, { job_id: 'job-1' }));
    registrarEventoDeTareaWeb(seguimiento, toolResult('r1', { estado: 'fallida', detalle: 'x' }, true));

    expect(hayTareaWebCompletada(seguimiento)).toBe(false);
    expect(cierreTrasFalloDeStream(false).tipo).toBe('error');
  });
});

describe('el copy de credencial queda reservado a los errores reales del proveedor', () => {
  it('un 401/403 real (AUTHENTICATION) y un modelo inexistente (MODEL_NOT_FOUND) SI lo muestran', () => {
    expect(esErrorDeCredencialOModelo('AUTHENTICATION')).toBe(true);
    expect(esErrorDeCredencialOModelo('MODEL_NOT_FOUND')).toBe(true);
  });

  it('los demas codigos (UNKNOWN, CONNECTION, RATE_LIMIT, TIMEOUT...) NO lo muestran', () => {
    for (const code of ['UNKNOWN', 'CONNECTION', 'RATE_LIMIT', 'TIMEOUT', 'PROVIDER_UNAVAILABLE', 'INVALID_REQUEST', '']) {
      expect(esErrorDeCredencialOModelo(code)).toBe(false);
    }
  });
});
