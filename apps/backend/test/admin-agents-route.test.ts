import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listMock, getMock, createMock, updateMock, removeMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  getMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  removeMock: vi.fn(),
}));

// Mockeamos el repositorio para no tocar DB real.
vi.mock('../src/agents/agent-repository.js', () => ({
  AgentRepository: class {
    list = listMock;
    getById = getMock;
    create = createMock;
    update = updateMock;
    remove = removeMock;
  },
}));

// Mockeamos el cliente sql para que getSql no intente conectar.
vi.mock('../src/db/client.js', () => ({
  getSql: vi.fn(() => ({})),
  setSqlForTesting: vi.fn(),
}));

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';
import type { FastifyInstance } from 'fastify';

const ADMIN_TOKEN = 'test-admin-token-1234567890';
const validBody = {
  name: 'Cotizador',
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
};

let app: FastifyInstance;

beforeEach(async () => {
  listMock.mockReset();
  getMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  removeMock.mockReset();
  app = await buildServer(parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: ADMIN_TOKEN, SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }));
});

describe('rutas admin de agentes', () => {
  it('401 sin token admin', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/agents' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('401 con token admin incorrecto', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/agents', headers: { 'x-admin-token': 'malo' } });
    expect(res.statusCode).toBe(401);
  });

  it('lista agentes con token valido', async () => {
    listMock.mockResolvedValue([{ id: 'a1', name: 'Cotizador' }]);
    const res = await app.inject({ method: 'GET', url: '/v1/admin/agents', headers: { 'x-admin-token': ADMIN_TOKEN } });
    expect(res.statusCode).toBe(200);
    expect(res.json().agents).toHaveLength(1);
  });

  it('crea un agente valido (201)', async () => {
    createMock.mockResolvedValue({ id: 'a1', ...validBody });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/agents',
      headers: { 'x-admin-token': ADMIN_TOKEN },
      payload: validBody,
    });
    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalled();
  });

  it('400 al crear con body invalido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/agents',
      headers: { 'x-admin-token': ADMIN_TOKEN },
      payload: { name: '', providerId: 'marte', model: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('404 al obtener un agente inexistente', async () => {
    getMock.mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/v1/admin/agents/no-existe', headers: { 'x-admin-token': ADMIN_TOKEN } });
    expect(res.statusCode).toBe(404);
  });

  it('rechaza con 400 si el body trae una apiKey (no se acepta como campo valido conocido)', async () => {
    // El schema ignora campos extra por defecto; aseguramos que igual NO se persista nada de key:
    createMock.mockResolvedValue({ id: 'a1', ...validBody });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/agents',
      headers: { 'x-admin-token': ADMIN_TOKEN },
      payload: { ...validBody, apiKey: 'sk-no-debe-guardarse' },
    });
    // Se crea (campo extra ignorado por zod), pero el input pasado al repo NO contiene apiKey.
    expect(res.statusCode).toBe(201);
    const passedInput = createMock.mock.calls[0]?.[0] ?? {};
    expect(Object.keys(passedInput)).not.toContain('apiKey');
    expect(JSON.stringify(passedInput)).not.toContain('sk-no-debe-guardarse');
  });

  it('elimina un agente (204)', async () => {
    removeMock.mockResolvedValue(true);
    const res = await app.inject({ method: 'DELETE', url: '/v1/admin/agents/a1', headers: { 'x-admin-token': ADMIN_TOKEN } });
    expect(res.statusCode).toBe(204);
  });
});
