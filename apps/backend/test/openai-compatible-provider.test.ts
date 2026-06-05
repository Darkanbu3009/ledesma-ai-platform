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

import { OpenAICompatibleProvider } from '../src/providers/openai-compatible/index.js';

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

function makeInput(
  apiKey: string,
  baseUrl: string | undefined,
  signal?: AbortSignal,
): ProviderStreamInput {
  return {
    request: {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      modelConfig: { model: 'llama-3.1-70b', maxTokens: 256 },
    },
    credentials: { apiKey, ...(baseUrl !== undefined ? { baseUrl } : {}) },
    ...(signal ? { signal } : {}),
  };
}

beforeEach(() => {
  constructorSpy.mockClear();
  createMock.mockClear();
});

describe('OpenAICompatibleProvider', () => {
  it('expone id openai-compatible', () => {
    expect(new OpenAICompatibleProvider().id).toBe('openai-compatible');
  });

  it('construye el cliente con apiKey y baseURL del credential', async () => {
    createMock.mockResolvedValue(
      chunkStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );

    await collect(
      new OpenAICompatibleProvider().stream(
        makeInput('sk-byok', 'https://openrouter.ai/api/v1'),
      ),
    );

    expect(constructorSpy).toHaveBeenCalledWith({
      apiKey: 'sk-byok',
      baseURL: 'https://openrouter.ai/api/v1',
    });
  });

  it('reutiliza la traduccion de stream de openai (texto + stop con usage)', async () => {
    createMock.mockResolvedValue(
      chunkStream([
        { choices: [{ index: 0, delta: { content: 'hey' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
      ]),
    );

    const events = await collect(
      new OpenAICompatibleProvider().stream(makeInput('sk-byok', 'https://my-vllm.local/v1')),
    );

    expect(events).toEqual([
      { type: 'text_delta', text: 'hey' },
      { type: 'stop', reason: 'end_turn', usage: { inputTokens: 3, outputTokens: 2 } },
    ]);
  });

  it('lanza error de configuracion si falta baseUrl', async () => {
    const provider = new OpenAICompatibleProvider();
    await expect(collect(provider.stream(makeInput('sk-byok', undefined)))).rejects.toThrow(
      'openai-compatible provider requires credentials.baseUrl',
    );
    expect(constructorSpy).not.toHaveBeenCalled();
  });

  it('lanza error de configuracion si baseUrl esta vacio', async () => {
    const provider = new OpenAICompatibleProvider();
    await expect(collect(provider.stream(makeInput('sk-byok', '   ')))).rejects.toThrow(
      'openai-compatible provider requires credentials.baseUrl',
    );
  });

  it('usa la key y baseURL por llamada y no los cachea entre llamadas', async () => {
    createMock.mockImplementation(async () =>
      chunkStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const provider = new OpenAICompatibleProvider();

    await collect(provider.stream(makeInput('sk-A', 'https://endpoint-a/v1')));
    await collect(provider.stream(makeInput('sk-B', 'https://endpoint-b/v1')));

    expect(constructorSpy).toHaveBeenNthCalledWith(1, {
      apiKey: 'sk-A',
      baseURL: 'https://endpoint-a/v1',
    });
    expect(constructorSpy).toHaveBeenNthCalledWith(2, {
      apiKey: 'sk-B',
      baseURL: 'https://endpoint-b/v1',
    });
  });

  it('propaga el AbortSignal al SDK', async () => {
    createMock.mockResolvedValue(
      chunkStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const controller = new AbortController();

    await collect(
      new OpenAICompatibleProvider().stream(
        makeInput('sk-A', 'https://endpoint/v1', controller.signal),
      ),
    );

    const secondArg = createMock.mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(secondArg.signal).toBe(controller.signal);
  });
});
