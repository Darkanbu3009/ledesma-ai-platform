import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderStreamEvent, ProviderStreamInput } from '@ledesma-platform/shared';

const { constructorSpy, createMock } = vi.hoisted(() => ({
  constructorSpy: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    public chat = { completions: { create: createMock } };
    constructor(opts: unknown) {
      constructorSpy(opts);
    }
  },
}));

import { OpenAIProvider } from '../src/providers/openai/index.js';

function chunkStream(chunks: unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
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
      modelConfig: { model: 'gpt-x', maxTokens: 256 },
    },
    credentials: { apiKey },
    ...(signal ? { signal } : {}),
  };
}

beforeEach(() => {
  constructorSpy.mockClear();
  createMock.mockClear();
});

describe('OpenAIProvider', () => {
  it('expone id openai', () => {
    expect(new OpenAIProvider().id).toBe('openai');
  });

  it('conecta create con la traduccion del stream', async () => {
    createMock.mockResolvedValue(
      chunkStream([
        { choices: [{ index: 0, delta: { content: 'hey' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      ]),
    );

    const events = await collect(new OpenAIProvider().stream(makeInput('sk-A')));

    expect(events).toEqual([
      { type: 'text_delta', text: 'hey' },
      { type: 'stop', reason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);

    const firstArg = createMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstArg.stream).toBe(true);
    expect(firstArg.model).toBe('gpt-x');
    expect(firstArg.max_completion_tokens).toBe(256);
  });

  it('usa la key BYOK por llamada y no la cachea entre llamadas', async () => {
    createMock.mockImplementation(async () =>
      chunkStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const provider = new OpenAIProvider();

    await collect(provider.stream(makeInput('sk-AAA')));
    await collect(provider.stream(makeInput('sk-BBB')));

    expect(constructorSpy).toHaveBeenNthCalledWith(1, { apiKey: 'sk-AAA' });
    expect(constructorSpy).toHaveBeenNthCalledWith(2, { apiKey: 'sk-BBB' });
  });

  it('propaga el AbortSignal al SDK', async () => {
    createMock.mockResolvedValue(
      chunkStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const controller = new AbortController();

    await collect(new OpenAIProvider().stream(makeInput('sk-A', controller.signal)));

    const secondArg = createMock.mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(secondArg.signal).toBe(controller.signal);
  });
});
