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
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

// Verifier falso (sin red): autentica un unico token de prueba; cualquier otro es invalido.
const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    throw new Error('invalid');
  },
};

/** runModel falso: emite el texto dado y un stop. Mockea el modelo (CI no llama al modelo real). */
function fakeRunModel(text: string): (input: ModelCallInput) => AsyncIterable<ProviderStreamEvent> {
  return () =>
    (async function* (): AsyncIterable<ProviderStreamEvent> {
      yield { type: 'text_delta', text };
      yield { type: 'stop', reason: 'end_turn' };
    })();
}

async function makeApp(
  env: Record<string, string>,
  runModel?: (input: ModelCallInput) => AsyncIterable<ProviderStreamEvent>,
): Promise<FastifyInstance> {
  const config = parseEnv(env);
  const app = Fastify();
  registerErrorHandler(app, config);
  const deps = runModel ? { verifier, runModel } : { verifier };
  await app.register(configuratorRoutes(config, deps));
  return app;
}

const validBody = { messages: [{ role: 'user', content: 'Quiero un agente de soporte' }] };
const okOutput = JSON.stringify({
  reply: 'Listo, arme tu agente.',
  spec: { name: 'Soporte', providerId: 'anthropic', model: 'claude-sonnet-4-6' },
  complete: true,
});

describe('POST /v1/configurator/message', () => {
  it('401 sin Authorization', async () => {
    const app = await makeApp({ ...BASE, PLATFORM_ANTHROPIC_API_KEY: 'sk-plat' }, fakeRunModel(okOutput));
    const res = await app.inject({ method: 'POST', url: '/v1/configurator/message', payload: validBody });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('401 con token invalido', async () => {
    const app = await makeApp({ ...BASE, PLATFORM_ANTHROPIC_API_KEY: 'sk-plat' }, fakeRunModel(okOutput));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer nope' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it('200 con usuario autenticado: devuelve el shape { reply, spec, validation }', async () => {
    const app = await makeApp({ ...BASE, PLATFORM_ANTHROPIC_API_KEY: 'sk-plat' }, fakeRunModel(okOutput));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.reply).toBe('string');
    expect(body.spec).toEqual({ name: 'Soporte', providerId: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(body.validation.ok).toBe(true);
  });

  it('falta PLATFORM_ANTHROPIC_API_KEY -> 503 claro (no 500 opaco)', async () => {
    const app = await makeApp(BASE, fakeRunModel(okOutput));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.json().error.message).toMatch(/PLATFORM_ANTHROPIC_API_KEY/);
  });

  it('body sin mensajes -> 400 VALIDATION_ERROR', async () => {
    const app = await makeApp({ ...BASE, PLATFORM_ANTHROPIC_API_KEY: 'sk-plat' }, fakeRunModel(okOutput));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('salida del modelo no interpretable -> 200 con spec null y validation.ok=false (manejable)', async () => {
    const app = await makeApp({ ...BASE, PLATFORM_ANTHROPIC_API_KEY: 'sk-plat' }, fakeRunModel('no es json'));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.spec).toBeNull();
    expect(body.validation.ok).toBe(false);
    expect(typeof body.reply).toBe('string');
  });
});
