import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { processingRecordRoutes } from '../src/routes/processing-records.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const AGENT_ID = '11111111-1111-4111-8111-111111111111';

const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    throw new Error('invalid');
  },
};

const createRecord = vi.fn();
const listRecordsByOwner = vi.fn();

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    ownerId: 'user-1',
    agentId: AGENT_ID,
    purpose: 'responder consultas',
    dataCategories: 'contactos, mensajes',
    createdAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(processingRecordRoutes(config, { verifier, processingRepo: { createRecord, listRecordsByOwner } }));
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  app = await makeApp();
});

describe('POST /v1/processing-records', () => {
  it('sin JWT -> 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/processing-records', payload: { purpose: 'x', dataCategories: 'y' } });
    expect(res.statusCode).toBe(401);
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('crea con owner del token -> 201', async () => {
    createRecord.mockResolvedValue(makeRecord());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/processing-records',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { agentId: AGENT_ID, purpose: 'responder consultas', dataCategories: 'contactos, mensajes', ownerId: 'MALICIOSO' },
    });
    expect(res.statusCode).toBe(201);
    const passed = createRecord.mock.calls[0]?.[0];
    expect(passed.ownerId).toBe('user-1');
    expect(passed.agentId).toBe(AGENT_ID);
    expect(passed.purpose).toBe('responder consultas');
  });

  it('agentId ausente es valido (opcional) -> 201', async () => {
    createRecord.mockResolvedValue(makeRecord({ agentId: null }));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/processing-records',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { purpose: 'analitica', dataCategories: 'metricas' },
    });
    expect(res.statusCode).toBe(201);
    expect(createRecord.mock.calls[0]?.[0].agentId).toBeNull();
  });

  it('sin purpose -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/processing-records',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { dataCategories: 'y' },
    });
    expect(res.statusCode).toBe(400);
    expect(createRecord).not.toHaveBeenCalled();
  });
});

describe('GET /v1/processing-records', () => {
  it('lista las del owner del token', async () => {
    listRecordsByOwner.mockResolvedValue([makeRecord()]);
    const res = await app.inject({ method: 'GET', url: '/v1/processing-records', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(200);
    expect(listRecordsByOwner).toHaveBeenCalledWith('user-1');
    expect(res.json().records).toHaveLength(1);
  });
});
