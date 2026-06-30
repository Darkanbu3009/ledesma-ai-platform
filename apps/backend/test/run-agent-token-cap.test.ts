import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { FakeProvider } from '@ledesma-platform/shared';
import type { AgentEvent, NormalizedRequest, ProviderStreamEvent } from '@ledesma-platform/shared';
import { runAgent, DEFAULT_RUN_MAX_TOKENS, type ToolExecutor } from '../src/agent/index.js';
import type { ModelCallInput } from '../src/providers/index.js';

// Cap de tokens ACUMULADOS por run (RUN_MAX_TOKENS). Verifica que el corte se evalua ENTRE
// iteraciones sobre el uso acumulado a traves de los turnos, corta limpio con stop reason
// 'token_cap' (analogo a max_iterations) y respeta el default cuando no se pasa maxTokens.

const baseRequest: NormalizedRequest = {
  messages: [{ role: 'user', content: [{ type: 'text', text: 'cotiza' }] }],
  tools: [{ name: 'cotizar', description: 'd', inputSchema: { type: 'object' } }],
  modelConfig: { model: 'm', maxTokens: 256 },
};

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

function fakeRunModel(fake: FakeProvider): (input: ModelCallInput) => AsyncIterable<ProviderStreamEvent> {
  return (input: ModelCallInput) =>
    fake.stream({ credentials: input.credentials, request: input.request, signal: input.signal });
}

let executeTool: Mock<ToolExecutor>;

beforeEach(() => {
  executeTool = vi.fn<ToolExecutor>(async () => ({ content: 'ok', isError: false }));
});

describe('runAgent: cap de tokens acumulados (token_cap)', () => {
  it('corta con token_cap cuando el uso ACUMULADO a traves de iteraciones supera el cap', async () => {
    // maxTokens=100. Turno 1 acumula 50 (<100, sigue), turno 2 lo lleva a 110 (>=100, corta). El
    // corte no depende de un solo turno: ningun turno individual supera 100, la SUMA si.
    const fake = new FakeProvider([
      [
        { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: {} },
        { type: 'stop', reason: 'tool_use', usage: { inputTokens: 30, outputTokens: 20 } },
      ],
      [
        { type: 'tool_use', id: 'tu_2', name: 'cotizar', input: {} },
        { type: 'stop', reason: 'tool_use', usage: { inputTokens: 30, outputTokens: 30 } },
      ],
    ]);

    const events = await collect(
      runAgent(
        { providerId: 'anthropic', credentials: { apiKey: 'sk' }, request: baseRequest, maxTokens: 100 },
        { executeTool, runModel: fakeRunModel(fake) },
      ),
    );

    expect(events.at(-1)).toEqual({
      type: 'stop',
      reason: 'token_cap',
      usage: { inputTokens: 60, outputTokens: 50 },
    });
    // Se llamo al modelo 2 veces; la tool del turno 1 se ejecuto, la del turno 2 (excedente) NO.
    expect(fake.calls).toHaveLength(2);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('corta al cierre de la iteracion ya excedida sin ejecutar la ronda de tools pedida', async () => {
    // Un solo turno ya supera el cap: se corta limpio sin ejecutar las tools que ese turno pidio.
    const fake = new FakeProvider([
      [
        { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: {} },
        { type: 'stop', reason: 'tool_use', usage: { inputTokens: 80, outputTokens: 40 } },
      ],
    ]);

    const events = await collect(
      runAgent(
        { providerId: 'anthropic', credentials: { apiKey: 'sk' }, request: baseRequest, maxTokens: 100 },
        { executeTool, runModel: fakeRunModel(fake) },
      ),
    );

    expect(events.at(-1)).toEqual({
      type: 'stop',
      reason: 'token_cap',
      usage: { inputTokens: 80, outputTokens: 40 },
    });
    expect(fake.calls).toHaveLength(1);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('por debajo del cap el run termina normal (stop natural, no token_cap)', async () => {
    const fake = new FakeProvider([
      [
        { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: {} },
        { type: 'stop', reason: 'tool_use', usage: { inputTokens: 10, outputTokens: 10 } },
      ],
      [
        { type: 'text_delta', text: 'listo' },
        { type: 'stop', reason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } },
      ],
    ]);

    const events = await collect(
      runAgent(
        { providerId: 'anthropic', credentials: { apiKey: 'sk' }, request: baseRequest, maxTokens: 1000 },
        { executeTool, runModel: fakeRunModel(fake) },
      ),
    );

    expect(events.at(-1)).toEqual({
      type: 'stop',
      reason: 'end_turn',
      usage: { inputTokens: 20, outputTokens: 15 },
    });
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('sin maxTokens usa el default (no corta por debajo de DEFAULT_RUN_MAX_TOKENS)', async () => {
    // Acumulado justo por debajo del default: el run debe terminar normal.
    const fake = new FakeProvider([
      [
        { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: {} },
        {
          type: 'stop',
          reason: 'tool_use',
          usage: { inputTokens: DEFAULT_RUN_MAX_TOKENS - 1, outputTokens: 0 },
        },
      ],
      [{ type: 'stop', reason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }],
    ]);

    const events = await collect(
      runAgent(
        { providerId: 'anthropic', credentials: { apiKey: 'sk' }, request: baseRequest },
        { executeTool, runModel: fakeRunModel(fake) },
      ),
    );

    expect(events.at(-1)).toMatchObject({ type: 'stop', reason: 'end_turn' });
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('sin maxTokens el default ES el cap activo (corta al superar DEFAULT_RUN_MAX_TOKENS)', async () => {
    const fake = new FakeProvider([
      [
        { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: {} },
        {
          type: 'stop',
          reason: 'tool_use',
          usage: { inputTokens: DEFAULT_RUN_MAX_TOKENS, outputTokens: 1 },
        },
      ],
      [{ type: 'stop', reason: 'end_turn' }],
    ]);

    const events = await collect(
      runAgent(
        { providerId: 'anthropic', credentials: { apiKey: 'sk' }, request: baseRequest },
        { executeTool, runModel: fakeRunModel(fake) },
      ),
    );

    expect(events.at(-1)).toMatchObject({ type: 'stop', reason: 'token_cap' });
    // No alcanzo a pedir un segundo turno al modelo: corto al cierre del turno 1.
    expect(fake.calls).toHaveLength(1);
  });
});
