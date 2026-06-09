import { describe, it, expect } from 'vitest';
import { modelPlaceholder, modelSuggestions } from '../src/lib/model-catalog';

describe('modelSuggestions', () => {
  it('incluye los modelos sugeridos de anthropic', () => {
    const suggestions = modelSuggestions('anthropic');
    expect(suggestions).toContain('claude-sonnet-4-6');
    expect(suggestions).toContain('claude-opus-4-8');
  });

  it('no sugiere modelos haiku para ningun proveedor (regla de la plataforma)', () => {
    const all = (['anthropic', 'openai', 'openai-compatible'] as const).flatMap(modelSuggestions);
    expect(all.some((m) => m.toLowerCase().includes('haiku'))).toBe(false);
  });

  it('devuelve lista vacia para openai-compatible', () => {
    expect(modelSuggestions('openai-compatible')).toEqual([]);
  });
});

describe('modelPlaceholder', () => {
  it('da un ejemplo para openai-compatible aunque no haya sugerencias', () => {
    expect(modelPlaceholder('openai-compatible')).toBe('p. ej. llama-3.3-70b');
  });
});
