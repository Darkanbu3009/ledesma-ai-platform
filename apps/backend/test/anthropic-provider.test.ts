import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderStreamEvent, ProviderStreamInput } from '@ledesma-platform/shared';

const { constructorSpy, createMock } = vi.hoisted(() => ({
  constructorSpy: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    public messages = { create: createMock };
    constructor(opts: unknown) {
      constructorSpy(opts);
    }
  },
}));

import { AnthropicProvider } from '../src/providers/anthropic/index.js';

function streamOf(events: unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

async function collect(
  stream: AsyncIterable<ProviderStreamEvent>,
): Promise<ProviderStreamEvent[]> {
  const out: ProviderStreamEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

function makeInput(apiKey: string, signal?: AbortSignal): ProviderStreamInput {
  return {
    request: {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      modelConfig: { model: 'claude-x', maxTokens: 512 },
    },
    credentials: { apiKey },
    ...(signal ? { signal } : {}),
  };
}

beforeEach(() => {
  constructorSpy.mockClear();
  createMock.mockClear();
});

describe('AnthropicProvider', () => {
  it('expone id anthropic', () => {
    expect(new AnthropicProvider().id).toBe('anthropic');
  });

  it('traduce un stream de texto a eventos normalizados con usage', async () => {
    createMock.mockResolvedValue(
      streamOf([
        { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hola' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' mundo' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ]),
    );

    const events = await collect(new AnthropicProvider().stream(makeInput('sk-A')));

    expect(events).toEqual([
      { type: 'text_delta', text: 'Hola' },
      { type: 'text_delta', text: ' mundo' },
      { type: 'stop', reason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } },
    ]);

    const firstArg = createMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstArg.stream).toBe(true);
    expect(firstArg.model).toBe('claude-x');
    expect(firstArg.max_tokens).toBe(512);
  });

  it('acumula input_json_delta y emite tool_use con input parseado', async () => {
    createMock.mockResolvedValue(
      streamOf([
        { type: 'message_start', message: { usage: { input_tokens: 20, output_tokens: 0 } } },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"piezas":' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '10}' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } },
        { type: 'message_stop' },
      ]),
    );

    const events = await collect(new AnthropicProvider().stream(makeInput('sk-A')));

    expect(events).toEqual([
      { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: { piezas: 10 } },
      { type: 'stop', reason: 'tool_use', usage: { inputTokens: 20, outputTokens: 8 } },
    ]);
  });

  it('maneja texto y tool_use en el mismo turno con indices distintos', async () => {
    createMock.mockResolvedValue(
      streamOf([
        { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Voy a calcular' } },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'tu_2', name: 'sumar', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"a":1,"b":2}' },
        },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
        { type: 'message_stop' },
      ]),
    );

    const events = await collect(new AnthropicProvider().stream(makeInput('sk-A')));

    expect(events).toEqual([
      { type: 'text_delta', text: 'Voy a calcular' },
      { type: 'tool_use', id: 'tu_2', name: 'sumar', input: { a: 1, b: 2 } },
      { type: 'stop', reason: 'tool_use', usage: { inputTokens: 5, outputTokens: 7 } },
    ]);
  });

  it('ignora bloques y deltas desconocidos sin romper', async () => {
    createMock.mockResolvedValue(
      streamOf([
        { type: 'message_start', message: { usage: { input_tokens: 3, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'mmm' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'ok' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
        { type: 'message_stop' },
      ]),
    );

    const events = await collect(new AnthropicProvider().stream(makeInput('sk-A')));

    expect(events).toEqual([
      { type: 'text_delta', text: 'ok' },
      { type: 'stop', reason: 'end_turn', usage: { inputTokens: 3, outputTokens: 2 } },
    ]);
  });

  it('usa la key BYOK por llamada y no la cachea entre llamadas', async () => {
    createMock.mockImplementation(async () => streamOf([{ type: 'message_stop' }]));
    const provider = new AnthropicProvider();

    await collect(provider.stream(makeInput('sk-AAA')));
    await collect(provider.stream(makeInput('sk-BBB')));

    expect(constructorSpy).toHaveBeenNthCalledWith(1, { apiKey: 'sk-AAA' });
    expect(constructorSpy).toHaveBeenNthCalledWith(2, { apiKey: 'sk-BBB' });
  });

  it('propaga el AbortSignal al SDK', async () => {
    createMock.mockResolvedValue(streamOf([{ type: 'message_stop' }]));
    const controller = new AbortController();

    await collect(new AnthropicProvider().stream(makeInput('sk-A', controller.signal)));

    const secondArg = createMock.mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(secondArg.signal).toBe(controller.signal);
  });
});
