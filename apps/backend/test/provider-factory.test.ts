import { describe, it, expect } from 'vitest';
import { createProvider } from '../src/providers/factory.js';
import { AnthropicProvider } from '../src/providers/anthropic/index.js';
import { OpenAIProvider } from '../src/providers/openai/index.js';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible/index.js';

describe('createProvider', () => {
  it('crea el adaptador de anthropic', () => {
    expect(createProvider('anthropic')).toBeInstanceOf(AnthropicProvider);
  });

  it('crea el adaptador de openai', () => {
    expect(createProvider('openai')).toBeInstanceOf(OpenAIProvider);
  });

  it('crea el adaptador openai-compatible', () => {
    expect(createProvider('openai-compatible')).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it('lanza con un proveedor desconocido', () => {
    expect(() => createProvider('mistral' as never)).toThrow('unknown provider: mistral');
  });

  it('cada id devuelve el id correcto en la instancia', () => {
    expect(createProvider('anthropic').id).toBe('anthropic');
    expect(createProvider('openai').id).toBe('openai');
    expect(createProvider('openai-compatible').id).toBe('openai-compatible');
  });
});
