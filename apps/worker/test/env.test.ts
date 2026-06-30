import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/env.js';

const VALID = {
  DATABASE_URL: 'postgres://user:pass@host:5432/db',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef',
};

describe('parseEnv (worker)', () => {
  it('acepta una config minima valida y aplica defaults', () => {
    const env = parseEnv(VALID as NodeJS.ProcessEnv);
    expect(env.DATABASE_URL).toBe(VALID.DATABASE_URL);
    expect(env.WORKER_POLL_INTERVAL_MS).toBe(5000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.NODE_ENV).toBe('development');
    // Cortes del motor: mismos defaults que el backend.
    expect(env.RUN_TIMEOUT_SECONDS).toBe(600);
    expect(env.RUN_MAX_TOKENS).toBe(1_000_000);
  });

  it('coacciona WORKER_POLL_INTERVAL_MS desde string', () => {
    const env = parseEnv({ ...VALID, WORKER_POLL_INTERVAL_MS: '1500' } as NodeJS.ProcessEnv);
    expect(env.WORKER_POLL_INTERVAL_MS).toBe(1500);
  });

  it('coacciona RUN_TIMEOUT_SECONDS y RUN_MAX_TOKENS desde string', () => {
    const env = parseEnv({ ...VALID, RUN_TIMEOUT_SECONDS: '120', RUN_MAX_TOKENS: '50000' } as NodeJS.ProcessEnv);
    expect(env.RUN_TIMEOUT_SECONDS).toBe(120);
    expect(env.RUN_MAX_TOKENS).toBe(50_000);
  });

  it('rechaza si falta DATABASE_URL', () => {
    expect(() => parseEnv({ VAULT_SECRET: VALID.VAULT_SECRET } as NodeJS.ProcessEnv)).toThrow(
      /Environment validation failed/,
    );
  });

  it('rechaza un VAULT_SECRET demasiado corto', () => {
    expect(() => parseEnv({ ...VALID, VAULT_SECRET: 'corto' } as NodeJS.ProcessEnv)).toThrow(
      /Environment validation failed/,
    );
  });
});
