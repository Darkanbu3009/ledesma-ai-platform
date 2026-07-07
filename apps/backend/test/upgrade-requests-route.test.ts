import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { upgradeRequestRoutes } from '../src/routes/upgrade-requests.js';
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

const REQUEST_ID = '99999999-9999-4999-8999-999999999999';

// Verifier falso (sin red): user-1 y user-2 validos; cualquier otro token invalido.
const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    if (token === 'valid-user-2') return { id: 'user-2', email: 'u2@test.com' };
    throw new Error('invalid');
  },
};

const findPendingByOwnerAndTier = vi.fn();
const createRequest = vi.fn();
const listByOwner = vi.fn();

function makeRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    ownerId: 'user-1',
    requestedTier: 'autonomous',
    featureContext: 'scheduled_tasks',
    status: 'pending',
    note: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    upgradeRequestRoutes(config, {
      verifier,
      upgradeRepo: { findPendingByOwnerAndTier, createRequest, listByOwner },
    }),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  // Default feliz: no hay solicitud previa -> se crea una nueva (created:true).
  findPendingByOwnerAndTier.mockResolvedValue(null);
  createRequest.mockImplementation(async (input) => ({ upgradeRequest: makeRequestRow(input), created: true }));
  app = await makeApp();
});

const validBody = { requestedTier: 'autonomous', featureContext: 'scheduled_tasks' };

// ---------------------------------------------------------------------------------------------------
// AUTH: sin JWT no se registra nada
// ---------------------------------------------------------------------------------------------------

describe('auth: /v1/upgrade-requests sin JWT', () => {
  it('POST sin Authorization -> 401 (no crea nada)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/upgrade-requests', payload: validBody });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(findPendingByOwnerAndTier).not.toHaveBeenCalled();
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('POST con token invalido -> 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/upgrade-requests',
      headers: { authorization: 'Bearer no-sirve' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('GET /me sin Authorization -> 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/upgrade-requests/me' });
    expect(res.statusCode).toBe(401);
    expect(listByOwner).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------
// POST: crea la solicitud con el owner del token, tier y feature correctos
// ---------------------------------------------------------------------------------------------------

describe('POST /v1/upgrade-requests', () => {
  it('un free crea la solicitud: owner del token, tier y feature correctos, 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/upgrade-requests',
      headers: { authorization: 'Bearer valid-user-1' },
      // El body intenta colar un owner ajeno: debe IGNORARSE (owner sale del token).
      payload: { ...validBody, ownerId: 'OTRO-MALICIOSO', status: 'converted' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().created).toBe(true);

    const passed = createRequest.mock.calls[0]?.[0];
    expect(passed.ownerId).toBe('user-1'); // owner del token, jamas del body
    expect(passed.requestedTier).toBe('autonomous');
    expect(passed.featureContext).toBe('scheduled_tasks');
    // status/note del body se descartan (schema estrecho): no llegan al repo.
    expect(passed.status).toBeUndefined();
    expect(res.json().upgradeRequest.ownerId).toBe('user-1');
    expect(res.json().upgradeRequest.status).toBe('pending');
  });

  it('featureContext es OPCIONAL: sin feature crea igual (null), 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/upgrade-requests',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { requestedTier: 'autonomous' },
    });
    expect(res.statusCode).toBe(201);
    const passed = createRequest.mock.calls[0]?.[0];
    expect(passed.featureContext).toBeNull();
  });

  it('acepta requestedTier pro y cada featureContext valido', async () => {
    for (const featureContext of ['scheduled_tasks', 'triggers', 'recipes', 'configurator'] as const) {
      vi.clearAllMocks();
      findPendingByOwnerAndTier.mockResolvedValue(null);
      createRequest.mockImplementation(async (input) => ({ upgradeRequest: makeRequestRow(input), created: true }));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/upgrade-requests',
        headers: { authorization: 'Bearer valid-user-1' },
        payload: { requestedTier: 'pro', featureContext },
      });
      expect(res.statusCode).toBe(201);
      expect(createRequest.mock.calls[0]?.[0].requestedTier).toBe('pro');
      expect(createRequest.mock.calls[0]?.[0].featureContext).toBe(featureContext);
    }
  });

  it('el owner es el del TOKEN, no del body (no se crea a nombre de otro)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/upgrade-requests',
      headers: { authorization: 'Bearer valid-user-2' },
      payload: { ...validBody, ownerId: 'user-1' },
    });
    expect(res.statusCode).toBe(201);
    expect(createRequest.mock.calls[0]?.[0].ownerId).toBe('user-2');
  });
});

// ---------------------------------------------------------------------------------------------------
// VALIDACION: tier/feature invalidos -> 400, sin tocar el repo
// ---------------------------------------------------------------------------------------------------

describe('POST /v1/upgrade-requests: validacion', () => {
  it('requestedTier invalido (enterprise) -> 400 (no toca el repo)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/upgrade-requests',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { requestedTier: 'enterprise' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(findPendingByOwnerAndTier).not.toHaveBeenCalled();
    expect(createRequest).not.toHaveBeenCalled();
  });

  it("requestedTier 'free' -> 400 (free no se solicita)", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/upgrade-requests',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { requestedTier: 'free' },
    });
    expect(res.statusCode).toBe(400);
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('sin requestedTier -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/upgrade-requests',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { featureContext: 'triggers' },
    });
    expect(res.statusCode).toBe(400);
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('featureContext invalido -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/upgrade-requests',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { requestedTier: 'autonomous', featureContext: 'inexistente' },
    });
    expect(res.statusCode).toBe(400);
    expect(createRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------
// ANTI-DUPLICADO: dos POST del mismo user para el mismo tier no generan duplicados
// ---------------------------------------------------------------------------------------------------

describe('POST /v1/upgrade-requests: anti-duplicado', () => {
  it('si ya hay una pending del mismo tier -> devuelve la existente (200, created:false) sin crear otra', async () => {
    const existing = makeRequestRow({ id: 'existing-id' });
    findPendingByOwnerAndTier.mockResolvedValue(existing);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/upgrade-requests',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(false);
    expect(res.json().upgradeRequest.id).toBe('existing-id');
    expect(findPendingByOwnerAndTier).toHaveBeenCalledWith('user-1', 'autonomous');
    // NO se crea un duplicado.
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('dos POST seguidos del mismo user+tier: el segundo no crea duplicado', async () => {
    // Primer POST: no hay pending -> crea (201).
    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/upgrade-requests',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res1.statusCode).toBe(201);
    expect(createRequest).toHaveBeenCalledTimes(1);

    // Segundo POST: ahora ya existe una pending -> devuelve la existente (200), sin crear otra.
    findPendingByOwnerAndTier.mockResolvedValue(makeRequestRow());
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/upgrade-requests',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().created).toBe(false);
    // createRequest sigue habiendose llamado UNA sola vez (el segundo no creo nada).
    expect(createRequest).toHaveBeenCalledTimes(1);
  });

  it('carrera concurrente: si createRequest recupera la existente (created:false) -> 200, no 201 enganoso', async () => {
    // Pre-check no ve pending (ambos requests concurrentes leen null), pero el INSERT choca con el indice
    // unico parcial y el repo devuelve la existente con created:false. La ruta debe responder 200, no 201.
    findPendingByOwnerAndTier.mockResolvedValue(null);
    createRequest.mockResolvedValue({ upgradeRequest: makeRequestRow({ id: 'winner-id' }), created: false });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/upgrade-requests',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(false);
    expect(res.json().upgradeRequest.id).toBe('winner-id');
  });

  it('el anti-duplicado es por TIER: una pending de autonomous no bloquea una de pro', async () => {
    // Hay pending de 'autonomous' pero se pide 'pro' -> el lookup de pro devuelve null -> crea.
    findPendingByOwnerAndTier.mockImplementation(async (_owner: string, tier: string) =>
      tier === 'autonomous' ? makeRequestRow() : null,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/upgrade-requests',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { requestedTier: 'pro' },
    });
    expect(res.statusCode).toBe(201);
    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(createRequest.mock.calls[0]?.[0].requestedTier).toBe('pro');
  });
});

// ---------------------------------------------------------------------------------------------------
// GET /me: el usuario ve SOLO sus propias solicitudes
// ---------------------------------------------------------------------------------------------------

describe('GET /v1/upgrade-requests/me', () => {
  it('lista solo las del owner del token', async () => {
    listByOwner.mockResolvedValue([makeRequestRow()]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/upgrade-requests/me',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(listByOwner).toHaveBeenCalledWith('user-1');
    expect(res.json().upgradeRequests).toHaveLength(1);
  });

  it('user-2 consulta con su propio sub (aislamiento por owner)', async () => {
    listByOwner.mockResolvedValue([]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/upgrade-requests/me',
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(res.statusCode).toBe(200);
    expect(listByOwner).toHaveBeenCalledWith('user-2');
    expect(res.json().upgradeRequests).toEqual([]);
  });
});
