import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listByOwnerMock, getByIdForOwnerMock, createMock, updateForOwnerMock, removeForOwnerMock } = vi.hoisted(() => ({
  listByOwnerMock: vi.fn(),
  getByIdForOwnerMock: vi.fn(),
  createMock: vi.fn(),
  updateForOwnerMock: vi.fn(),
  removeForOwnerMock: vi.fn(),
}));

vi.mock('../src/agents/agent-repository.js', () => ({
  AgentRepository: class {
    listByOwner = listByOwnerMock;
    getByIdForOwner = getByIdForOwnerMock;
    create = createMock;
    updateForOwner = updateForOwnerMock;
    removeForOwner = removeForOwnerMock;
  },
}));
vi.mock('../src/db/client.js', () => ({ getSql: vi.fn(() => ({})), setSqlForTesting: vi.fn() }));

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';
import type { FastifyInstance } from 'fastify';

// Inyectamos un verifier falso registrando la ruta manualmente NO es trivial via buildServer;
// en su lugar, el server usa el verifier real. Para testear sin red, mockeamos jose.
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: vi.fn(async (token: string) => {
    if (token === 'valid-user-1') return { payload: { sub: 'user-1', email: 'u1@test.com' } };
    if (token === 'valid-user-2') return { payload: { sub: 'user-2', email: 'u2@test.com' } };
    throw new Error('invalid');
  }),
}));

const ENV = { NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' };

let app: FastifyInstance;
beforeEach(async () => {
  listByOwnerMock.mockReset(); getByIdForOwnerMock.mockReset(); createMock.mockReset();
  updateForOwnerMock.mockReset(); removeForOwnerMock.mockReset();
  app = await buildServer(parseEnv(ENV));
});

const validBody = { name: 'Cotizador', providerId: 'anthropic', model: 'claude-sonnet-4-6' };

describe('rutas por-usuario /v1/agents', () => {
  it('401 sin Authorization', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/agents' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });
  it('401 con token invalido', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/agents', headers: { authorization: 'Bearer nope' } });
    expect(res.statusCode).toBe(401);
  });
  it('lista solo los agentes del owner del token', async () => {
    listByOwnerMock.mockResolvedValue([{ id: 'a1', name: 'X' }]);
    const res = await app.inject({ method: 'GET', url: '/v1/agents', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(200);
    expect(listByOwnerMock).toHaveBeenCalledWith('user-1');
  });
  it('crea fijando owner_id = usuario del token, ignorando ownerId del body', async () => {
    createMock.mockResolvedValue({ id: 'a1', ...validBody, ownerId: 'user-1' });
    const res = await app.inject({
      method: 'POST', url: '/v1/agents',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...validBody, ownerId: 'OTRO-USUARIO-MALICIOSO' },
    });
    expect(res.statusCode).toBe(201);
    const passed = createMock.mock.calls[0]?.[0];
    expect(passed.ownerId).toBe('user-1');
    expect(passed.ownerId).not.toBe('OTRO-USUARIO-MALICIOSO');
  });
  it('404 al pedir un agente que no es del owner', async () => {
    getByIdForOwnerMock.mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/v1/agents/aX', headers: { authorization: 'Bearer valid-user-2' } });
    expect(res.statusCode).toBe(404);
    expect(getByIdForOwnerMock).toHaveBeenCalledWith('aX', 'user-2');
  });
  it('elimina solo si es del owner (204)', async () => {
    removeForOwnerMock.mockResolvedValue(true);
    const res = await app.inject({ method: 'DELETE', url: '/v1/agents/a1', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(204);
    expect(removeForOwnerMock).toHaveBeenCalledWith('a1', 'user-1');
  });
});
