// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/env.js';

const BASE = {
  BROWSERBASE_API_KEY: 'bb-key',
  BROWSERBASE_PROJECT_ID: 'bb-proj',
  RELAY_TOKEN_SECRET: 'r'.repeat(48),
  RELAY_ALLOWED_ORIGINS: 'https://app.ledesma.example',
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

describe('parseEnv del relay: origenes permitidos (C-4)', () => {
  // NODE_ENV development para aislar el chequeo de origenes del refuse-to-start de RELAY_CONSUMO_URL.
  const SIN_ORIGENES = {
    BROWSERBASE_API_KEY: 'bb-key',
    BROWSERBASE_PROJECT_ID: 'bb-proj',
    RELAY_TOKEN_SECRET: 'r'.repeat(48),
    NODE_ENV: 'development',
  };

  it('REFUSE-TO-START: sin RELAY_ALLOWED_ORIGINS el relay no arranca', () => {
    expect(() => parseEnv({ ...SIN_ORIGENES })).toThrow(/RELAY_ALLOWED_ORIGINS/);
  });

  it('una RELAY_ALLOWED_ORIGINS vacia (solo espacios/comas) tampoco arranca', () => {
    expect(() => parseEnv({ ...SIN_ORIGENES, RELAY_ALLOWED_ORIGINS: ' , , ' })).toThrow(
      /RELAY_ALLOWED_ORIGINS/,
    );
  });

  it('parsea una lista de origenes separada por comas', () => {
    const env = parseEnv({
      ...SIN_ORIGENES,
      RELAY_ALLOWED_ORIGINS: 'https://a.example, https://b.example',
    });
    expect(env.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it("'*' explicito sigue admitido (solo desarrollo)", () => {
    const env = parseEnv({ ...SIN_ORIGENES, RELAY_ALLOWED_ORIGINS: '*' });
    expect(env.allowedOrigins).toBe('*');
  });
});
