import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/config/env.js';

describe('parseEnv', () => {
  it('aplica valores por defecto con entrada minima', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.RATE_LIMIT_MAX).toBe(100);
  });

  it('coacciona PORT de string a number', () => {
    const env = parseEnv({ PORT: '8080', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
    expect(env.PORT).toBe(8080);
  });

  it('falla con NODE_ENV invalido', () => {
    expect(() => parseEnv({ NODE_ENV: 'bogus' })).toThrow();
  });

  it('falla con PORT no numerico', () => {
    expect(() => parseEnv({ PORT: 'abc' })).toThrow();
  });

  it('WEB_WORKER_URL y WEB_WORKER_SECRET son opcionales (ausentes = undefined)', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
    expect(env.WEB_WORKER_URL).toBeUndefined();
    expect(env.WEB_WORKER_SECRET).toBeUndefined();
  });

  it('acepta WEB_WORKER_URL/SECRET validos', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', WEB_WORKER_URL: 'https://web-worker.example.com', WEB_WORKER_SECRET: 'worker-secret-de-32-chars-o-mas-aaaa' });
    expect(env.WEB_WORKER_URL).toBe('https://web-worker.example.com');
    expect(env.WEB_WORKER_SECRET).toBe('worker-secret-de-32-chars-o-mas-aaaa');
  });

  it('falla con WEB_WORKER_URL no-url', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', WEB_WORKER_URL: 'no-es-url' })).toThrow();
  });

  it('falla con WEB_WORKER_SECRET demasiado corto', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', WEB_WORKER_SECRET: 'corto' })).toThrow();
  });

  // SUPABASE_SERVICE_ROLE_KEY es OPCIONAL (como WEB_WORKER_*): sin ella el borrado de datos funciona, solo
  // se desactiva el borrado de auth.users. Ausente -> undefined; presente pero vacio -> falla.
  it('SUPABASE_SERVICE_ROLE_KEY es opcional (ausente = undefined)', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it('acepta un SUPABASE_SERVICE_ROLE_KEY valido', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-xyz' });
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('service-role-key-xyz');
  });

  it('falla con SUPABASE_SERVICE_ROLE_KEY presente pero vacio', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', SUPABASE_SERVICE_ROLE_KEY: '' })).toThrow();
  });

  // VAULT_SECRET es REQUERIDO (la boveda de credenciales no funciona sin el): a diferencia de
  // WEB_WORKER_*, su ausencia debe abortar el arranque, no degradar una feature opcional.
  it('falla si falta VAULT_SECRET (es requerido)', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' })).toThrow();
  });

  it('falla con VAULT_SECRET demasiado corto (min 32)', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: 'corto' })).toThrow();
  });

  it('acepta un VAULT_SECRET valido distinto del de sesion y lo expone en el Env', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'test-admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: 'vault-secret-distinto-del-de-sesion-aaaa' });
    expect(env.VAULT_SECRET).toBe('vault-secret-distinto-del-de-sesion-aaaa');
  });

  const minimo = {
    DATABASE_URL: 'postgres://x',
    ADMIN_API_TOKEN: 'test-admin-token-1234567890',
    SUPABASE_URL: 'https://x.supabase.co',
    SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  };

  // Cortes de seguridad del motor: RUN_TIMEOUT_SECONDS y RUN_MAX_TOKENS, opcionales con default.
  it('RUN_TIMEOUT_SECONDS y RUN_MAX_TOKENS usan defaults cuando faltan (600s, 1000000 tokens)', () => {
    const env = parseEnv(minimo);
    expect(env.RUN_TIMEOUT_SECONDS).toBe(600);
    expect(env.RUN_MAX_TOKENS).toBe(1_000_000);
  });

  it('respeta RUN_TIMEOUT_SECONDS y RUN_MAX_TOKENS configurados (coercion de string)', () => {
    const env = parseEnv({ ...minimo, RUN_TIMEOUT_SECONDS: '30', RUN_MAX_TOKENS: '5000' });
    expect(env.RUN_TIMEOUT_SECONDS).toBe(30);
    expect(env.RUN_MAX_TOKENS).toBe(5000);
  });

  it('falla con RUN_TIMEOUT_SECONDS no positivo', () => {
    expect(() => parseEnv({ ...minimo, RUN_TIMEOUT_SECONDS: '0' })).toThrow();
    expect(() => parseEnv({ ...minimo, RUN_TIMEOUT_SECONDS: '-5' })).toThrow();
  });

  it('falla con RUN_MAX_TOKENS no positivo o no numerico', () => {
    expect(() => parseEnv({ ...minimo, RUN_MAX_TOKENS: '0' })).toThrow();
    expect(() => parseEnv({ ...minimo, RUN_MAX_TOKENS: 'muchos' })).toThrow();
  });
});
