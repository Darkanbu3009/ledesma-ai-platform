import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '../src/lib/sse';
import {
  crearSeguimientoTareasWeb,
  hayTareaWebViva,
  registrarEventoDeTareaWeb,
  TOOL_EJECUTAR_TAREA_EN_SITIO,
  TOOL_REVISAR_TAREA_EN_SITIO,
} from '../src/lib/tarea-web-turno';

// runAgentStream importa getAccessToken de api.ts (que importa supabase/env): se aislan igual que en
// los otros tests; el modo 'paste' no toca la sesion.
vi.mock('../src/lib/api', () => ({ getAccessToken: vi.fn() }));
vi.mock('../src/lib/env', () => ({ readApiEnv: () => ({ apiUrl: 'http://api.test' }) }));
import { PLAYGROUND_MAX_ITERATIONS, runAgentStream } from '../src/lib/run-agent';

function toolUse(id: string, name: string, input: Record<string, unknown> = {}): AgentEvent {
  return { type: 'tool_use', id, name, input };
}

function toolResult(toolUseId: string, content: unknown, isError = false): AgentEvent {
  return { type: 'tool_result', toolUseId, content: JSON.stringify(content), isError };
}

describe('seguimiento de tareas web vivas (corte veraz por limite de iteraciones)', () => {
  it('el caso de produccion: encolada + revisar en_proceso agotando iteraciones -> la tarea sigue VIVA', () => {
    const seguimiento = crearSeguimientoTareasWeb();
    registrarEventoDeTareaWeb(seguimiento, toolUse('t1', TOOL_EJECUTAR_TAREA_EN_SITIO, { objetivo: 'x' }));
    registrarEventoDeTareaWeb(seguimiento, toolResult('t1', { job_id: 'job-1', estado: 'encolada' }));
    expect(hayTareaWebViva(seguimiento)).toBe(true);

    // El agente quema sus iteraciones consultando y siempre recibe en_proceso: sigue viva.
    for (let i = 0; i < 3; i++) {
      registrarEventoDeTareaWeb(seguimiento, toolUse(`r${i}`, TOOL_REVISAR_TAREA_EN_SITIO, { job_id: 'job-1' }));
      registrarEventoDeTareaWeb(seguimiento, toolResult(`r${i}`, { estado: 'en_proceso' }));
    }
    expect(hayTareaWebViva(seguimiento)).toBe(true);
  });

  it('revisar con estado completada la da por terminada', () => {
    const seguimiento = crearSeguimientoTareasWeb();
    registrarEventoDeTareaWeb(seguimiento, toolUse('t1', TOOL_EJECUTAR_TAREA_EN_SITIO));
    registrarEventoDeTareaWeb(seguimiento, toolResult('t1', { job_id: 'job-1', estado: 'encolada' }));
    registrarEventoDeTareaWeb(seguimiento, toolUse('r1', TOOL_REVISAR_TAREA_EN_SITIO, { job_id: 'job-1' }));
    registrarEventoDeTareaWeb(seguimiento, toolResult('r1', { estado: 'completada', resultado: 'ok' }));
    expect(hayTareaWebViva(seguimiento)).toBe(false);
  });

  it('revisar con isError (fallida) tambien la da por terminada', () => {
    const seguimiento = crearSeguimientoTareasWeb();
    registrarEventoDeTareaWeb(seguimiento, toolUse('t1', TOOL_EJECUTAR_TAREA_EN_SITIO));
    registrarEventoDeTareaWeb(seguimiento, toolResult('t1', { job_id: 'job-1', estado: 'encolada' }));
    registrarEventoDeTareaWeb(seguimiento, toolUse('r1', TOOL_REVISAR_TAREA_EN_SITIO, { job_id: 'job-1' }));
    registrarEventoDeTareaWeb(seguimiento, toolResult('r1', { estado: 'fallida', detalle: 'x' }, true));
    expect(hayTareaWebViva(seguimiento)).toBe(false);
  });

  it('una tarea encolada en un turno ANTERIOR revive por un revisar en_proceso de este turno', () => {
    const seguimiento = crearSeguimientoTareasWeb();
    registrarEventoDeTareaWeb(seguimiento, toolUse('r1', TOOL_REVISAR_TAREA_EN_SITIO, { job_id: 'job-previo' }));
    registrarEventoDeTareaWeb(seguimiento, toolResult('r1', { estado: 'en_proceso' }));
    expect(hayTareaWebViva(seguimiento)).toBe(true);
  });

  it('un ejecutar con error no deja nada vivo; otras tools y contenido no JSON se ignoran', () => {
    const seguimiento = crearSeguimientoTareasWeb();
    registrarEventoDeTareaWeb(seguimiento, toolUse('t1', TOOL_EJECUTAR_TAREA_EN_SITIO));
    registrarEventoDeTareaWeb(seguimiento, {
      type: 'tool_result',
      toolUseId: 't1',
      content: 'La tarea anterior en este sitio fallo de forma permanente',
      isError: true,
    });
    registrarEventoDeTareaWeb(seguimiento, toolUse('otra', 'platform_listar_sitios_conectados'));
    registrarEventoDeTareaWeb(seguimiento, toolResult('otra', { sitios: [] }));
    expect(hayTareaWebViva(seguimiento)).toBe(false);
  });
});

describe('runAgentStream: la palanca elegida (iteraciones del Playground al cap del backend)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('el body de /v1/run/:agentId viaja con maxIterations = PLAYGROUND_MAX_ITERATIONS', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const onMessage = vi.fn();
    await runAgentStream({
      agentId: 'a1',
      credential: { mode: 'paste', apiKey: 'k' },
      messages: [{ role: 'user', content: 'hola' }],
      signal: new AbortController().signal,
      onMessage,
    });
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as {
      maxIterations?: number;
    };
    expect(body.maxIterations).toBe(PLAYGROUND_MAX_ITERATIONS);
    // El cap del contrato publico del backend (AGENT_LIMITS.maxIterationsCap) es 20: no pedir mas.
    expect(PLAYGROUND_MAX_ITERATIONS).toBeLessThanOrEqual(20);
  });
});
