import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { adminUsersRoutes } from '../src/routes/admin-users.js';
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
const listUsers = vi.fn();
// La ficha (GET /v1/admin/users/:id) usa getUserDetail; aca solo se prueba el listado, pero el tipo del
// repo la exige, asi que se stubea (nunca se invoca en estas pruebas). Su cobertura vive en su propio test.
const getUserDetail = vi.fn();

/** Fila del listado tal como la devuelve RegistrationRepository.listUsers (camelCase, con email del join). */
function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ada@test.com',
    fullName: 'Ada Lovelace',
    accountType: 'individual',
    role: 'individual',
    isAdmin: false,
    tier: 'free',
    identityVerified: false,
    createdAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(adminUsersRoutes(config, { verifier, repo: { isAdmin, listUsers, getUserDetail } }));
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  isAdmin.mockImplementation(async (sub: string) => sub === 'admin-1');
  listUsers.mockResolvedValue({ users: [], total: 0 });
  app = await makeApp();
});

describe('auth: GET /v1/admin/users (gate por rol)', () => {
  it('sin Authorization -> 401 (no toca el repo de datos)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/users' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('token invalido -> 401 (ni siquiera lee el rol)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/users',
      headers: { authorization: 'Bearer no-sirve' },
    });
    expect(res.statusCode).toBe(401);
    expect(isAdmin).not.toHaveBeenCalled();
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('un usuario NO admin -> 403 FORBIDDEN (el gate por rol funciona en un endpoint real)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/users',
      headers: { authorization: 'Bearer valid-user' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    // El rol se consulto con el sub del JWT verificado, no con nada del request.
    expect(isAdmin).toHaveBeenCalledWith('user-2');
    // 403 antes de tocar los datos.
    expect(listUsers).not.toHaveBeenCalled();
  });
});

describe('GET /v1/admin/users: listado', () => {
  it('un admin recibe la lista paginada con los campos + email del join', async () => {
    listUsers.mockResolvedValue({ users: [makeUser()], total: 1 });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/users',
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(isAdmin).toHaveBeenCalledWith('admin-1');
    // Defaults de paginacion; sin search.
    expect(listUsers).toHaveBeenCalledWith({ limit: 20, offset: 0, search: undefined });
    const body = res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'ada@test.com',
      fullName: 'Ada Lovelace',
      accountType: 'individual',
      role: 'individual',
      isAdmin: false,
      tier: 'free',
      identityVerified: false,
      createdAt: '2026-06-30T00:00:00.000Z',
    });
    expect(body.pagination).toEqual({ limit: 20, offset: 0, total: 1, hasMore: false });
  });

  it('el email puede venir null (left join sin fila en auth.users) y se conserva', async () => {
    listUsers.mockResolvedValue({ users: [makeUser({ email: null })], total: 1 });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/users',
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().users[0].email).toBeNull();
  });
});

describe('GET /v1/admin/users: paginacion', () => {
  it('respeta limit y offset del querystring', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/admin/users?limit=10&offset=30',
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(listUsers).toHaveBeenCalledWith({ limit: 10, offset: 30, search: undefined });
  });

  it('limit > 50 (techo) -> 400 (no lista)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/users?limit=51',
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('limit=50 (borde) es valido', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/users?limit=50',
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(listUsers).toHaveBeenCalledWith({ limit: 50, offset: 0, search: undefined });
  });

  it('limit=0 u offset negativo -> 400 (no lista)', async () => {
    const r1 = await app.inject({
      method: 'GET',
      url: '/v1/admin/users?limit=0',
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({
      method: 'GET',
      url: '/v1/admin/users?offset=-1',
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(r2.statusCode).toBe(400);
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('hasMore=true cuando aun quedan filas mas alla de la pagina (offset+len < total)', async () => {
    listUsers.mockResolvedValue({
      users: Array.from({ length: 10 }, (_, i) => makeUser({ id: `u-${i}` })),
      total: 42,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/users?limit=10&offset=0',
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.json().pagination).toEqual({ limit: 10, offset: 0, total: 42, hasMore: true });
  });

  it('hasMore=false en la ultima pagina (offset+len == total)', async () => {
    listUsers.mockResolvedValue({
      users: Array.from({ length: 2 }, (_, i) => makeUser({ id: `u-${i}` })),
      total: 32,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/users?limit=10&offset=30',
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.json().pagination).toEqual({ limit: 10, offset: 30, total: 32, hasMore: false });
  });
});

describe('GET /v1/admin/users: busqueda (search)', () => {
  it('un search valido se pasa al repo tal cual (el repo lo parametriza)', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/admin/users?search=ada',
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(listUsers).toHaveBeenCalledWith({ limit: 20, offset: 0, search: 'ada' });
  });

  it('search vacio o solo espacios -> sin filtro (search undefined, no 400)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/users?search=%20%20',
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(listUsers).toHaveBeenCalledWith({ limit: 20, offset: 0, search: undefined });
  });

  it('un search "malicioso" viaja VERBATIM al repo: la ruta no lo concatena ni lo transforma', async () => {
    const injection = "ada'; drop table profiles; --";
    await app.inject({
      method: 'GET',
      url: `/v1/admin/users?search=${encodeURIComponent(injection)}`,
      headers: { authorization: 'Bearer valid-admin' },
    });
    // La ruta lo entrega como VALOR (el repo lo pasa como parametro $1, nunca como texto SQL). Que llegue
    // sin modificar prueba que la capa de ruta no arma SQL con el input.
    expect(listUsers).toHaveBeenCalledWith({ limit: 20, offset: 0, search: injection });
  });
});
