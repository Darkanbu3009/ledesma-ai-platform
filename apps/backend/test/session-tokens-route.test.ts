import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getByIdMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
}));

// Repositorio y cliente sql mockeados: no se toca DB real (mismo patron que run-agent-by-id.test.ts).
vi.mock('../src/agents/agent-repository.js', () => ({
  AgentRepository: class {
    getById = getByIdMock;
  },
}));
vi.mock('../src/db/client.js', () => ({ getSql: vi.fn(() => ({})), setSqlForTesting: vi.fn() }));

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';
import { verifySessionToken } from '../src/auth/session-token.js';
import type { FastifyInstance } from 'fastify';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const AGENT_ID = '0b9f2c4e-5a1d-4f3b-9c8e-7d6a5b4c3f2e';

const storedAgent = {
  id: AGENT_ID,
  name: 'Cotizador',
  description: '',
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
  systemPrompt: '',
  maxTokens: 512,
  temperature: null,
  baseUrl: null,
  tools: [],
  ownerId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let app: FastifyInstance;

beforeEach(async () => {
  getByIdMock.mockReset();
  app = await buildServer(
    parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://x',
      ADMIN_API_TOKEN: 'test-admin-token-1234567890',
      SUPABASE_URL: 'https://x.supabase.co',
      SESSION_TOKEN_SECRET: SESSION_SECRET, VAULT_SECRET: SESSION_SECRET,
    }),
  );
});

describe('POST /v1/session-tokens', () => {
  it('rechaza con 400 si falta el header x-provider-key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/session-tokens',
      payload: { agentId: AGENT_ID },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  it('rechaza con 400 si el agentId no es uuid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/session-tokens',
      headers: { 'x-provider-key': 'sk-integrador' },
      payload: { agentId: 'no-es-uuid' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  it('responde 404 si el agente no existe', async () => {
    getByIdMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/session-tokens',
      headers: { 'x-provider-key': 'sk-integrador' },
      payload: { agentId: AGENT_ID },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(getByIdMock).toHaveBeenCalledWith(AGENT_ID);
  });

  it('responde 200 con { token, expiresAt } y el token es verificable con el mismo secreto', async () => {
    getByIdMock.mockResolvedValue(storedAgent);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/session-tokens',
      headers: { 'x-provider-key': 'sk-integrador-mint' },
      payload: { agentId: AGENT_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; expiresAt: string };
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // El token cifra la key del header, atada al agentId: roundtrip con el mismo secreto.
    expect(verifySessionToken(body.token, AGENT_ID, SESSION_SECRET)).toEqual({
      providerKey: 'sk-integrador-mint',
    });
  });
});
