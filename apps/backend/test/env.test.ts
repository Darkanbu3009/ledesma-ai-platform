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

  it('WEB_WORKER_URL y WEB_WORKER_SECRET son opcionales (ausentes = undefined)', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
    expect(env.WEB_WORKER_URL).toBeUndefined();
    expect(env.WEB_WORKER_SECRET).toBeUndefined();
  });

  it('acepta WEB_WORKER_URL/SECRET validos', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', WEB_WORKER_URL: 'https://web-worker.example.com', WEB_WORKER_SECRET: 'worker-secret-de-32-chars-o-mas-aaaa' });
    expect(env.WEB_WORKER_URL).toBe('https://web-worker.example.com');
    expect(env.WEB_WORKER_SECRET).toBe('worker-secret-de-32-chars-o-mas-aaaa');
  });

  it('falla con WEB_WORKER_URL no-url', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', WEB_WORKER_URL: 'no-es-url' })).toThrow();
  });

  it('falla con WEB_WORKER_SECRET demasiado corto', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', WEB_WORKER_SECRET: 'corto' })).toThrow();
  });

  it('PLATFORM_ANTHROPIC_API_KEY es opcional (ausente = undefined) y PLATFORM_MODEL tiene default', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
    expect(env.PLATFORM_ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.PLATFORM_MODEL).toBe('claude-sonnet-4-6');
  });

  it('acepta PLATFORM_ANTHROPIC_API_KEY y PLATFORM_MODEL configurados', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', PLATFORM_ANTHROPIC_API_KEY: 'sk-plat-123', PLATFORM_MODEL: 'claude-opus-4-8' });
    expect(env.PLATFORM_ANTHROPIC_API_KEY).toBe('sk-plat-123');
    expect(env.PLATFORM_MODEL).toBe('claude-opus-4-8');
  });
});
