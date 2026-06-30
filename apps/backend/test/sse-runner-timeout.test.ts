import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mockeamos la capa de modelo para no llamar APIs reales (mismo patron que sse-runner-outcome).
const { runModelMock } = vi.hoisted(() => ({ runModelMock: vi.fn() }));

vi.mock('../src/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/providers/index.js')>();
  return { ...actual, runModel: runModelMock };
});

import Fastify, { type FastifyInstance } from 'fastify';
import type { ProviderStreamEvent } from '@ledesma-platform/shared';
import { streamAgentRun, type AgentRunOutcome } from '../src/routes/sse-runner.js';
import type { ModelCallInput } from '../src/providers/index.js';

function streamOf(events: ProviderStreamEvent[]): AsyncIterable<ProviderStreamEvent> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

/**
 * Stream que emite un delta y luego se cuelga hasta que el AbortSignal del run se dispara. Simula un
 * proveedor colgado: sin el corte por timeout nunca terminaria. Al abortar, segun onAbort, retorna
 * limpio (el provider deja de emitir) o lanza (p.ej. un AbortError del SDK).
 */
function hangUntilAbort(
  signal: AbortSignal | undefined,
  onAbort: 'return' | 'throw',
): AsyncIterable<ProviderStreamEvent> {
  return (async function* () {
    yield { type: 'text_delta', text: 'pensando' };
    await new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    if (onAbort === 'throw') {
      throw new Error('stream abortado por signal');
    }
  })();
}

/** Parsea un cuerpo SSE en una lista de { event, data }. */
function parseSse(raw: string): Array<{ event: string; data: unknown }> {
  const blocks = raw.split('\n\n').filter((b) => b.trim() !== '');
  return blocks.map((block) => {
    const lines = block.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data = line.slice(6);
    }
    return { event, data: data === '' ? undefined : JSON.parse(data) };
  });
}

interface BuildAppOptions {
  runTimeoutMs: number;
  onRunFinished?: (outcome: AgentRunOutcome) => void;
}

async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.post('/run', (request, reply) =>
    streamAgentRun(
      request,
      reply,
      {
        providerId: 'anthropic',
        credentials: { apiKey: 'sk-test' },
        request: {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
          tools: [],
          modelConfig: { model: 'claude-sonnet-4-6', maxTokens: 256 },
        },
        runTimeoutMs: options.runTimeoutMs,
      },
      async () => ({ content: 'noop', isError: false }),
      options.onRunFinished,
    ),
  );
  return app;
}

beforeEach(() => {
  runModelMock.mockReset();
});

describe('streamAgentRun: timeout global del run', () => {
  it('al vencer el deadline corta LIMPIO con stop "timeout" + done (provider que retorna al abortar)', async () => {
    runModelMock.mockImplementation((input: ModelCallInput) => hangUntilAbort(input.signal, 'return'));
    const outcomes: AgentRunOutcome[] = [];
    const app = await buildApp({ runTimeoutMs: 25, onRunFinished: (o) => outcomes.push(o) });

    const res = await app.inject({ method: 'POST', url: '/run', payload: {} });

    expect(res.statusCode).toBe(200);
    const events = parseSse(res.payload);
    // No hay evento error: el corte por tiempo es limpio, no un fallo.
    expect(events.some((e) => e.event === 'error')).toBe(false);
    expect(events).toContainEqual({
      event: 'message',
      data: { type: 'stop', reason: 'timeout', usage: { inputTokens: 0, outputTokens: 0 } },
    });
    expect(events.at(-1)).toEqual({ event: 'done', data: {} });
    // Desenlace: cuenta como completado (cierre limpio) con stopReason timeout, no como aborted.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ status: 'completed', stopReason: 'timeout', errorCode: null });
  });

  it('al vencer el deadline corta LIMPIO aun si el provider LANZA al abortar (sin evento error)', async () => {
    runModelMock.mockImplementation((input: ModelCallInput) => hangUntilAbort(input.signal, 'throw'));
    const outcomes: AgentRunOutcome[] = [];
    const app = await buildApp({ runTimeoutMs: 25, onRunFinished: (o) => outcomes.push(o) });

    const res = await app.inject({ method: 'POST', url: '/run', payload: {} });

    expect(res.statusCode).toBe(200);
    const events = parseSse(res.payload);
    expect(events.some((e) => e.event === 'error')).toBe(false);
    expect(events.some((e) => e.event === 'message' && (e.data as { reason?: string }).reason === 'timeout')).toBe(true);
    expect(events.at(-1)).toEqual({ event: 'done', data: {} });
    expect(outcomes[0]).toMatchObject({ status: 'completed', stopReason: 'timeout', errorCode: null });
  });

  it('run que termina ANTES del timeout: cierra normal y LIMPIA el timer (sin fugas)', async () => {
    const TIMEOUT_MS = 50_000;
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      runModelMock.mockReturnValue(
        streamOf([
          { type: 'text_delta', text: 'Hola' },
          { type: 'stop', reason: 'end_turn', usage: { inputTokens: 5, outputTokens: 3 } },
        ]),
      );
      const outcomes: AgentRunOutcome[] = [];
      const app = await buildApp({ runTimeoutMs: TIMEOUT_MS, onRunFinished: (o) => outcomes.push(o) });

      const res = await app.inject({ method: 'POST', url: '/run', payload: {} });

      expect(res.statusCode).toBe(200);
      const events = parseSse(res.payload);
      // Cierre normal: stop end_turn + done, sin stop 'timeout'.
      expect(events.some((e) => e.event === 'message' && (e.data as { reason?: string }).reason === 'timeout')).toBe(false);
      expect(events.at(-1)).toEqual({ event: 'done', data: {} });
      expect(outcomes[0]).toMatchObject({ status: 'completed', stopReason: 'end_turn' });

      // El timer del deadline (delay TIMEOUT_MS) se creo y se limpio en el finally: sin fugas.
      const ourCall = setSpy.mock.calls.findIndex((args) => args[1] === TIMEOUT_MS);
      expect(ourCall).toBeGreaterThanOrEqual(0);
      const ourTimer = setSpy.mock.results[ourCall]?.value;
      expect(clearSpy).toHaveBeenCalledWith(ourTimer);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });
});
