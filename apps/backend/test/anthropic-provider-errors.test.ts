import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderStreamEvent, ProviderStreamInput } from '@ledesma-platform/shared';
import { ProviderError } from '../src/providers/errors.js';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    public messages = { create: createMock };
    constructor() {}
  },
}));

import { AnthropicProvider } from '../src/providers/anthropic/index.js';

function makeInput(apiKey: string): ProviderStreamInput {
  return {
    request: {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      modelConfig: { model: 'm', maxTokens: 128 },
    },
    credentials: { apiKey },
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

describe('AnthropicProvider error normalization', () => {
  it('normaliza un 401 a ProviderError AUTHENTICATION', async () => {
    createMock.mockRejectedValue({ status: 401, name: 'AuthenticationError', message: '401 invalid x-api-key' });
    await expect(collect(new AnthropicProvider().stream(makeInput('sk-A')))).rejects.toMatchObject({
      code: 'AUTHENTICATION',
      providerId: 'anthropic',
    });
  });

  it('el ProviderError no expone la api key', async () => {
    createMock.mockRejectedValue({ status: 429, message: 'rate limited' });
    let thrown: unknown;
    try {
      await collect(new AnthropicProvider().stream(makeInput('sk-leak-anthropic-777')));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProviderError);
    const serialized = JSON.stringify(thrown, Object.getOwnPropertyNames(thrown));
    expect(serialized).not.toContain('sk-leak-anthropic-777');
  });

  it('normaliza un error a mitad del stream', async () => {
    createMock.mockResolvedValue(
      (async function* () {
        yield { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } };
        throw { status: 503, message: 'overloaded' };
      })(),
    );
    await expect(collect(new AnthropicProvider().stream(makeInput('sk-A')))).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });
});
