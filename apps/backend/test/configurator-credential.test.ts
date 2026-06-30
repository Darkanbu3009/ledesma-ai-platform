import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ProviderStreamEvent } from '@ledesma-platform/shared';
import type { ModelCallInput } from '../src/providers/index.js';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import type { ProviderCredentialRepository } from '../src/credentials/provider-credential-repository.js';
import { configuratorRoutes } from '../src/routes/configurator.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';

// Integracion de la BOVEDA con el Configurador: ademas de la key al momento (x-provider-key), acepta
// una credencial GUARDADA via x-credential-id. Aqui se prueban resolucion, precedencia y aislamiento.

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: 'vault-secret-de-test-distinto-y-de-32+chars',
};

const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    throw new Error('invalid');
  },
};

function fakeRunModel(text: string, calls: ModelCallInput[] = []) {
  return (input: ModelCallInput): AsyncIterable<ProviderStreamEvent> => {
    calls.push(input);
    return (async function* () {
      yield { type: 'text_delta', text } as ProviderStreamEvent;
      yield { type: 'stop', reason: 'end_turn' } as ProviderStreamEvent;
    })();
  };
}

const okOutput = JSON.stringify({
  reply: 'Listo.',
  spec: { name: 'Soporte', providerId: 'anthropic', model: 'claude-sonnet-4-6' },
  complete: true,
});

const CRED_ID = '11111111-1111-4111-8111-111111111111';

async function makeApp(opts: {
  runModel?: (input: ModelCallInput) => AsyncIterable<ProviderStreamEvent>;
  getDecryptedKeyForOwner?: ReturnType<typeof vi.fn>;
}): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  const credentialRepo = {
    getDecryptedKeyForOwner: opts.getDecryptedKeyForOwner ?? vi.fn(),
  } as unknown as ProviderCredentialRepository;
  await app.register(
    configuratorRoutes(config, {
      verifier,
      ...(opts.runModel ? { runModel: opts.runModel } : {}),
      credentialRepo,
    }),
  );
  return app;
}

const baseBody = {
  messages: [{ role: 'user', content: 'Quiero un agente' }],
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
};

describe('Configurador + credencial guardada (x-credential-id)', () => {
  it('sin key al momento: resuelve la credencial del usuario y usa su apiKey/providerId/baseUrl', async () => {
    const calls: ModelCallInput[] = [];
    const getDecrypted = vi.fn(async () => ({ apiKey: 'sk-GUARDADA-openai', providerId: 'openai', baseUrl: null }));
    const app = await makeApp({ runModel: fakeRunModel(okOutput, calls), getDecryptedKeyForOwner: getDecrypted });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-credential-id': CRED_ID },
      payload: baseBody,
    });

    expect(res.statusCode).toBe(200);
    // Se resolvio la credencial del usuario autenticado (user-1), no de otro.
    expect(getDecrypted).toHaveBeenCalledWith('user-1', CRED_ID, BASE.VAULT_SECRET);
    // La key descifrada y el providerId de la credencial llegan a la capa de modelo; el model del body.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.credentials.apiKey).toBe('sk-GUARDADA-openai');
    expect(calls[0]?.providerId).toBe('openai');
    expect(calls[0]?.request.modelConfig.model).toBe('claude-sonnet-4-6');
  });

  it('credencial openai-compatible guardada: usa su baseUrl', async () => {
    const calls: ModelCallInput[] = [];
    const getDecrypted = vi.fn(async () => ({ apiKey: 'sk-compat', providerId: 'openai-compatible', baseUrl: 'https://llm.example.com/v1' }));
    const app = await makeApp({ runModel: fakeRunModel(okOutput, calls), getDecryptedKeyForOwner: getDecrypted });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-credential-id': CRED_ID },
      payload: baseBody,
    });

    expect(res.statusCode).toBe(200);
    expect(calls[0]?.providerId).toBe('openai-compatible');
    expect(calls[0]?.credentials.apiKey).toBe('sk-compat');
    expect(calls[0]?.credentials.baseUrl).toBe('https://llm.example.com/v1');
  });

  it('PRECEDENCIA: con x-provider-key Y x-credential-id, gana la key al momento (no toca la boveda)', async () => {
    const calls: ModelCallInput[] = [];
    const getDecrypted = vi.fn(async () => ({ apiKey: 'sk-GUARDADA', providerId: 'openai', baseUrl: null }));
    const app = await makeApp({ runModel: fakeRunModel(okOutput, calls), getDecryptedKeyForOwner: getDecrypted });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': 'sk-AL-MOMENTO', 'x-credential-id': CRED_ID },
      payload: baseBody,
    });

    expect(res.statusCode).toBe(200);
    expect(getDecrypted).not.toHaveBeenCalled();
    expect(calls[0]?.credentials.apiKey).toBe('sk-AL-MOMENTO');
    expect(calls[0]?.providerId).toBe('anthropic'); // providerId del body, no de la boveda
  });

  it('sin x-provider-key ni x-credential-id -> 400 claro', async () => {
    const app = await makeApp({ runModel: fakeRunModel(okOutput) });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: baseBody,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/x-provider-key.*x-credential-id|x-credential-id/);
  });

  it('AISLAMIENTO: credencial ajena/inexistente -> 404, nunca la key de otro', async () => {
    const calls: ModelCallInput[] = [];
    const getDecrypted = vi.fn(async () => null); // el repo no resuelve la fila de otro owner
    const app = await makeApp({ runModel: fakeRunModel(okOutput, calls), getDecryptedKeyForOwner: getDecrypted });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-credential-id': CRED_ID },
      payload: baseBody,
    });

    expect(res.statusCode).toBe(404);
    expect(calls).toHaveLength(0); // jamas se llamo al modelo
  });

  it('x-credential-id pero sin JWT -> 401 (la credencial guardada requiere identidad de usuario)', async () => {
    const getDecrypted = vi.fn(async () => ({ apiKey: 'sk-x', providerId: 'openai', baseUrl: null }));
    const app = await makeApp({ runModel: fakeRunModel(okOutput), getDecryptedKeyForOwner: getDecrypted });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { 'x-credential-id': CRED_ID },
      payload: baseBody,
    });
    expect(res.statusCode).toBe(401);
    expect(getDecrypted).not.toHaveBeenCalled();
  });
});
