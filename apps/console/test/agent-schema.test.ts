import { describe, it, expect } from 'vitest';
import { AgentFormSchema, toApiInput } from '../src/lib/agent-schema';

const minimo = {
  name: 'Mi agente',
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
  maxTokens: 1024,
};

describe('AgentFormSchema', () => {
  it('acepta un agente valido minimo y toApiInput manda tools vacias y baseUrl null', () => {
    const result = AgentFormSchema.safeParse(minimo);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const body = toApiInput(result.data);
    expect(body.tools).toEqual([]);
    expect(body.baseUrl).toBeNull();
    expect(body.name).toBe('Mi agente');
    expect(body.maxTokens).toBe(1024);
  });

  it('rechaza openai-compatible sin baseUrl con issue en baseUrl', () => {
    const result = AgentFormSchema.safeParse({
      ...minimo,
      providerId: 'openai-compatible',
      model: 'mi-modelo',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path[0] === 'baseUrl')).toBe(true);
  });

  it('acepta openai-compatible con baseUrl y toApiInput la conserva', () => {
    const result = AgentFormSchema.safeParse({
      ...minimo,
      providerId: 'openai-compatible',
      model: 'mi-modelo',
      baseUrl: 'https://api.miproveedor.com/v1',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(toApiInput(result.data).baseUrl).toBe('https://api.miproveedor.com/v1');
  });

  it('normaliza temperature vacia a null y coerciona strings numericos', () => {
    const vacia = AgentFormSchema.safeParse({ ...minimo, temperature: '' });
    expect(vacia.success).toBe(true);
    if (vacia.success) expect(vacia.data.temperature).toBeNull();

    const media = AgentFormSchema.safeParse({ ...minimo, temperature: '0.5' });
    expect(media.success).toBe(true);
    if (media.success) expect(media.data.temperature).toBe(0.5);
  });

  it('coerciona maxTokens string y rechaza maxTokens 0', () => {
    const coercionado = AgentFormSchema.safeParse({ ...minimo, maxTokens: '2048' });
    expect(coercionado.success).toBe(true);
    if (coercionado.success) expect(coercionado.data.maxTokens).toBe(2048);

    const cero = AgentFormSchema.safeParse({ ...minimo, maxTokens: 0 });
    expect(cero.success).toBe(false);
  });

  it('rechaza name vacio', () => {
    const result = AgentFormSchema.safeParse({ ...minimo, name: '' });
    expect(result.success).toBe(false);
  });
});
