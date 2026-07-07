import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { adminUpgradeRequestsRoutes } from '../src/routes/admin-upgrade-requests.js';
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

// El rol se lee server-side por sub: admin-1 es super-admin, cualquier otro NO.
const isAdmin = vi.fn(async (sub: string) => sub === 'admin-1');
const listAll = vi.fn();

function makeRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    ownerId: 'user-7',
    requestedTier: 'autonomous',
    featureContext: 'recipes',
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
    adminUpgradeRequestsRoutes(config, {
      verifier,
      upgradeRepo: { listAll },
      repo: { isAdmin },
    }),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  isAdmin.mockImplementation(async (sub: string) => sub === 'admin-1');
  listAll.mockResolvedValue({ items: [makeRequestRow()], total: 1 });
  app = await makeApp();
});

const URL = '/v1/admin/upgrade-requests';

// ---------------------------------------------------------------------------------------------------
// AUTH: gate por ROL (requireAdminRole)
// ---------------------------------------------------------------------------------------------------

describe('auth: GET /v1/admin/upgrade-requests (gate por rol)', () => {
  it('sin Authorization -> 401 (no lee nada)', async () => {
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(listAll).not.toHaveBeenCalled();
  });

  it('token invalido -> 401 (ni siquiera lee el rol)', async () => {
    const res = await app.inject({ method: 'GET', url: URL, headers: { authorization: 'Bearer no-sirve' } });
    expect(res.statusCode).toBe(401);
    expect(isAdmin).not.toHaveBeenCalled();
    expect(listAll).not.toHaveBeenCalled();
  });

  it('un usuario NO admin -> 403 FORBIDDEN (no lee los leads de nadie)', async () => {
    const res = await app.inject({ method: 'GET', url: URL, headers: { authorization: 'Bearer valid-user' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    // El rol se consulto con el sub del JWT verificado.
    expect(isAdmin).toHaveBeenCalledWith('user-2');
    // 403 antes de tocar los datos.
    expect(listAll).not.toHaveBeenCalled();
  });

  it('un x-admin-token NO sirve en este endpoint (el panel es por rol) -> 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: URL,
      headers: { 'x-admin-token': BASE.ADMIN_API_TOKEN },
    });
    expect(res.statusCode).toBe(401);
    expect(listAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------
// LISTADO: un admin ve todas las solicitudes (con paginacion) + filtro opcional por status
// ---------------------------------------------------------------------------------------------------

describe('GET /v1/admin/upgrade-requests: listado admin', () => {
  it('un admin lista los leads: 200 con items + pagination', async () => {
    listAll.mockResolvedValue({ items: [makeRequestRow(), makeRequestRow({ id: 'r2' })], total: 2 });
    const res = await app.inject({ method: 'GET', url: URL, headers: { authorization: 'Bearer valid-admin' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.upgradeRequests).toHaveLength(2);
    expect(body.pagination).toEqual({ limit: 20, offset: 0, total: 2, hasMore: false });
    // Defaults: limit 20, offset 0, sin filtro de status.
    expect(listAll).toHaveBeenCalledWith({ limit: 20, offset: 0, status: undefined });
  });

  it('filtra por status y respeta limit/offset', async () => {
    listAll.mockResolvedValue({ items: [makeRequestRow()], total: 5 });
    const res = await app.inject({
      method: 'GET',
      url: `${URL}?status=pending&limit=1&offset=2`,
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(listAll).toHaveBeenCalledWith({ limit: 1, offset: 2, status: 'pending' });
    // hasMore: offset(2) + items(1) < total(5) -> true.
    expect(res.json().pagination.hasMore).toBe(true);
  });

  it('status invalido -> 400 (no toca el repo)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${URL}?status=inexistente`,
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(listAll).not.toHaveBeenCalled();
  });

  it('limit fuera de rango (>50) -> 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${URL}?limit=999`,
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(400);
    expect(listAll).not.toHaveBeenCalled();
  });

  it('un no-admin con querystring invalido -> 403 (el gate corre ANTES de validar)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${URL}?status=inexistente`,
      headers: { authorization: 'Bearer valid-user' },
    });
    // 403, no 400: el gate no filtra informacion de validacion a un no-admin.
    expect(res.statusCode).toBe(403);
    expect(listAll).not.toHaveBeenCalled();
  });
});
