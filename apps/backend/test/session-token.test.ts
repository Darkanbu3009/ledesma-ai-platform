import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSessionToken, verifySessionToken, SESSION_TOKEN_LIMITS } from '../src/auth/session-token.js';
import { AppError } from '../src/errors/app-error.js';

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const AGENT_ID = '0b9f2c4e-5a1d-4f3b-9c8e-7d6a5b4c3f2e';
const KEY = 'sk-proveedor-secreta-roundtrip-77';

/** Cambia el primer caracter del token por otro distinto, garantizando corrupcion. */
function tamper(token: string): string {
  return (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
}

/** Ejecuta fn esperando el AppError generico de autenticacion y lo devuelve para inspeccion. */
function expectAuthenticationError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe('AUTHENTICATION');
    expect(appError.statusCode).toBe(401);
    return appError;
  }
  throw new Error('se esperaba un AppError de autenticacion');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createSessionToken / verifySessionToken', () => {
  it('roundtrip: el token verificado devuelve la providerKey original', () => {
    const { token, expiresAt } = createSessionToken({ agentId: AGENT_ID, providerKey: KEY }, SECRET);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(verifySessionToken(token, AGENT_ID, SECRET)).toEqual({ providerKey: KEY });
  });

  it('token expirado lanza AUTHENTICATION 401', () => {
    vi.useFakeTimers();
    const { token } = createSessionToken({ agentId: AGENT_ID, providerKey: KEY, ttlSeconds: 1 }, SECRET);
    vi.advanceTimersByTime(2000);
    expectAuthenticationError(() => verifySessionToken(token, AGENT_ID, SECRET));
  });

  it('token de otro agente lanza AUTHENTICATION 401', () => {
    const { token } = createSessionToken({ agentId: AGENT_ID, providerKey: KEY }, SECRET);
    expectAuthenticationError(() => verifySessionToken(token, 'f1e2d3c4-b5a6-4789-8abc-def012345678', SECRET));
  });

  it('token manipulado lanza AUTHENTICATION 401', () => {
    const { token } = createSessionToken({ agentId: AGENT_ID, providerKey: KEY }, SECRET);
    expectAuthenticationError(() => verifySessionToken(tamper(token), AGENT_ID, SECRET));
  });

  it('un ttl mayor al maximo se recorta a maxTtlSeconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.678Z'));
    const { token, expiresAt } = createSessionToken(
      { agentId: AGENT_ID, providerKey: KEY, ttlSeconds: SESSION_TOKEN_LIMITS.maxTtlSeconds * 10 },
      SECRET,
    );
    expect(new Date(expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + SESSION_TOKEN_LIMITS.maxTtlSeconds * 1000);
    expect(verifySessionToken(token, AGENT_ID, SECRET)).toEqual({ providerKey: KEY });
  });

  it('el mensaje del error nunca contiene la key ni el payload', () => {
    const { token } = createSessionToken({ agentId: AGENT_ID, providerKey: KEY }, SECRET);

    const wrongAgent = expectAuthenticationError(() =>
      verifySessionToken(token, 'f1e2d3c4-b5a6-4789-8abc-def012345678', SECRET),
    );
    const tampered = expectAuthenticationError(() => verifySessionToken(tamper(token), AGENT_ID, SECRET));

    for (const error of [wrongAgent, tampered]) {
      // Mensaje generico fijo: no filtra la key, el agentId ni el JSON del payload.
      expect(error.message).toBe('Invalid or expired session token');
      expect(error.message).not.toContain(KEY);
      expect(error.message).not.toContain(AGENT_ID);
      expect(error.details).toBeUndefined();
    }
  });
});
