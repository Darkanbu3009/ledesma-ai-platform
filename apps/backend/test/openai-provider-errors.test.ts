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

import { OpenAIProvider } from '../src/providers/openai/index.js';

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

describe('OpenAIProvider error normalization', () => {
  it('normaliza un 429 a ProviderError RATE_LIMIT retryable', async () => {
    createMock.mockRejectedValue({ status: 429, name: 'RateLimitError', message: 'rate limit' });
    await expect(collect(new OpenAIProvider().stream(makeInput('sk-A')))).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      providerId: 'openai',
      retryable: true,
    });
  });

  it('normaliza un timeout por nombre a TIMEOUT', async () => {
    createMock.mockRejectedValue({ name: 'APIConnectionTimeoutError', message: 'timed out' });
    await expect(collect(new OpenAIProvider().stream(makeInput('sk-A')))).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('el ProviderError no expone la api key', async () => {
    createMock.mockRejectedValue({ status: 401, message: 'invalid key' });
    let thrown: unknown;
    try {
      await collect(new OpenAIProvider().stream(makeInput('sk-leak-openai-888')));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProviderError);
    const serialized = JSON.stringify(thrown, Object.getOwnPropertyNames(thrown));
    expect(serialized).not.toContain('sk-leak-openai-888');
  });
});
