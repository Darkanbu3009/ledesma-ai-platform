import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { FakeProvider } from '@ledesma-platform/shared';
import type {
  AgentEvent,
  NormalizedRequest,
  ProviderStreamEvent,
} from '@ledesma-platform/shared';
import { runAgent, type AgentDeps } from '../src/agent/index.js';
import type { ModelCallInput } from '../src/providers/index.js';
import type { ToolExecutor } from '../src/agent/index.js';
import { ProviderError } from '../src/providers/errors.js';

const baseRequest: NormalizedRequest = {
  system: 'Eres un agente de cotizaciones',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'cotiza 10 piezas' }] }],
  tools: [
    {
      name: 'cotizar',
      description: 'Calcula el precio de N piezas',
      inputSchema: { type: 'object', properties: { piezas: { type: 'number' } } },
    },
  ],
  modelConfig: { model: 'm', maxTokens: 256 },
};

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

/** Conecta un FakeProvider como capa de modelo inyectada. */
function fakeRunModel(fake: FakeProvider): (input: ModelCallInput) => AsyncIterable<ProviderStreamEvent> {
  return (input: ModelCallInput) =>
    fake.stream({ credentials: input.credentials, request: input.request, signal: input.signal });
}

let executeTool: Mock<ToolExecutor>;

beforeEach(() => {
  executeTool = vi.fn<ToolExecutor>(async () => ({ content: '1500 MXN', isError: false }));
});

describe('runAgent', () => {
  it('un solo turno sin tools: re-emite texto y stop, no ejecuta tools', async () => {
    const fake = new FakeProvider([
      [
        { type: 'text_delta', text: 'Hola' },
        { type: 'text_delta', text: ' mundo' },
        { type: 'stop', reason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } },
      ],
    ]);

    const events = await collect(
      runAgent(
        { providerId: 'anthropic', credentials: { apiKey: 'sk-A' }, request: baseRequest },
        { executeTool, runModel: fakeRunModel(fake) } satisfies AgentDeps,
      ),
    );

    expect(events).toEqual([
      { type: 'text_delta', text: 'Hola' },
      { type: 'text_delta', text: ' mundo' },
      { type: 'stop', reason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } },
    ]);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('una ronda de tool: ejecuta, reinyecta el resultado y el modelo responde', async () => {
    const fake = new FakeProvider([
      [
        { type: 'text_delta', text: 'Calculando' },
        { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: { piezas: 10 } },
        { type: 'stop', reason: 'tool_use', usage: { inputTokens: 20, outputTokens: 8 } },
      ],
      [
        { type: 'text_delta', text: 'Son 1500 MXN' },
        { type: 'stop', reason: 'end_turn', usage: { inputTokens: 30, outputTokens: 4 } },
      ],
    ]);

    const events = await collect(
      runAgent(
        { providerId: 'anthropic', credentials: { apiKey: 'sk-A' }, request: baseRequest },
        { executeTool, runModel: fakeRunModel(fake) },
      ),
    );

    expect(events).toEqual([
      { type: 'text_delta', text: 'Calculando' },
      { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: { piezas: 10 } },
      { type: 'tool_result', toolUseId: 'tu_1', content: '1500 MXN', isError: false },
      { type: 'text_delta', text: 'Son 1500 MXN' },
      { type: 'stop', reason: 'end_turn', usage: { inputTokens: 50, outputTokens: 12 } },
    ]);

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool.mock.calls[0]?.[0]).toEqual({ id: 'tu_1', name: 'cotizar', input: { piezas: 10 } });

    // La reinyeccion: en la 2da llamada al modelo, el history trae el assistant (texto + tool_use)
    // y el user (tool_result).
    expect(fake.calls).toHaveLength(2);
    const secondTurnMessages = fake.calls[1]?.request.messages ?? [];
    expect(secondTurnMessages).toHaveLength(3);
    expect(secondTurnMessages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Calculando' },
        { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: { piezas: 10 } },
      ],
    });
    expect(secondTurnMessages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', toolUseId: 'tu_1', content: '1500 MXN', isError: false }],
    });
  });

  it('varias tools en un turno: ejecuta y reinyecta todas', async () => {
    executeTool = vi
      .fn<ToolExecutor>()
      .mockResolvedValueOnce({ content: 'r-a', isError: false })
      .mockResolvedValueOnce({ content: 'r-b', isError: false });

    const fake = new FakeProvider([
      [
        { type: 'tool_use', id: 'tu_a', name: 'uno', input: {} },
        { type: 'tool_use', id: 'tu_b', name: 'dos', input: { x: 1 } },
        { type: 'stop', reason: 'tool_use' },
      ],
      [{ type: 'text_delta', text: 'listo' }, { type: 'stop', reason: 'end_turn' }],
    ]);

    const events = await collect(
      runAgent(
        { providerId: 'openai', credentials: { apiKey: 'sk-A' }, request: baseRequest },
        { executeTool, runModel: fakeRunModel(fake) },
      ),
    );

    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults).toEqual([
      { type: 'tool_result', toolUseId: 'tu_a', content: 'r-a', isError: false },
      { type: 'tool_result', toolUseId: 'tu_b', content: 'r-b', isError: false },
    ]);
    expect(executeTool).toHaveBeenCalledTimes(2);

    const reinjectedUser = fake.calls[1]?.request.messages.at(-1);
    expect(reinjectedUser).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', toolUseId: 'tu_a', content: 'r-a', isError: false },
        { type: 'tool_result', toolUseId: 'tu_b', content: 'r-b', isError: false },
      ],
    });
  });

  it('propaga isError del executor al evento y al bloque reinyectado', async () => {
    executeTool = vi.fn<ToolExecutor>(async () => ({ content: 'fallo la tool', isError: true }));

    const fake = new FakeProvider([
      [{ type: 'tool_use', id: 'tu_1', name: 'cotizar', input: {} }, { type: 'stop', reason: 'tool_use' }],
      [{ type: 'stop', reason: 'end_turn' }],
    ]);

    const events = await collect(
      runAgent(
        { providerId: 'anthropic', credentials: { apiKey: 'sk-A' }, request: baseRequest },
        { executeTool, runModel: fakeRunModel(fake) },
      ),
    );

    expect(events).toContainEqual({
      type: 'tool_result',
      toolUseId: 'tu_1',
      content: 'fallo la tool',
      isError: true,
    });
    const reinjected = fake.calls[1]?.request.messages.at(-1);
    expect(reinjected).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', toolUseId: 'tu_1', content: 'fallo la tool', isError: true }],
    });
  });

  it('respeta la cota de iteraciones y para con max_iterations sin ejecutar la ronda excedente', async () => {
    const fake = new FakeProvider([
      [{ type: 'tool_use', id: 'tu_1', name: 'cotizar', input: {} }, { type: 'stop', reason: 'tool_use' }],
      [{ type: 'tool_use', id: 'tu_2', name: 'cotizar', input: {} }, { type: 'stop', reason: 'tool_use' }],
    ]);

    const events = await collect(
      runAgent(
        {
          providerId: 'anthropic',
          credentials: { apiKey: 'sk-A' },
          request: baseRequest,
          maxIterations: 2,
        },
        { executeTool, runModel: fakeRunModel(fake) },
      ),
    );

    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'stop', reason: 'max_iterations' });
    // se llamo al modelo 2 veces, pero la tool solo se ejecuto en la 1a iteracion
    expect(fake.calls).toHaveLength(2);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('propaga un error de la capa de modelo como excepcion', async () => {
    const runModelThrows = (): AsyncIterable<ProviderStreamEvent> =>
      // eslint-disable-next-line require-yield
      (async function* () {
        throw new ProviderError({ code: 'AUTHENTICATION', providerId: 'anthropic', message: 'bad key', status: 401 });
      })();

    await expect(
      collect(
        runAgent(
          { providerId: 'anthropic', credentials: { apiKey: 'sk-A' }, request: baseRequest },
          { executeTool, runModel: runModelThrows },
        ),
      ),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('pasa el AbortSignal a la capa de modelo y al executor', async () => {
    const controller = new AbortController();
    const fake = new FakeProvider([
      [{ type: 'tool_use', id: 'tu_1', name: 'cotizar', input: {} }, { type: 'stop', reason: 'tool_use' }],
      [{ type: 'stop', reason: 'end_turn' }],
    ]);

    await collect(
      runAgent(
        {
          providerId: 'anthropic',
          credentials: { apiKey: 'sk-A' },
          request: baseRequest,
          signal: controller.signal,
        },
        { executeTool, runModel: fakeRunModel(fake) },
      ),
    );

    expect(fake.calls[0]?.signal).toBe(controller.signal);
    expect(executeTool.mock.calls[0]?.[1]).toBe(controller.signal);
  });
});
