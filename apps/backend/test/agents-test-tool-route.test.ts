import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getByIdForOwnerMock } = vi.hoisted(() => ({
  getByIdForOwnerMock: vi.fn(),
}));

vi.mock('../src/agents/agent-repository.js', () => ({
  AgentRepository: class {
    getByIdForOwner = getByIdForOwnerMock;
  },
}));
vi.mock('../src/db/client.js', () => ({ getSql: vi.fn(() => ({})), setSqlForTesting: vi.fn() }));

// Mismo patron que agents-route.test.ts: verifier real con jose mockeado.
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: vi.fn(async (token: string) => {
    if (token === 'valid-user-1') return { payload: { sub: 'user-1', email: 'u1@test.com' } };
    if (token === 'valid-user-2') return { payload: { sub: 'user-2', email: 'u2@test.com' } };
    throw new Error('invalid');
  }),
}));

// DNS fijado a una IP publica: la guarda anti-SSRF (ip-guard) no depende de la red en tests
// y los hostnames de los webhooks de prueba no existen fuera del sandbox.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '34.107.221.82', family: 4 }]),
}));

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';
import { signWebhookPayload, verifyWebhookSignature } from '../src/tools/webhook-signature.js';
import type { FastifyInstance } from 'fastify';

const ENV = { NODE_ENV: 'test', DATABASE_URL: 'postgres://x', ADMIN_API_TOKEN: 'admin-token-1234567890', SUPABASE_URL: 'https://x.supabase.co', SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' };

const storedTool = {
  name: 'cotizar',
  description: 'Calcula el precio de N piezas',
  inputSchema: { type: 'object', properties: { piezas: { type: 'number' } } },
  url: 'https://hooks.cliente.com/cotizar',
};

const agent = {
  id: 'a1',
  name: 'Cotizador',
  description: '',
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
  systemPrompt: '',
  maxTokens: 512,
  temperature: null,
  baseUrl: null,
  tools: [storedTool],
  webhookSecret: 'whsec_secreto_del_agente_0123456789abcdef',
  ownerId: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let app: FastifyInstance;
beforeEach(async () => {
  getByIdForOwnerMock.mockReset();
  app = await buildServer(parseEnv(ENV));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /v1/agents/:id/tools/:toolName/test', () => {
  it('401 sin token', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/agents/a1/tools/cotizar/test', payload: { input: {} } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(getByIdForOwnerMock).not.toHaveBeenCalled();
  });

  it('404 si el agente es de otro owner', async () => {
    getByIdForOwnerMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agents/aX/tools/cotizar/test',
      headers: { authorization: 'Bearer valid-user-2' },
      payload: { input: {} },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(getByIdForOwnerMock).toHaveBeenCalledWith('aX', 'user-2');
  });

  it('404 si la tool no existe en el agente, sin llamar al webhook', async () => {
    getByIdForOwnerMock.mockResolvedValue(agent);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agents/a1/tools/inexistente/test',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { input: {} },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('200 ejecuta la tool guardada por el ejecutor firmado y regresa content/isError/durationMs', async () => {
    getByIdForOwnerMock.mockResolvedValue(agent);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: 'precio: 300 MXN' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agents/a1/tools/cotizar/test',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { input: { piezas: 2 } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe('precio: 300 MXN');
    expect(body.isError).toBe(false);
    expect(typeof body.durationMs).toBe('number');
    expect(body.durationMs).toBeGreaterThanOrEqual(0);

    // El webhook recibio EXACTAMENTE el input dado, firmado con el secreto del agente.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.cliente.com/cotizar',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tool: 'cotizar', input: { piezas: 2 } }),
      }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const ts = Number(headers['x-ledesma-timestamp']);
    expect(Number.isInteger(ts)).toBe(true);
    expect(headers['x-ledesma-signature']).toBe(
      `v1=${signWebhookPayload(String(init.body), ts, agent.webhookSecret)}`,
    );
    // La firma recibida por el webhook es verificable con el secreto del agente.
    const signature = headers['x-ledesma-signature']!.replace('v1=', '');
    expect(verifyWebhookSignature(String(init.body), ts, signature, agent.webhookSecret, 300, ts)).toBe(true);
  });

  it('200 con isError true y el DETALLE del error cuando el webhook falla en red', async () => {
    getByIdForOwnerMock.mockResolvedValue(agent);
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agents/a1/tools/cotizar/test',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { input: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isError).toBe(true);
    expect(body.content).toBe('Tool cotizar webhook failed: Error: ECONNREFUSED');
  });

  it('200 con webhook secret missing si el agente carga sin webhookSecret (fila de DB sin la columna), sin tocar la red', async () => {
    // Lo que produce una base sin la migracion V004 con un select *: la columna no viene y el
    // agente sale con webhookSecret undefined. El ejecutor debe reportarlo claro, sin lanzar.
    getByIdForOwnerMock.mockResolvedValue({ ...agent, webhookSecret: undefined });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agents/a1/tools/cotizar/test',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { input: {} },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isError).toBe(true);
    expect(body.content).toBe('Tool cotizar cannot run: webhook secret missing');
    expect(typeof body.durationMs).toBe('number');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
