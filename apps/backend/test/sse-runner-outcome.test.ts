import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mockeamos la capa de modelo para no llamar APIs reales: el helper usa runModel internamente
// a traves de runAgent. Interceptamos en el punto de la capa de modelo (patron existente).
const { runModelMock } = vi.hoisted(() => ({ runModelMock: vi.fn() }));

vi.mock('../src/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/providers/index.js')>();
  return { ...actual, runModel: runModelMock };
});

import Fastify, { type FastifyInstance } from 'fastify';
import type { ProviderStreamEvent } from '@ledesma-platform/shared';
import { streamAgentRun, type AgentRunOutcome } from '../src/routes/sse-runner.js';
import { ProviderError } from '../src/providers/errors.js';

function streamOf(events: ProviderStreamEvent[]): AsyncIterable<ProviderStreamEvent> {
  return (async function* () {
    for (const event of events) {
      yield event;
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

/** App minima que monta streamAgentRun con (o sin) onRunFinished, como hacen las rutas reales. */
async function buildApp(onRunFinished?: (outcome: AgentRunOutcome) => void): Promise<FastifyInstance> {
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
      },
      async () => ({ content: 'noop', isError: false }),
      onRunFinished,
    ),
  );
  return app;
}

beforeEach(() => {
  runModelMock.mockReset();
});

describe('streamAgentRun: reporte del desenlace via onRunFinished', () => {
  it('corrida exitosa reporta completed con usage, stopReason y duracion', async () => {
    runModelMock.mockReturnValue(
      streamOf([
        { type: 'text_delta', text: 'Hola' },
        { type: 'stop', reason: 'end_turn', usage: { inputTokens: 5, outputTokens: 3 } },
      ]),
    );
    const outcomes: AgentRunOutcome[] = [];
    const app = await buildApp((o) => outcomes.push(o));

    const res = await app.inject({ method: 'POST', url: '/run', payload: {} });

    expect(res.statusCode).toBe(200);
    expect(parseSse(res.payload).at(-1)).toEqual({ event: 'done', data: {} });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      status: 'completed',
      inputTokens: 5,
      outputTokens: 3,
      stopReason: 'end_turn',
      errorCode: null,
    });
    expect(outcomes[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('ProviderError del modelo reporta status error con el codigo', async () => {
    runModelMock.mockReturnValue(
      // Stream que falla al primer next(): simula un error del proveedor durante la iteracion.
      // eslint-disable-next-line require-yield -- el generador solo lanza, no emite eventos
      (async function* (): AsyncIterable<ProviderStreamEvent> {
        throw new ProviderError({ code: 'AUTHENTICATION', providerId: 'anthropic', message: 'invalid key', status: 401 });
      })(),
    );
    const outcomes: AgentRunOutcome[] = [];
    const app = await buildApp((o) => outcomes.push(o));

    const res = await app.inject({ method: 'POST', url: '/run', payload: {} });

    expect(res.statusCode).toBe(200); // SSE ya abierto
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      status: 'error',
      errorCode: 'AUTHENTICATION',
      inputTokens: 0,
      outputTokens: 0,
      stopReason: null,
    });
  });

  it('si onRunFinished lanza, el stream cierra normal igualmente', async () => {
    runModelMock.mockReturnValue(
      streamOf([
        { type: 'text_delta', text: 'Hola' },
        { type: 'stop', reason: 'end_turn', usage: { inputTokens: 5, outputTokens: 3 } },
      ]),
    );
    const app = await buildApp(() => {
      throw new Error('el registro exploto');
    });

    const res = await app.inject({ method: 'POST', url: '/run', payload: {} });

    expect(res.statusCode).toBe(200);
    const events = parseSse(res.payload);
    expect(events.some((e) => e.event === 'error')).toBe(false);
    expect(events.at(-1)).toEqual({ event: 'done', data: {} });
  });

  it('sin onRunFinished el flujo SSE es identico al actual', async () => {
    runModelMock.mockReturnValue(
      streamOf([
        { type: 'text_delta', text: 'Hola' },
        { type: 'stop', reason: 'end_turn', usage: { inputTokens: 5, outputTokens: 3 } },
      ]),
    );
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: '/run', payload: {} });

    expect(res.statusCode).toBe(200);
    const events = parseSse(res.payload);
    expect(events).toContainEqual({ event: 'message', data: { type: 'text_delta', text: 'Hola' } });
    expect(events).toContainEqual({
      event: 'message',
      data: { type: 'stop', reason: 'end_turn', usage: { inputTokens: 5, outputTokens: 3 } },
    });
    expect(events.at(-1)).toEqual({ event: 'done', data: {} });
  });
});
