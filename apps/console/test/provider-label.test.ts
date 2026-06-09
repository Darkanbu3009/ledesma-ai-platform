import { describe, it, expect } from 'vitest';
import { providerLabel } from '../src/lib/agents';

describe('providerLabel', () => {
  it('mapea los proveedores conocidos a etiquetas legibles', () => {
    expect(providerLabel('anthropic')).toBe('Anthropic');
    expect(providerLabel('openai')).toBe('OpenAI');
    expect(providerLabel('openai-compatible')).toBe('Compatible (OpenAI)');
  });
});
