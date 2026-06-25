import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listByOwnerMock, getByIdForOwnerMock, createMock, updateForOwnerMock, removeForOwnerMock, rotateWebhookSecretMock } = vi.hoisted(() => ({
  listByOwnerMock: vi.fn(),
  getByIdForOwnerMock: vi.fn(),
  createMock: vi.fn(),
  updateForOwnerMock: vi.fn(),
  removeForOwnerMock: vi.fn(),
  rotateWebhookSecretMock: vi.fn(),
}));

vi.mock('../src/agents/agent-repository.js', () => ({
  AgentRepository: class {
    listByOwner = listByOwnerMock;
    getByIdForOwner = getByIdForOwnerMock;
    create = createMock;
    updateForOwner = updateForOwnerMock;
    removeForOwner = removeForOwnerMock;
    rotateWebhookSecret = rotateWebhookSecretMock;
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
  updateForOwnerMock.mockReset(); removeForOwnerMock.mockReset(); rotateWebhookSecretMock.mockReset();
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

describe('POST /v1/agents/:id/webhook-secret/rotate', () => {
  it('401 sin token', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/agents/a1/webhook-secret/rotate' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(rotateWebhookSecretMock).not.toHaveBeenCalled();
  });
  it('404 si el agente es de otro owner', async () => {
    rotateWebhookSecretMock.mockResolvedValue(null);
    const res = await app.inject({ method: 'POST', url: '/v1/agents/aX/webhook-secret/rotate', headers: { authorization: 'Bearer valid-user-2' } });
    expect(res.statusCode).toBe(404);
    expect(rotateWebhookSecretMock).toHaveBeenCalledWith('aX', 'user-2');
  });
  it('200 devuelve el agente con un webhookSecret distinto al anterior', async () => {
    const secretoAnterior = 'whsec_anterior_aaa111';
    rotateWebhookSecretMock.mockResolvedValue({ id: 'a1', name: 'Cotizador', webhookSecret: 'whsec_nuevo_bbb222' });
    const res = await app.inject({ method: 'POST', url: '/v1/agents/a1/webhook-secret/rotate', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().agent.webhookSecret).toBe('whsec_nuevo_bbb222');
    expect(res.json().agent.webhookSecret).not.toBe(secretoAnterior);
    expect(rotateWebhookSecretMock).toHaveBeenCalledWith('a1', 'user-1');
  });
});

describe('prefijo reservado platform_ en tools de cliente', () => {
  const toolValida = {
    name: 'cotizar',
    description: 'Calcula el precio',
    inputSchema: { type: 'object' },
    url: 'https://hooks.cliente.com/cotizar',
  };

  it('POST rechaza con 400 una tool cuyo nombre empieza con platform_', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...validBody, tools: [{ ...toolValida, name: 'platform_iniciar_tarea_web' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('POST acepta nombres de tool normales', async () => {
    createMock.mockResolvedValue({ id: 'a1', ...validBody, tools: [toolValida], ownerId: 'user-1' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...validBody, tools: [toolValida] },
    });
    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('PUT tambien rechaza con 400 el prefijo reservado platform_', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/agents/a1',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...validBody, tools: [{ ...toolValida, name: 'platform_x' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(updateForOwnerMock).not.toHaveBeenCalled();
  });
});
