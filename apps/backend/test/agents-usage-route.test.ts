import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getByIdForOwnerMock, totalsForAgentMock, recentForAgentMock } = vi.hoisted(() => ({
  getByIdForOwnerMock: vi.fn(),
  totalsForAgentMock: vi.fn(),
  recentForAgentMock: vi.fn(),
}));

vi.mock('../src/agents/agent-repository.js', () => ({
  AgentRepository: class {
    getByIdForOwner = getByIdForOwnerMock;
  },
}));
vi.mock('../src/agents/run-repository.js', () => ({
  AgentRunRepository: class {
    totalsForAgent = totalsForAgentMock;
    recentForAgent = recentForAgentMock;
  },
}));
vi.mock('../src/db/client.js', () => ({ getSql: vi.fn(() => ({})), setSqlForTesting: vi.fn() }));

// Para testear sin red, mockeamos jose (mismo patron que agents-route.test.ts).
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

const ENV = { NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co' };
const AGENT_ID = '11111111-1111-1111-1111-111111111111';

let app: FastifyInstance;
beforeEach(async () => {
  getByIdForOwnerMock.mockReset();
  totalsForAgentMock.mockReset();
  recentForAgentMock.mockReset();
  app = await buildServer(parseEnv(ENV));
});

describe('GET /v1/agents/:id/usage', () => {
  it('401 sin token', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/agents/${AGENT_ID}/usage` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(totalsForAgentMock).not.toHaveBeenCalled();
  });

  it('404 si el agente no es del owner', async () => {
    getByIdForOwnerMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/agents/${AGENT_ID}/usage`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(getByIdForOwnerMock).toHaveBeenCalledWith(AGENT_ID, 'user-1');
    expect(totalsForAgentMock).not.toHaveBeenCalled();
    expect(recentForAgentMock).not.toHaveBeenCalled();
  });

  it('200 con token valido: devuelve totals y recent consultados con el id del agente', async () => {
    getByIdForOwnerMock.mockResolvedValue({ id: AGENT_ID, name: 'Cotizador', ownerId: 'user-1' });
    const totals = { runs: 7, completed: 5, errors: 2, inputTokens: 120, outputTokens: 45 };
    const recent = [
      {
        id: 'r1',
        status: 'completed',
        errorCode: null,
        inputTokens: 5,
        outputTokens: 3,
        durationMs: 240,
        createdAt: '2026-06-10T12:00:00.000Z',
      },
    ];
    totalsForAgentMock.mockResolvedValue(totals);
    recentForAgentMock.mockResolvedValue(recent);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/agents/${AGENT_ID}/usage`,
      headers: { authorization: 'Bearer valid-user-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ totals, recent });
    expect(totalsForAgentMock).toHaveBeenCalledWith(AGENT_ID);
    expect(recentForAgentMock).toHaveBeenCalledWith(AGENT_ID);
  });
});
