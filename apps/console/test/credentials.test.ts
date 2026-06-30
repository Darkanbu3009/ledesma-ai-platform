import { describe, expect, it } from 'vitest';
import { compatibleCredentials, type ProviderCredential } from '../src/lib/credentials';

const cred = (id: string, providerId: ProviderCredential['providerId']): ProviderCredential => ({
  id,
  label: `cred-${id}`,
  providerId,
  baseUrl: providerId === 'openai-compatible' ? 'https://x.test/v1' : null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const ALL: ProviderCredential[] = [
  cred('a1', 'anthropic'),
  cred('o1', 'openai'),
  cred('a2', 'anthropic'),
  cred('c1', 'openai-compatible'),
];

describe('compatibleCredentials', () => {
  it('devuelve solo las credenciales del mismo proveedor', () => {
    expect(compatibleCredentials(ALL, 'anthropic').map((c) => c.id)).toEqual(['a1', 'a2']);
    expect(compatibleCredentials(ALL, 'openai').map((c) => c.id)).toEqual(['o1']);
    expect(compatibleCredentials(ALL, 'openai-compatible').map((c) => c.id)).toEqual(['c1']);
  });

  it('devuelve lista vacia cuando no hay credenciales del proveedor', () => {
    expect(compatibleCredentials([cred('o1', 'openai')], 'anthropic')).toEqual([]);
    expect(compatibleCredentials([], 'anthropic')).toEqual([]);
  });

  it('no muta la lista original', () => {
    const original = [...ALL];
    compatibleCredentials(ALL, 'anthropic');
    expect(ALL).toEqual(original);
  });
});
