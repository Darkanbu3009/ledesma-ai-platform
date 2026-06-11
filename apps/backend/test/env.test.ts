import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/config/env.js';

describe('parseEnv', () => {
  it('aplica valores por defecto con entrada minima', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.RATE_LIMIT_MAX).toBe(100);
  });

  it('coacciona PORT de string a number', () => {
    const env = parseEnv({ PORT: '8080', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
    expect(env.PORT).toBe(8080);
  });

  it('falla con NODE_ENV invalido', () => {
    expect(() => parseEnv({ NODE_ENV: 'bogus' })).toThrow();
  });

  it('falla con PORT no numerico', () => {
    expect(() => parseEnv({ PORT: 'abc' })).toThrow();
  });
});
