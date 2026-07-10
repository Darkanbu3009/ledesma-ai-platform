import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { subscriptionRoutes } from '../src/routes/subscription.js';
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

// Verifier falso (sin red): user-1 y user-2 validos; cualquier otro token invalido.
const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    if (token === 'valid-user-2') return { id: 'user-2', email: 'u2@test.com' };
    throw new Error('invalid');
  },
};

const selectPlan = vi.fn();

/** Estado consolidado (forma de GET /v1/me) que devuelve el repo tras activar un plan. */
function stateFor(ownerId: string, planId: string, tier: string) {
  return {
    needsRegistration: false,
    profile: {
      id: ownerId,
      orgId: null,
      accountType: 'individual',
      role: 'individual',
      fullName: 'Ada',
      identityVerified: false,
      tier,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    organization: null,
    subscription: {
      id: 's1',
      profileId: ownerId,
      plan: planId,
      status: 'active',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
    usageCounter: null,
    isAdmin: false,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(subscriptionRoutes(config, { verifier, registrationRepo: { selectPlan } }));
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  selectPlan.mockImplementation(async (ownerId: string, plan: { id: string; tier: string }) =>
    stateFor(ownerId, plan.id, plan.tier),
  );
  app = await makeApp();
});

describe('auth: POST /v1/subscription/select sin JWT', () => {
  it('sin Authorization -> 401 (no escribe nada)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscription/select',
      payload: { planId: 'pro' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(selectPlan).not.toHaveBeenCalled();
  });

  it('con token invalido -> 401 (no escribe nada)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscription/select',
      headers: { authorization: 'Bearer no-sirve' },
      payload: { planId: 'pro' },
    });
    expect(res.statusCode).toBe(401);
    expect(selectPlan).not.toHaveBeenCalled();
  });
});

describe('POST /v1/subscription/select', () => {
  it('elegir Pro activa el plan del OWNER DEL TOKEN: escribe plan pro + tier pro y responde el estado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscription/select',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { planId: 'pro' },
    });
    expect(res.statusCode).toBe(200);
    // La definicion completa (tier incluido) sale del MODULO CENTRAL, jamas del cliente.
    expect(selectPlan).toHaveBeenCalledTimes(1);
    expect(selectPlan).toHaveBeenCalledWith('user-1', expect.objectContaining({ id: 'pro', tier: 'pro' }));
    const body = res.json();
    expect(body.subscription).toMatchObject({ plan: 'pro', status: 'active' });
    expect(body.profile).toMatchObject({ tier: 'pro' });
  });

  it('elegir Business escribe el tier autonomous (mapeo del modulo central)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscription/select',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { planId: 'business' },
    });
    expect(res.statusCode).toBe(200);
    expect(selectPlan).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ id: 'business', tier: 'autonomous' }),
    );
  });

  it('bajar a Free tambien es self-service: escribe plan free + tier free', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscription/select',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { planId: 'free' },
    });
    expect(res.statusCode).toBe(200);
    expect(selectPlan).toHaveBeenCalledWith('user-1', expect.objectContaining({ id: 'free', tier: 'free' }));
    expect(res.json().profile).toMatchObject({ tier: 'free' });
  });

  it('AISLAMIENTO: el owner sale del token; un ownerId/tier colado en el body se DESCARTA', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscription/select',
      headers: { authorization: 'Bearer valid-user-2' },
      // Intenta cambiarle el plan a otro usuario y forzar un tier arbitrario: ambos se ignoran.
      payload: { planId: 'pro', ownerId: 'user-1', profileId: 'user-1', tier: 'autonomous' },
    });
    expect(res.statusCode).toBe(200);
    expect(selectPlan).toHaveBeenCalledTimes(1);
    // Se escribe para user-2 (el del token) y con el tier que define el modulo central para Pro.
    expect(selectPlan).toHaveBeenCalledWith('user-2', expect.objectContaining({ id: 'pro', tier: 'pro' }));
  });

  it('planId fuera de la lista cerrada -> 400 sin escribir (cero confianza en texto libre)', async () => {
    for (const planId of ['enterprise', 'autonomous', '', null, 42]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/subscription/select',
        headers: { authorization: 'Bearer valid-user-1' },
        payload: { planId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect(selectPlan).not.toHaveBeenCalled();
  });

  it('body sin planId -> 400 sin escribir', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscription/select',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(selectPlan).not.toHaveBeenCalled();
  });

  it('IDEMPOTENTE: reelegir el plan actual responde 200 con el mismo estado, sin efectos raros', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/subscription/select',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { planId: 'pro' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/subscription/select',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { planId: 'pro' },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(selectPlan).toHaveBeenCalledTimes(2);
  });

  it('usuario sin perfil (registro incompleto) -> 404', async () => {
    selectPlan.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscription/select',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { planId: 'pro' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
