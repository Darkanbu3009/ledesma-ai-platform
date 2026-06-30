import { describe, it, expect } from 'vitest';
import { CredentialFormSchema, toCredentialApiInput } from '../src/lib/credential-schema';

const minimo = {
  label: 'Mi llave',
  providerId: 'anthropic',
  apiKey: 'sk-secreta',
};

describe('CredentialFormSchema', () => {
  it('acepta una credencial valida minima y toCredentialApiInput omite baseUrl', () => {
    const result = CredentialFormSchema.safeParse(minimo);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const body = toCredentialApiInput(result.data);
    expect(body.label).toBe('Mi llave');
    expect(body.providerId).toBe('anthropic');
    expect(body.apiKey).toBe('sk-secreta');
    expect(body.baseUrl).toBeUndefined();
  });

  it('rechaza label vacia con issue en label', () => {
    const result = CredentialFormSchema.safeParse({ ...minimo, label: '' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path[0] === 'label')).toBe(true);
  });

  it('rechaza apiKey vacia con issue en apiKey', () => {
    const result = CredentialFormSchema.safeParse({ ...minimo, apiKey: '' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path[0] === 'apiKey')).toBe(true);
  });

  it('rechaza openai-compatible sin baseUrl con issue en baseUrl', () => {
    const result = CredentialFormSchema.safeParse({ ...minimo, providerId: 'openai-compatible' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path[0] === 'baseUrl')).toBe(true);
  });

  it('acepta openai-compatible con baseUrl y toCredentialApiInput la conserva', () => {
    const result = CredentialFormSchema.safeParse({
      ...minimo,
      providerId: 'openai-compatible',
      baseUrl: 'https://api.miproveedor.com/v1',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(toCredentialApiInput(result.data).baseUrl).toBe('https://api.miproveedor.com/v1');
  });

  it('rechaza un baseUrl que no es una URL valida', () => {
    const result = CredentialFormSchema.safeParse({
      ...minimo,
      providerId: 'openai-compatible',
      baseUrl: 'no-es-url',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path[0] === 'baseUrl')).toBe(true);
  });

  it('no envia baseUrl aunque venga cargada si el proveedor no es compatible', () => {
    const result = CredentialFormSchema.safeParse({
      ...minimo,
      providerId: 'openai',
      baseUrl: 'https://api.miproveedor.com/v1',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(toCredentialApiInput(result.data).baseUrl).toBeUndefined();
  });
});
