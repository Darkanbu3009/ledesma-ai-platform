import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ProviderStreamEvent } from '@ledesma-platform/shared';
import type { ModelCallInput } from '../src/providers/index.js';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { configuratorRoutes } from '../src/routes/configurator.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

// Verifier falso (sin red): autentica un unico token de prueba; cualquier otro es invalido.
const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    throw new Error('invalid');
  },
};

/** runModel falso: emite el texto dado y un stop. Mockea el modelo (CI no llama al modelo real). */
function fakeRunModel(
  text: string,
  calls: ModelCallInput[] = [],
): (input: ModelCallInput) => AsyncIterable<ProviderStreamEvent> {
  return (input: ModelCallInput) => {
    calls.push(input);
    return (async function* (): AsyncIterable<ProviderStreamEvent> {
      yield { type: 'text_delta', text };
      yield { type: 'stop', reason: 'end_turn' };
    })();
  };
}

async function makeApp(
  runModel?: (input: ModelCallInput) => AsyncIterable<ProviderStreamEvent>,
): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  const deps = runModel ? { verifier, runModel } : { verifier };
  await app.register(configuratorRoutes(config, deps));
  return app;
}

// BYOK por request: la key NO va en el body (header x-provider-key); el proveedor y el modelo si.
const PROVIDER_KEY = 'sk-cliente-byok-123';
const validBody = {
  messages: [{ role: 'user', content: 'Quiero un agente de soporte' }],
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
};
const okOutput = JSON.stringify({
  reply: 'Listo, arme tu agente.',
  spec: { name: 'Soporte', providerId: 'anthropic', model: 'claude-sonnet-4-6' },
  complete: true,
});

describe('POST /v1/configurator/message', () => {
  it('401 sin Authorization', async () => {
    const app = await makeApp(fakeRunModel(okOutput));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { 'x-provider-key': PROVIDER_KEY },
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('401 con token invalido', async () => {
    const app = await makeApp(fakeRunModel(okOutput));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer nope', 'x-provider-key': PROVIDER_KEY },
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it('200 con credenciales validas en body+header: devuelve { reply, spec, validation } y usa la key por request', async () => {
    const calls: ModelCallInput[] = [];
    const app = await makeApp(fakeRunModel(okOutput, calls));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': PROVIDER_KEY },
      payload: validBody,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.reply).toBe('string');
    expect(body.spec).toEqual({ name: 'Soporte', providerId: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(body.validation.ok).toBe(true);

    // La key del header y el proveedor/modelo del body llegan a la capa de modelo (BYOK por request).
    expect(calls).toHaveLength(1);
    expect(calls[0]?.providerId).toBe('anthropic');
    expect(calls[0]?.credentials.apiKey).toBe(PROVIDER_KEY);
    expect(calls[0]?.request.modelConfig.model).toBe('claude-sonnet-4-6');
  });

  it('200 con openai-compatible: reenvia baseUrl del body en las credenciales', async () => {
    const calls: ModelCallInput[] = [];
    const app = await makeApp(fakeRunModel(okOutput, calls));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': PROVIDER_KEY },
      payload: {
        messages: [{ role: 'user', content: 'Quiero un agente' }],
        providerId: 'openai-compatible',
        model: 'llama-3.1',
        baseUrl: 'https://llm.example.com/v1',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(calls[0]?.providerId).toBe('openai-compatible');
    expect(calls[0]?.credentials.apiKey).toBe(PROVIDER_KEY);
    expect(calls[0]?.credentials.baseUrl).toBe('https://llm.example.com/v1');
  });

  it('falta x-provider-key -> 400 claro (BYOK), no 503 de plataforma', async () => {
    const app = await makeApp(fakeRunModel(okOutput));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.message).toMatch(/x-provider-key/);
  });

  it('openai-compatible sin baseUrl -> 400 VALIDATION_ERROR antes de llamar al modelo', async () => {
    const calls: ModelCallInput[] = [];
    const app = await makeApp(fakeRunModel(okOutput, calls));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': PROVIDER_KEY },
      payload: {
        messages: [{ role: 'user', content: 'Quiero un agente' }],
        providerId: 'openai-compatible',
        model: 'llama-3.1',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.json().error)).toMatch(/baseUrl/);
    // El modelo no se llega a invocar: la validacion corta antes.
    expect(calls).toHaveLength(0);
  });

  it('providerId invalido en el body -> 400 VALIDATION_ERROR', async () => {
    const app = await makeApp(fakeRunModel(okOutput));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': PROVIDER_KEY },
      payload: { messages: [{ role: 'user', content: 'hola' }], providerId: 'gemini', model: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('body sin mensajes -> 400 VALIDATION_ERROR', async () => {
    const app = await makeApp(fakeRunModel(okOutput));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': PROVIDER_KEY },
      payload: { messages: [], providerId: 'anthropic', model: 'claude-sonnet-4-6' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('salida del modelo no interpretable -> 200 con spec null y validation.ok=false (manejable)', async () => {
    const app = await makeApp(fakeRunModel('no es json'));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': PROVIDER_KEY },
      payload: validBody,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.spec).toBeNull();
    expect(body.validation.ok).toBe(false);
    expect(typeof body.reply).toBe('string');
  });
});
