import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createMock, listByOwnerMock, deleteForOwnerMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  listByOwnerMock: vi.fn(),
  deleteForOwnerMock: vi.fn(),
}));

vi.mock('../src/credentials/provider-credential-repository.js', () => ({
  ProviderCredentialRepository: class {
    create = createMock;
    listByOwner = listByOwnerMock;
    deleteForOwner = deleteForOwnerMock;
  },
}));
vi.mock('../src/db/client.js', () => ({ getSql: vi.fn(() => ({})), setSqlForTesting: vi.fn() }));

// jose mockeado (sin red): valid-user-1 / valid-user-2; cualquier otro token es invalido.
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: vi.fn(async (token: string) => {
    if (token === 'valid-user-1') return { payload: { sub: 'user-1', email: 'u1@test.com' } };
    if (token === 'valid-user-2') return { payload: { sub: 'user-2', email: 'u2@test.com' } };
    throw new Error('invalid');
  }),
}));

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';
import { decryptFromToken } from '../src/crypto/aes-gcm.js';
import type { FastifyInstance } from 'fastify';

const VAULT = 'vault-secret-de-test-distinto-y-de-32+chars';
const ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: VAULT,
};

const CRED_ID = '11111111-1111-4111-8111-111111111111';

let app: FastifyInstance;
beforeEach(async () => {
  createMock.mockReset();
  listByOwnerMock.mockReset();
  deleteForOwnerMock.mockReset();
  app = await buildServer(parseEnv(ENV));
});

const validBody = { label: 'Mi key', providerId: 'openai', apiKey: 'sk-mi-key-secreta-123' };

describe('boveda: /v1/credentials sin JWT', () => {
  it('POST sin Authorization -> 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/credentials', payload: validBody });
    expect(res.statusCode).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });
  it('GET sin Authorization -> 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/credentials' });
    expect(res.statusCode).toBe(401);
    expect(listByOwnerMock).not.toHaveBeenCalled();
  });
  it('DELETE sin Authorization -> 401', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/v1/credentials/${CRED_ID}` });
    expect(res.statusCode).toBe(401);
    expect(deleteForOwnerMock).not.toHaveBeenCalled();
  });
});

describe('POST /v1/credentials', () => {
  it('cifra la apiKey (nunca la guarda en claro) y fija owner_id = usuario del token', async () => {
    createMock.mockResolvedValue({ id: CRED_ID, label: 'Mi key', providerId: 'openai', baseUrl: null, createdAt: '2026-06-30T00:00:00.000Z' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...validBody, ownerId: 'OTRO-USUARIO-MALICIOSO' },
    });
    expect(res.statusCode).toBe(201);

    const passed = createMock.mock.calls[0]?.[0];
    // owner del token, jamas del body.
    expect(passed.ownerId).toBe('user-1');
    expect(passed.ownerId).not.toBe('OTRO-USUARIO-MALICIOSO');
    // La key viaja CIFRADA al repo: no es el texto plano y se descifra a la original con el VAULT_SECRET.
    expect(passed.encryptedKey).not.toBe('sk-mi-key-secreta-123');
    expect(decryptFromToken(passed.encryptedKey, VAULT)).toBe('sk-mi-key-secreta-123');

    // La respuesta es metadata SIN la key (ni cifrada ni en claro).
    const body = res.json();
    expect(body.credential).toEqual({ id: CRED_ID, label: 'Mi key', providerId: 'openai', baseUrl: null, createdAt: '2026-06-30T00:00:00.000Z' });
    expect(res.payload).not.toContain('sk-mi-key-secreta-123');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('apikey');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('encrypted');
  });

  it('openai-compatible sin baseUrl -> 400 (no cifra ni guarda nada)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { label: 'k', providerId: 'openai-compatible', apiKey: 'sk-x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.json().error)).toMatch(/baseUrl/);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('openai-compatible CON baseUrl -> 201 y reenvia baseUrl al repo', async () => {
    createMock.mockResolvedValue({ id: CRED_ID, label: 'k', providerId: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', createdAt: '2026-06-30T00:00:00.000Z' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { label: 'k', providerId: 'openai-compatible', apiKey: 'sk-x', baseUrl: 'https://llm.example.com/v1' },
    });
    expect(res.statusCode).toBe(201);
    expect(createMock.mock.calls[0]?.[0]?.baseUrl).toBe('https://llm.example.com/v1');
  });

  it('apiKey vacia -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { label: 'k', providerId: 'openai', apiKey: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('providerId invalido -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/credentials',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { label: 'k', providerId: 'gemini', apiKey: 'sk-x' },
    });
    expect(res.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('GET /v1/credentials', () => {
  it('lista solo las del owner del token y NUNCA incluye la key', async () => {
    listByOwnerMock.mockResolvedValue([
      { id: CRED_ID, label: 'Mi key', providerId: 'openai', baseUrl: null, createdAt: '2026-06-30T00:00:00.000Z' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/v1/credentials', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(200);
    expect(listByOwnerMock).toHaveBeenCalledWith('user-1');
    const body = res.json();
    expect(body.credentials).toHaveLength(1);
    expect(JSON.stringify(body).toLowerCase()).not.toContain('apikey');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('encrypted');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('"key"');
  });
});

describe('DELETE /v1/credentials/:id', () => {
  it('borra solo las propias: acota por owner del token (204)', async () => {
    deleteForOwnerMock.mockResolvedValue(true);
    const res = await app.inject({ method: 'DELETE', url: `/v1/credentials/${CRED_ID}`, headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(204);
    expect(deleteForOwnerMock).toHaveBeenCalledWith('user-1', CRED_ID);
  });

  it('404 si la credencial no es del owner (no borro nada)', async () => {
    deleteForOwnerMock.mockResolvedValue(false);
    const res = await app.inject({ method: 'DELETE', url: `/v1/credentials/${CRED_ID}`, headers: { authorization: 'Bearer valid-user-2' } });
    expect(res.statusCode).toBe(404);
    expect(deleteForOwnerMock).toHaveBeenCalledWith('user-2', CRED_ID);
  });

  it('id no-uuid -> 400 (no toca el repo)', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/credentials/no-es-uuid', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(400);
    expect(deleteForOwnerMock).not.toHaveBeenCalled();
  });
});
