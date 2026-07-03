import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderStreamEvent, ProviderStreamInput } from '@ledesma-platform/shared';
import { ProviderError } from '../src/providers/errors.js';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    public chat = { completions: { create: createMock } };
    constructor() {}
  },
}));

import { OpenAICompatibleProvider } from '../src/providers/openai-compatible/index.js';
import type { LookupFn } from '../src/tools/ip-guard.js';

// La guarda anti-SSRF resuelve el host de baseUrl por DNS; inyectamos una IP publica para que el
// camino llegue al SDK (mockeado) y se ejerza la normalizacion de errores, sin depender del DNS real.
const publicLookup: LookupFn = async () => [{ address: '34.107.221.82', family: 4 }];

function makeInput(apiKey: string): ProviderStreamInput {
  return {
    request: {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      modelConfig: { model: 'llama', maxTokens: 128 },
    },
    credentials: { apiKey, baseUrl: 'https://endpoint/v1' },
  };
}

async function collect(stream: AsyncIterable<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
  const out: ProviderStreamEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

beforeEach(() => {
  createMock.mockReset();
});

describe('OpenAICompatibleProvider error normalization', () => {
  it('normaliza un 500 del endpoint a PROVIDER_UNAVAILABLE con su providerId', async () => {
    createMock.mockRejectedValue({ status: 500, message: 'server error' });
    await expect(collect(new OpenAICompatibleProvider(publicLookup).stream(makeInput('sk-A')))).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      providerId: 'openai-compatible',
    });
  });

  it('el ProviderError no expone la api key', async () => {
    createMock.mockRejectedValue({ status: 401, message: 'invalid key' });
    let thrown: unknown;
    try {
      await collect(new OpenAICompatibleProvider(publicLookup).stream(makeInput('sk-leak-compat-999')));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProviderError);
    const serialized = JSON.stringify(thrown, Object.getOwnPropertyNames(thrown));
    expect(serialized).not.toContain('sk-leak-compat-999');
  });

  it('la guarda de baseUrl sigue siendo un Error plano, no ProviderError', async () => {
    const provider = new OpenAICompatibleProvider();
    const input: ProviderStreamInput = {
      request: { messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }], modelConfig: { model: 'm', maxTokens: 10 } },
      credentials: { apiKey: 'sk-A' },
    };
    let thrown: unknown;
    try {
      await collect(provider.stream(input));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(ProviderError);
    expect((thrown as Error).message).toContain('requires credentials.baseUrl');
  });
});
