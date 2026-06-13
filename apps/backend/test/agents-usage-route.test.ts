import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getByIdForOwnerMock, totalsForAgentMock, recentForAgentMock, runsByDayMock } = vi.hoisted(() => ({
  getByIdForOwnerMock: vi.fn(),
  totalsForAgentMock: vi.fn(),
  recentForAgentMock: vi.fn(),
  runsByDayMock: vi.fn(),
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
    runsByDay = runsByDayMock;
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

const ENV = { NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' };
const AGENT_ID = '11111111-1111-1111-1111-111111111111';

let app: FastifyInstance;
beforeEach(async () => {
  getByIdForOwnerMock.mockReset();
  totalsForAgentMock.mockReset();
  recentForAgentMock.mockReset();
  runsByDayMock.mockReset();
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

  it('200 con token valido: devuelve totals, recent y runsByDay consultados con el id del agente', async () => {
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
    const runsByDay = [{ date: '2026-06-10', runs: 7, inputTokens: 120, outputTokens: 45 }];
    totalsForAgentMock.mockResolvedValue(totals);
    recentForAgentMock.mockResolvedValue(recent);
    runsByDayMock.mockResolvedValue(runsByDay);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/agents/${AGENT_ID}/usage`,
      headers: { authorization: 'Bearer valid-user-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ totals, recent, runsByDay });
    // Sin query params el rango va vacio (sin acotar).
    expect(totalsForAgentMock).toHaveBeenCalledWith(AGENT_ID, { from: undefined, to: undefined });
    expect(recentForAgentMock).toHaveBeenCalledWith(AGENT_ID, { from: undefined, to: undefined });
    expect(runsByDayMock).toHaveBeenCalledWith(AGENT_ID, { from: undefined, to: undefined });
  });

  it('400 VALIDATION_ERROR si from no es un datetime ISO', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/agents/${AGENT_ID}/usage?from=ayer`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(getByIdForOwnerMock).not.toHaveBeenCalled();
    expect(totalsForAgentMock).not.toHaveBeenCalled();
    expect(recentForAgentMock).not.toHaveBeenCalled();
    expect(runsByDayMock).not.toHaveBeenCalled();
  });

  it('200 con from/to validos: pasa el rango como Date a los repos y responde runsByDay', async () => {
    getByIdForOwnerMock.mockResolvedValue({ id: AGENT_ID, name: 'Cotizador', ownerId: 'user-1' });
    const totals = { runs: 1, completed: 1, errors: 0, inputTokens: 5, outputTokens: 3 };
    const runsByDay = [{ date: '2026-06-10', runs: 1, inputTokens: 5, outputTokens: 3 }];
    totalsForAgentMock.mockResolvedValue(totals);
    recentForAgentMock.mockResolvedValue([]);
    runsByDayMock.mockResolvedValue(runsByDay);

    const from = '2026-06-01T00:00:00.000Z';
    const to = '2026-06-10T23:59:59.000Z';
    const res = await app.inject({
      method: 'GET',
      url: `/v1/agents/${AGENT_ID}/usage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runsByDay).toEqual(runsByDay);
    const range = { from: new Date(from), to: new Date(to) };
    expect(totalsForAgentMock).toHaveBeenCalledWith(AGENT_ID, range);
    expect(recentForAgentMock).toHaveBeenCalledWith(AGENT_ID, range);
    expect(runsByDayMock).toHaveBeenCalledWith(AGENT_ID, range);
  });

  it('200 con ceros cuando el agente no tiene corridas (no 500)', async () => {
    getByIdForOwnerMock.mockResolvedValue({ id: AGENT_ID, name: 'Cotizador', ownerId: 'user-1' });
    const totals = { runs: 0, completed: 0, errors: 0, inputTokens: 0, outputTokens: 0 };
    totalsForAgentMock.mockResolvedValue(totals);
    recentForAgentMock.mockResolvedValue([]);
    runsByDayMock.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/agents/${AGENT_ID}/usage`,
      headers: { authorization: 'Bearer valid-user-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ totals, recent: [], runsByDay: [] });
  });

  it('200 (no 500) con corridas de error de varios proveedores y tokens normalizados a 0', async () => {
    getByIdForOwnerMock.mockResolvedValue({ id: AGENT_ID, name: 'Cotizador', ownerId: 'user-1' });
    const totals = { runs: 6, completed: 2, errors: 3, inputTokens: 300, outputTokens: 80 };
    const recent = [
      { id: 'r1', status: 'error', errorCode: 'UPSTREAM_TIMEOUT', inputTokens: 0, outputTokens: 0, durationMs: 5000, createdAt: '2026-06-13T10:00:00.000Z' },
      { id: 'r2', status: 'completed', errorCode: null, inputTokens: 80, outputTokens: 30, durationMs: 300, createdAt: '2026-06-12T10:00:00.000Z' },
    ];
    const runsByDay = [{ date: '2026-06-13', runs: 3, inputTokens: 120, outputTokens: 0 }];
    totalsForAgentMock.mockResolvedValue(totals);
    recentForAgentMock.mockResolvedValue(recent);
    runsByDayMock.mockResolvedValue(runsByDay);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/agents/${AGENT_ID}/usage`,
      headers: { authorization: 'Bearer valid-user-1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.runs).toBe(6);
    expect(body.recent[0]).toMatchObject({ status: 'error', inputTokens: 0, outputTokens: 0 });
    expect(body.runsByDay).toEqual(runsByDay);
  });
});
