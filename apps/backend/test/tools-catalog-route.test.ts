import { describe, it, expect, vi, beforeEach } from 'vitest';

// El catalogo es solo lectura y no toca DB, pero buildServer registra TODAS las rutas (incluida
// /v1/agents, que construye el repo con getSql). Mockeamos db/client para no abrir conexiones.
vi.mock('../src/db/client.js', () => ({ getSql: vi.fn(() => ({})), setSqlForTesting: vi.fn() }));

// Mockeamos jose para verificar el JWT sin red (mismo patron que agents-route.test.ts).
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: vi.fn(async (token: string) => {
    if (token === 'valid-user-1') return { payload: { sub: 'user-1', email: 'u1@test.com' } };
    throw new Error('invalid');
  }),
}));

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';
import type { FastifyInstance } from 'fastify';

const BASE_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};
const WORKER_ENV = {
  WEB_WORKER_URL: 'https://web-worker.example.com',
  WEB_WORKER_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('GET /v1/tools/catalog', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildServer(parseEnv(BASE_ENV));
  });

  it('401 sin Authorization', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tools/catalog' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('401 con token invalido', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tools/catalog', headers: { authorization: 'Bearer nope' } });
    expect(res.statusCode).toBe(401);
  });

  it('200 con usuario autenticado: devuelve el shape ToolCatalogResponse', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tools/catalog', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);
    for (const tool of body.tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.kind).toBe('native');
      expect(typeof tool.title).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.whenToUse).toBe('string');
      expect(typeof tool.embedSafe).toBe('boolean');
      expect(Array.isArray(tool.requiresConfig)).toBe(true);
      expect(typeof tool.available).toBe('boolean');
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
    }
    expect(body.webhookCapability.kind).toBe('webhook');
    expect(body.webhookCapability.embedSafe).toBe(true);
    expect(Array.isArray(body.webhookCapability.requiredFields)).toBe(true);
  });

  it('sin config del web worker: nativas available=false', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tools/catalog', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(200);
    for (const tool of res.json().tools) expect(tool.available).toBe(false);
  });

  it('con WEB_WORKER_URL + WEB_WORKER_SECRET: nativas available=true', async () => {
    const appWithWorker = await buildServer(parseEnv({ ...BASE_ENV, ...WORKER_ENV }));
    const res = await appWithWorker.inject({ method: 'GET', url: '/v1/tools/catalog', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(200);
    const tools = res.json().tools;
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) expect(tool.available).toBe(true);
  });
});
