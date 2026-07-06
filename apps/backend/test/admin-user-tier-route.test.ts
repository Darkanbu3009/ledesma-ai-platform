import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { adminUserTierRoutes } from '../src/routes/admin-user-tier.js';
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

// Verifier falso (sin red): 'valid-admin' -> sub admin-1, 'valid-user' -> sub user-2; cualquier otro invalido.
const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-admin') return { id: 'admin-1', email: 'admin@test.com' };
    if (token === 'valid-user') return { id: 'user-2', email: 'user@test.com' };
    throw new Error('invalid');
  },
};

// El usuario OBJETIVO (:id). Un uuid valido y DISTINTO al del admin (admin-1): el :id es el target del
// cambio (cross-owner), no el que llama.
const TARGET = '22222222-2222-4222-8222-222222222222';

// El rol se lee server-side por sub: admin-1 es super-admin, cualquier otro NO.
const isAdmin = vi.fn(async (sub: string) => sub === 'admin-1');
const getProfileTier = vi.fn();
const updateProfileTier = vi.fn();
const recordAdminAction = vi.fn();

/** Perfil actualizado tal como lo devuelve RegistrationRepository.updateProfileTier (camelCase). */
function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET,
    orgId: null,
    accountType: 'individual',
    role: 'individual',
    fullName: 'Ada Lovelace',
    identityVerified: false,
    tier: 'autonomous',
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    adminUserTierRoutes(config, {
      verifier,
      repo: { isAdmin, getProfileTier, updateProfileTier, recordAdminAction },
    }),
  );
  return app;
}

function tierUrl(id: string = TARGET): string {
  return `/v1/admin/users/${id}/tier`;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  isAdmin.mockImplementation(async (sub: string) => sub === 'admin-1');
  getProfileTier.mockResolvedValue('free');
  updateProfileTier.mockResolvedValue(makeProfile());
  recordAdminAction.mockResolvedValue(undefined);
  app = await makeApp();
});

// ---------------------------------------------------------------------------------------------------
// AUTH: gate por ROL (la diferencia clave con el endpoint viejo por x-admin-token)
// ---------------------------------------------------------------------------------------------------

describe('auth: PUT /v1/admin/users/:id/tier (gate por rol)', () => {
  it('sin Authorization -> 401 (no cambia nada)', async () => {
    const res = await app.inject({ method: 'PUT', url: tierUrl(), payload: { tier: 'autonomous' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(updateProfileTier).not.toHaveBeenCalled();
    expect(recordAdminAction).not.toHaveBeenCalled();
  });

  it('token invalido -> 401 (ni siquiera lee el rol)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: tierUrl(),
      headers: { authorization: 'Bearer no-sirve' },
      payload: { tier: 'autonomous' },
    });
    expect(res.statusCode).toBe(401);
    expect(isAdmin).not.toHaveBeenCalled();
    expect(updateProfileTier).not.toHaveBeenCalled();
  });

  it('un usuario NO admin -> 403 FORBIDDEN (mutar el tier de cualquiera es exclusivo de admins)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: tierUrl(),
      headers: { authorization: 'Bearer valid-user' },
      payload: { tier: 'autonomous' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    // El rol se consulto con el sub del JWT verificado, no con el :id de la URL.
    expect(isAdmin).toHaveBeenCalledWith('user-2');
    // 403 antes de tocar los datos.
    expect(updateProfileTier).not.toHaveBeenCalled();
    expect(recordAdminAction).not.toHaveBeenCalled();
  });

  it('un x-admin-token NO sirve en este endpoint (el camino atribuible es por rol) -> 401', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: tierUrl(),
      headers: { 'x-admin-token': BASE.ADMIN_API_TOKEN },
      payload: { tier: 'autonomous' },
    });
    // Sin Bearer no hay JWT: requireAdminRole responde 401 (este endpoint no mira x-admin-token).
    expect(res.statusCode).toBe(401);
    expect(updateProfileTier).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------
// VALIDACION: :id uuid + body tier (siempre DESPUES del gate)
// ---------------------------------------------------------------------------------------------------

describe('PUT /v1/admin/users/:id/tier: validacion', () => {
  it(':id no-uuid -> 400 (no toca el repo)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/admin/users/no-es-uuid/tier',
      headers: { authorization: 'Bearer valid-admin' },
      payload: { tier: 'autonomous' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(updateProfileTier).not.toHaveBeenCalled();
    expect(getProfileTier).not.toHaveBeenCalled();
  });

  it('tier invalido -> 400 (no toca el repo)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: tierUrl(),
      headers: { authorization: 'Bearer valid-admin' },
      payload: { tier: 'enterprise' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(updateProfileTier).not.toHaveBeenCalled();
  });

  it('sin tier en el body -> 400 (no toca el repo)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: tierUrl(),
      headers: { authorization: 'Bearer valid-admin' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(updateProfileTier).not.toHaveBeenCalled();
  });

  it('un NO admin con :id no-uuid -> 403 (el gate corre ANTES de validar el :id)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/admin/users/no-es-uuid/tier',
      headers: { authorization: 'Bearer valid-user' },
      payload: { tier: 'autonomous' },
    });
    // 403, no 400: el gate no filtra informacion de validacion a un no-admin.
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(updateProfileTier).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------
// EFECTO + AUDIT ATRIBUIBLE: el corazon de este PR
// ---------------------------------------------------------------------------------------------------

describe('PUT /v1/admin/users/:id/tier: cambio atribuible + audit', () => {
  it('un admin cambia el tier: 200 { profile } y audit change_tier con el ACTOR REAL (sub del admin)', async () => {
    getProfileTier.mockResolvedValue('free'); // tier ACTUAL antes del cambio (from)
    updateProfileTier.mockResolvedValue(makeProfile({ tier: 'autonomous' }));

    const res = await app.inject({
      method: 'PUT',
      url: tierUrl(),
      headers: { authorization: 'Bearer valid-admin' },
      payload: { tier: 'autonomous' },
    });

    expect(res.statusCode).toBe(200);
    // Efecto y respuesta IDENTICOS al endpoint viejo: { profile } con el tier nuevo.
    expect(res.json().profile.tier).toBe('autonomous');
    // El cambio se aplico sobre el :id OBJETIVO, no sobre el admin que llama.
    expect(updateProfileTier).toHaveBeenCalledWith(TARGET, 'autonomous');

    // Invariante: el `from` se lee ANTES del update (si se leyera despues seria el tier NUEVO). Se afirma
    // el ORDEN real de invocacion. invocationCallOrder es 1-based; 0 es centinela de "no invocado".
    const fromOrder = getProfileTier.mock.invocationCallOrder[0] ?? 0;
    const updateOrder = updateProfileTier.mock.invocationCallOrder[0] ?? 0;
    expect(fromOrder).toBeGreaterThan(0);
    expect(updateOrder).toBeGreaterThan(fromOrder);

    // LA DIFERENCIA CLAVE con el endpoint viejo (actor null): actorId es el sub REAL del admin del JWT.
    expect(recordAdminAction).toHaveBeenCalledWith({
      actorId: 'admin-1',
      action: 'change_tier',
      targetId: TARGET,
      details: { from: 'free', to: 'autonomous' },
    });
  });

  it('404 si el usuario no existe (updateProfileTier -> null) y NO registra audit', async () => {
    updateProfileTier.mockResolvedValue(null);
    const res = await app.inject({
      method: 'PUT',
      url: tierUrl(),
      headers: { authorization: 'Bearer valid-admin' },
      payload: { tier: 'pro' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(updateProfileTier).toHaveBeenCalledWith(TARGET, 'pro');
    // Un 404 NO registra ninguna accion en el audit log (no hubo cambio).
    expect(recordAdminAction).not.toHaveBeenCalled();
  });

  it('acepta cada tier valido del enum (free/pro/autonomous) y audita el to correcto', async () => {
    for (const tier of ['free', 'pro', 'autonomous'] as const) {
      vi.clearAllMocks();
      getProfileTier.mockResolvedValue('free');
      updateProfileTier.mockResolvedValue(makeProfile({ tier }));
      recordAdminAction.mockResolvedValue(undefined);
      const res = await app.inject({
        method: 'PUT',
        url: tierUrl(),
        headers: { authorization: 'Bearer valid-admin' },
        payload: { tier },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().profile.tier).toBe(tier);
      expect(recordAdminAction).toHaveBeenCalledWith({
        actorId: 'admin-1',
        action: 'change_tier',
        targetId: TARGET,
        details: { from: 'free', to: tier },
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// BEST-EFFORT del audit: un fallo del log NO revierte el cambio de tier ya aplicado
// ---------------------------------------------------------------------------------------------------

describe('PUT /v1/admin/users/:id/tier: audit best-effort', () => {
  it('si recordAdminAction lanza, el cambio conserva su 200 y su { profile }', async () => {
    getProfileTier.mockResolvedValue('free');
    updateProfileTier.mockResolvedValue(makeProfile({ tier: 'autonomous' }));
    recordAdminAction.mockRejectedValue(new Error('audit boom'));

    const res = await app.inject({
      method: 'PUT',
      url: tierUrl(),
      headers: { authorization: 'Bearer valid-admin' },
      payload: { tier: 'autonomous' },
    });

    // El cambio de tier NO se rompe por el fallo del audit: misma respuesta.
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.tier).toBe('autonomous');
    expect(updateProfileTier).toHaveBeenCalledWith(TARGET, 'autonomous');
    expect(recordAdminAction).toHaveBeenCalledTimes(1);
  });

  it('si la lectura del tier previo (from) falla, el cambio NO se rompe (from queda null) y usa el actor real', async () => {
    // getProfileTier es maquinaria de auditoria (solo para el from): su fallo no debe abortar el update.
    getProfileTier.mockRejectedValue(new Error('read boom'));
    updateProfileTier.mockResolvedValue(makeProfile({ tier: 'autonomous' }));
    recordAdminAction.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'PUT',
      url: tierUrl(),
      headers: { authorization: 'Bearer valid-admin' },
      payload: { tier: 'autonomous' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().profile.tier).toBe('autonomous');
    expect(updateProfileTier).toHaveBeenCalledWith(TARGET, 'autonomous');
    // El cambio igual se audita, con from null (la lectura fallo) y el actor REAL del admin.
    expect(recordAdminAction).toHaveBeenCalledWith({
      actorId: 'admin-1',
      action: 'change_tier',
      targetId: TARGET,
      details: { from: null, to: 'autonomous' },
    });
  });
});
