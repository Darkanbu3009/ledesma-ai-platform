import { describe, it, expect, vi, beforeEach } from 'vitest';

// Integracion de la BOVEDA con el runtime /v1/run/:agentId. El widget publico (x-session-token /
// x-provider-key, SIN JWT) no cambia; se AGREGA una rama: x-credential-id + JWT -> credencial guardada
// del usuario. Aqui se prueban resolucion, precedencia, aislamiento y que el widget sigue intacto.

const { runModelMock, getByIdMock, getDecryptedKeyForOwnerMock } = vi.hoisted(() => ({
  runModelMock: vi.fn(),
  getByIdMock: vi.fn(),
  getDecryptedKeyForOwnerMock: vi.fn(),
}));

vi.mock('../src/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/providers/index.js')>();
  return { ...actual, runModel: runModelMock };
});
vi.mock('../src/agents/agent-repository.js', () => ({
  AgentRepository: class {
    getById = getByIdMock;
  },
}));
vi.mock('../src/credentials/provider-credential-repository.js', () => ({
  ProviderCredentialRepository: class {
    getDecryptedKeyForOwner = getDecryptedKeyForOwnerMock;
  },
}));
vi.mock('../src/db/client.js', () => ({ getSql: vi.fn(() => ({})), setSqlForTesting: vi.fn() }));

// jose mockeado: valid-user-1 valido; cualquier otro token invalido.
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: vi.fn(async (token: string) => {
    if (token === 'valid-user-1') return { payload: { sub: 'user-1', email: 'u1@test.com' } };
    throw new Error('invalid');
  }),
}));

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';
import { createSessionToken } from '../src/auth/session-token.js';
import type { FastifyInstance } from 'fastify';
import type { ProviderStreamEvent } from '@ledesma-platform/shared';

function streamOf(events: ProviderStreamEvent[]): AsyncIterable<ProviderStreamEvent> {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

const AGENT_ID = '0b9f2c4e-5a1d-4f3b-9c8e-7d6a5b4c3f2e';
const CRED_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VAULT_SECRET = 'vault-secret-de-test-distinto-y-de-32+chars';

const anthropicAgent = {
  id: AGENT_ID,
  name: 'Cotizador',
  description: '',
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
  systemPrompt: 'Eres cotizador',
  maxTokens: 512,
  temperature: 0.3,
  baseUrl: null,
  tools: [],
  webhookSecret: 'whsec_secreto_del_agente_0123456789abcdef',
  ownerId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// Agente openai-compatible: tiene su PROPIO baseUrl. Sirve para verificar que el baseUrl de una
// credencial guardada (su endpoint atado a la key) manda sobre el del agente.
const compatAgent = {
  ...anthropicAgent,
  providerId: 'openai-compatible',
  model: 'modelo-compat',
  baseUrl: 'https://endpoint-del-agente.test/v1',
};

const ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'test-admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: SESSION_SECRET,
  VAULT_SECRET,
};

let app: FastifyInstance;
beforeEach(async () => {
  runModelMock.mockReset();
  getByIdMock.mockReset();
  getDecryptedKeyForOwnerMock.mockReset();
  runModelMock.mockReturnValue(
    streamOf([
      { type: 'text_delta', text: 'Hola' },
      { type: 'stop', reason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 } },
    ]),
  );
  getByIdMock.mockResolvedValue(anthropicAgent);
  app = await buildServer(parseEnv(ENV));
});

const body = { messages: [{ role: 'user', content: 'hola' }] };

describe('POST /v1/run/:agentId + credencial guardada', () => {
  it('JWT + x-credential-id: usa la apiKey descifrada de la boveda (agente sigue autoritativo)', async () => {
    getDecryptedKeyForOwnerMock.mockResolvedValue({ apiKey: 'sk-GUARDADA-del-usuario', providerId: 'anthropic', baseUrl: null });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { authorization: 'Bearer valid-user-1', 'x-credential-id': CRED_ID },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(getDecryptedKeyForOwnerMock).toHaveBeenCalledWith('user-1', CRED_ID, VAULT_SECRET);
    expect(runModelMock.mock.calls[0]?.[0]?.credentials?.apiKey).toBe('sk-GUARDADA-del-usuario');
    expect(runModelMock.mock.calls[0]?.[0]?.providerId).toBe('anthropic');
  });

  it('PRECEDENCIA: x-provider-key gana sobre x-credential-id (no toca la boveda)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': 'sk-AL-MOMENTO', 'x-credential-id': CRED_ID },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(getDecryptedKeyForOwnerMock).not.toHaveBeenCalled();
    expect(runModelMock.mock.calls[0]?.[0]?.credentials?.apiKey).toBe('sk-AL-MOMENTO');
  });

  it('WIDGET INTACTO: x-session-token sigue funcionando sin tocar la boveda', async () => {
    const { token } = createSessionToken({ agentId: AGENT_ID, providerKey: 'sk-DEL-TOKEN' }, SESSION_SECRET);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-session-token': token },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(getDecryptedKeyForOwnerMock).not.toHaveBeenCalled();
    expect(runModelMock.mock.calls[0]?.[0]?.credentials?.apiKey).toBe('sk-DEL-TOKEN');
  });

  it('x-credential-id SIN JWT -> 401 (la credencial guardada requiere identidad de usuario)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-credential-id': CRED_ID },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(getDecryptedKeyForOwnerMock).not.toHaveBeenCalled();
    expect(runModelMock).not.toHaveBeenCalled();
  });

  it('AISLAMIENTO: credencial ajena/inexistente -> 404, nunca la key de otro', async () => {
    getDecryptedKeyForOwnerMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { authorization: 'Bearer valid-user-1', 'x-credential-id': CRED_ID },
      payload: body,
    });
    expect(res.statusCode).toBe(404);
    expect(runModelMock).not.toHaveBeenCalled();
  });

  it('sin ninguna fuente de key -> 400 claro', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/run/${AGENT_ID}`, payload: body });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('MISMATCH: credencial de otro proveedor que el agente -> 400 claro, NO ejecuta', async () => {
    // Agente anthropic (default) + credencial openai: la key NUNCA debe mandarse al endpoint del agente.
    getDecryptedKeyForOwnerMock.mockResolvedValue({
      apiKey: 'sk-openai-de-otro-proveedor',
      providerId: 'openai',
      baseUrl: null,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { authorization: 'Bearer valid-user-1', 'x-credential-id': CRED_ID },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.message).toContain('openai');
    expect(res.json().error.message).toContain('anthropic');
    expect(runModelMock).not.toHaveBeenCalled();
  });

  it('MATCH openai-compatible: el baseUrl de la credencial guardada manda sobre el del agente', async () => {
    getByIdMock.mockResolvedValue(compatAgent);
    getDecryptedKeyForOwnerMock.mockResolvedValue({
      apiKey: 'sk-compat-guardada',
      providerId: 'openai-compatible',
      baseUrl: 'https://endpoint-de-la-credencial.test/v1',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { authorization: 'Bearer valid-user-1', 'x-credential-id': CRED_ID },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(runModelMock.mock.calls[0]?.[0]?.providerId).toBe('openai-compatible');
    expect(runModelMock.mock.calls[0]?.[0]?.credentials?.apiKey).toBe('sk-compat-guardada');
    expect(runModelMock.mock.calls[0]?.[0]?.credentials?.baseUrl).toBe(
      'https://endpoint-de-la-credencial.test/v1',
    );
  });

  it('MATCH openai-compatible: si la credencial no trae baseUrl, cae al del agente', async () => {
    getByIdMock.mockResolvedValue(compatAgent);
    getDecryptedKeyForOwnerMock.mockResolvedValue({
      apiKey: 'sk-compat-sin-baseurl',
      providerId: 'openai-compatible',
      baseUrl: null,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { authorization: 'Bearer valid-user-1', 'x-credential-id': CRED_ID },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(runModelMock.mock.calls[0]?.[0]?.credentials?.baseUrl).toBe(
      'https://endpoint-del-agente.test/v1',
    );
  });

  it('KEY AL MOMENTO en agente openai-compatible: usa el baseUrl del agente (camino intacto)', async () => {
    // x-provider-key no trae providerId/baseUrl: el agente sigue siendo autoritativo, sin validacion.
    getByIdMock.mockResolvedValue(compatAgent);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/run/${AGENT_ID}`,
      headers: { 'x-provider-key': 'sk-al-momento' },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(getDecryptedKeyForOwnerMock).not.toHaveBeenCalled();
    expect(runModelMock.mock.calls[0]?.[0]?.credentials?.apiKey).toBe('sk-al-momento');
    expect(runModelMock.mock.calls[0]?.[0]?.credentials?.baseUrl).toBe(
      'https://endpoint-del-agente.test/v1',
    );
  });
});
