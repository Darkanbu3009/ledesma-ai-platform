import { describe, it, expect, vi } from 'vitest';
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

  it('modo asistente (default, sin campo mode): no lee el tier ni crea agente (intacto para todos)', async () => {
    const { app, getProfileTier, create } = await makeAutoApp(okOutput, 'free');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': PROVIDER_KEY },
      payload: validBody, // sin mode -> 'assistant'
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.validation.ok).toBe(true);
    // El modo asistente nunca toca el gate ni la creacion automatica.
    expect(getProfileTier).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(body.autonomous).toBeUndefined();
  });
});

// Spec ESTRICTAMENTE valido (name+providerId+model+systemPrompt+description): el modo autonomo lo crea.
const strictOutput = JSON.stringify({
  reply: 'Listo, cree tu agente.',
  spec: {
    name: 'Soporte',
    providerId: 'anthropic',
    model: 'claude-sonnet-4-6',
    description: 'Atiende consultas de clientes.',
    systemPrompt: 'Sos un agente de soporte amable y preciso.',
  },
  complete: true,
});

// Spec que valida (validateAgentSpec.ok) pero NO es estrictamente valido: le falta systemPrompt y
// description. El modo autonomo NO lo crea; cae de vuelta a la conversacion.
const incompleteOutput = JSON.stringify({
  reply: 'Contame un poco mas sobre lo que tiene que hacer.',
  spec: { name: 'Soporte', providerId: 'anthropic', model: 'claude-sonnet-4-6' },
  complete: true,
});

/**
 * App con los repos inyectados para el modo autonomo: el tier (gate server-side) y el create del
 * agente (reuso del flujo de creacion). Devuelve los mocks para afirmar sobre ellos.
 */
async function makeAutoApp(
  modelOutput: string,
  tier: 'free' | 'pro' | 'autonomous' | null,
): Promise<{
  app: FastifyInstance;
  getProfileTier: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  calls: ModelCallInput[];
}> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  const calls: ModelCallInput[] = [];
  const getProfileTier = vi.fn().mockResolvedValue(tier);
  const create = vi.fn().mockResolvedValue({ id: 'agent-xyz', name: 'Soporte', ownerId: 'user-1' });
  const deps = {
    verifier,
    runModel: fakeRunModel(modelOutput, calls),
    agentRepo: { create },
    registrationRepo: { getProfileTier },
  };
  await app.register(configuratorRoutes(config, deps as Parameters<typeof configuratorRoutes>[1]));
  return { app, getProfileTier, create, calls };
}

const autonomousBody = { ...validBody, mode: 'autonomous' };

describe('POST /v1/configurator/message (modo autonomo)', () => {
  it('tier free intentando modo autonomo -> 403 (gate server-side); no llama al modelo ni crea', async () => {
    const { app, getProfileTier, create, calls } = await makeAutoApp(strictOutput, 'free');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': PROVIDER_KEY },
      payload: autonomousBody,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(getProfileTier).toHaveBeenCalledWith('user-1');
    // El gate corta ANTES del modelo y de la creacion.
    expect(calls).toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('tier pro intentando modo autonomo -> 403', async () => {
    const { app, create } = await makeAutoApp(strictOutput, 'pro');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': PROVIDER_KEY },
      payload: autonomousBody,
    });
    expect(res.statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('sin perfil (tier null) intentando modo autonomo -> 403', async () => {
    const { app } = await makeAutoApp(strictOutput, null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': PROVIDER_KEY },
      payload: autonomousBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it('tier autonomous + spec ESTRICTAMENTE valido -> crea el agente (reusa create con owner = usuario)', async () => {
    const { app, create } = await makeAutoApp(strictOutput, 'autonomous');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': PROVIDER_KEY },
      payload: autonomousBody,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.autonomous.created).toBe(true);
    expect(body.autonomous.agent.id).toBe('agent-xyz');
    expect(body.autonomous.validation.ok).toBe(true);
    // Reusa el flujo de creacion: owner SIEMPRE = usuario autenticado.
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Soporte',
        providerId: 'anthropic',
        model: 'claude-sonnet-4-6',
        description: 'Atiende consultas de clientes.',
        systemPrompt: 'Sos un agente de soporte amable y preciso.',
        ownerId: 'user-1',
      }),
    );
  });

  it('tier autonomous + spec que valida pero NO es estricto -> NO crea, cae a conversacion', async () => {
    const { app, create } = await makeAutoApp(incompleteOutput, 'autonomous');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': PROVIDER_KEY },
      payload: autonomousBody,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.autonomous.created).toBe(false);
    expect(body.autonomous.agent).toBeNull();
    expect(body.autonomous.validation.ok).toBe(false);
    // Nunca crea un agente invalido.
    expect(create).not.toHaveBeenCalled();
    // El turno sigue siendo conversacional: el reply esta presente para que el usuario continue.
    expect(typeof body.reply).toBe('string');
  });

  it('tier autonomous + salida del modelo no interpretable -> NO crea (spec null), turno manejable', async () => {
    const { app, create } = await makeAutoApp('no es json', 'autonomous');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/configurator/message',
      headers: { authorization: 'Bearer valid-user-1', 'x-provider-key': PROVIDER_KEY },
      payload: autonomousBody,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.autonomous.created).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
