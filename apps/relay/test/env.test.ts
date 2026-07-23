// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/env.js';

const BASE = {
  BROWSERBASE_API_KEY: 'bb-key',
  BROWSERBASE_PROJECT_ID: 'bb-proj',
  RELAY_TOKEN_SECRET: 'r'.repeat(48),
};

describe('parseEnv del relay: autoridad de coordinacion (B-1)', () => {
  it('REFUSE-TO-START: en produccion sin RELAY_CONSUMO_URL falla al arrancar', () => {
    expect(() => parseEnv({ ...BASE, NODE_ENV: 'production' })).toThrow(/RELAY_CONSUMO_URL/);
  });

  it('en produccion CON RELAY_CONSUMO_URL arranca y la expone', () => {
    const env = parseEnv({
      ...BASE,
      NODE_ENV: 'production',
      RELAY_CONSUMO_URL: 'http://backend.railway.internal:3001',
    });
    expect(env.consumoUrl).toBe('http://backend.railway.internal:3001');
    expect(env.nodeEnv).toBe('production');
  });

  it('fuera de produccion puede faltar (autoridad en memoria, una sola instancia)', () => {
    const env = parseEnv({ ...BASE, NODE_ENV: 'development' });
    expect(env.consumoUrl).toBeUndefined();
  });

  it('una RELAY_CONSUMO_URL vacia se trata como ausente (y en prod falla)', () => {
    expect(() => parseEnv({ ...BASE, NODE_ENV: 'production', RELAY_CONSUMO_URL: '   ' })).toThrow(
      /RELAY_CONSUMO_URL/,
    );
  });
});
