import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { calcularCosto } from '@ledesma-platform/shared';
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

// Reloj fijo para que el rango por defecto (ultimos 30 dias) de la actividad sea determinista.
const NOW = new Date('2026-07-04T00:00:00.000Z');
const DEFAULT_FROM = new Date('2026-06-04T00:00:00.000Z'); // NOW - 30 dias

// Verifier falso (sin red): 'valid-admin' -> sub admin-1, 'valid-user' -> sub user-2; cualquier otro invalido.
const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-admin') return { id: 'admin-1', email: 'admin@test.com' };
    if (token === 'valid-user') return { id: 'user-2', email: 'user@test.com' };
    throw new Error('invalid');
  },
};

// El usuario OBJETIVO (:id de la ficha/actividad). Un uuid valido y DISTINTO al del admin (admin-1): el
// :id se usa como owner cross-owner, no es el que llama.
const TARGET = '22222222-2222-4222-8222-222222222222';

// El rol se lee server-side por sub: admin-1 es super-admin, cualquier otro NO.
const isAdmin = vi.fn(async (sub: string) => sub === 'admin-1');
const listUsers = vi.fn();
const getUserDetail = vi.fn();

// Repos del dashboard (reusados por la actividad con ownerId=:id).
const totalsForOwner = vi.fn();
const runsByDayForOwner = vi.fn();
const tokensByModelForOwner = vi.fn();
const countByStatusForOwner = vi.fn();
const scheduledCountActive = vi.fn();
const triggersCountActive = vi.fn();
const recipesCountActive = vi.fn();

/** Totales del owner con los 4 cubos (lo que devuelve AgentRunRepository.totalsForOwner). */
function makeTotals(overrides: Record<string, unknown> = {}) {
  return {
    runs: 0,
    completed: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    lastRunAt: null,
    ...overrides,
  };
}

/** Ficha tal como la devuelve RegistrationRepository.getUserDetail (camelCase, con email + is_admin). */
function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    profile: {
      id: TARGET,
      fullName: 'Ada Lovelace',
      accountType: 'individual',
      role: 'individual',
      isAdmin: false,
      tier: 'free',
      identityVerified: false,
      createdAt: '2026-06-30T00:00:00.000Z',
    },
    email: 'ada@test.com',
    subscription: {
      id: 'sub-1',
      profileId: TARGET,
      plan: 'free',
      status: 'active',
      createdAt: '2026-06-30T00:00:00.000Z',
    },
    usageCounter: {
      id: 'uc-1',
      profileId: TARGET,
      runsUsed: 3,
      runsLimit: 10,
      periodKind: 'lifetime',
      createdAt: '2026-06-30T00:00:00.000Z',
    },
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    adminUsersRoutes(config, {
      verifier,
      repo: { isAdmin, listUsers, getUserDetail },
      runRepo: { totalsForOwner, runsByDayForOwner, tokensByModelForOwner },
      jobsRepo: { countByStatusForOwner },
      scheduledRepo: { countActiveByOwner: scheduledCountActive },
      triggersRepo: { countActiveByOwner: triggersCountActive },
      recipesRepo: { countActiveByOwner: recipesCountActive },
      now: () => NOW,
    }),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  isAdmin.mockImplementation(async (sub: string) => sub === 'admin-1');
  getUserDetail.mockResolvedValue(makeDetail());
  totalsForOwner.mockResolvedValue(makeTotals());
  runsByDayForOwner.mockResolvedValue([]);
  tokensByModelForOwner.mockResolvedValue([]);
  countByStatusForOwner.mockResolvedValue({ pending: 0, running: 0, completed: 0, failed: 0, pausado: 0 });
  scheduledCountActive.mockResolvedValue(0);
  triggersCountActive.mockResolvedValue(0);
  recipesCountActive.mockResolvedValue(0);
  app = await makeApp();
});

// ---------------------------------------------------------------------------------------------------
// FICHA: GET /v1/admin/users/:id
// ---------------------------------------------------------------------------------------------------

describe('auth: GET /v1/admin/users/:id (gate por rol)', () => {
  it('sin Authorization -> 401 (no toca el repo de datos)', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/admin/users/${TARGET}` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(getUserDetail).not.toHaveBeenCalled();
  });

  it('token invalido -> 401 (ni siquiera lee el rol)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${TARGET}`,
      headers: { authorization: 'Bearer no-sirve' },
    });
    expect(res.statusCode).toBe(401);
    expect(isAdmin).not.toHaveBeenCalled();
    expect(getUserDetail).not.toHaveBeenCalled();
  });

  it('un usuario NO admin -> 403 FORBIDDEN (el poder de ver cualquier ficha es exclusivo de admins)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${TARGET}`,
      headers: { authorization: 'Bearer valid-user' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    // El rol se consulto con el sub del JWT, no con el :id de la URL.
    expect(isAdmin).toHaveBeenCalledWith('user-2');
    // 403 antes de tocar los datos.
    expect(getUserDetail).not.toHaveBeenCalled();
  });
});

describe('GET /v1/admin/users/:id: ficha', () => {
  it('un admin recibe la ficha del usuario OBJETIVO (profile+email+subscription+usage)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${TARGET}`,
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(200);
    // La ficha se pidio para el :id de la URL, no para el admin que llama (cross-owner por diseno).
    expect(getUserDetail).toHaveBeenCalledWith(TARGET);
    const body = res.json();
    expect(body.profile).toEqual({
      id: TARGET,
      fullName: 'Ada Lovelace',
      accountType: 'individual',
      role: 'individual',
      isAdmin: false,
      tier: 'free',
      identityVerified: false,
      createdAt: '2026-06-30T00:00:00.000Z',
    });
    expect(body.email).toBe('ada@test.com');
    expect(body.subscription).toMatchObject({ plan: 'free', status: 'active' });
    expect(body.usageCounter).toMatchObject({ runsUsed: 3, runsLimit: 10, periodKind: 'lifetime' });
  });

  it('404 cuando el usuario objetivo no existe (getUserDetail -> null)', async () => {
    getUserDetail.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${TARGET}`,
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('email null (sin fila en auth.users) se conserva; subscription/usage pueden ser null', async () => {
    getUserDetail.mockResolvedValue(makeDetail({ email: null, subscription: null, usageCounter: null }));
    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${TARGET}`,
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBeNull();
    expect(body.subscription).toBeNull();
    expect(body.usageCounter).toBeNull();
  });
});

describe('GET /v1/admin/users/:id: validacion del :id', () => {
  it(':id no-uuid -> 400 (no toca el repo)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/users/no-es-uuid',
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(getUserDetail).not.toHaveBeenCalled();
  });

  it('un NO admin con :id no-uuid -> 403 (el gate corre ANTES de validar el :id)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/users/no-es-uuid',
      headers: { authorization: 'Bearer valid-user' },
    });
    // 403, no 400: el gate no filtra informacion de validacion a un no-admin.
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(getUserDetail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------
// ACTIVIDAD: GET /v1/admin/users/:id/activity
// ---------------------------------------------------------------------------------------------------

describe('auth: GET /v1/admin/users/:id/activity (gate por rol)', () => {
  it('sin Authorization -> 401 (no toca ningun repo)', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/admin/users/${TARGET}/activity` });
    expect(res.statusCode).toBe(401);
    expect(totalsForOwner).not.toHaveBeenCalled();
    expect(countByStatusForOwner).not.toHaveBeenCalled();
  });

  it('un usuario NO admin -> 403 (la actividad cross-owner es exclusiva de admins)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${TARGET}/activity`,
      headers: { authorization: 'Bearer valid-user' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(isAdmin).toHaveBeenCalledWith('user-2');
    expect(totalsForOwner).not.toHaveBeenCalled();
  });
});

describe('GET /v1/admin/users/:id/activity: los tres ejes del usuario objetivo', () => {
  it('un admin recibe actividad, operaciones y gasto del OBJETIVO (owner = :id, no el admin)', async () => {
    totalsForOwner.mockResolvedValue(
      makeTotals({
        runs: 10,
        completed: 8,
        errors: 2,
        inputTokens: 1000,
        outputTokens: 400,
        cacheReadTokens: 5000,
        cacheWriteTokens: 250,
        lastRunAt: '2026-07-03T10:00:00.000Z',
      }),
    );
    runsByDayForOwner.mockResolvedValue([
      { date: '2026-07-03', runs: 10, inputTokens: 1000, outputTokens: 400, cacheReadTokens: 5000, cacheWriteTokens: 250 },
    ]);
    tokensByModelForOwner.mockResolvedValue([
      { model: 'claude-opus-4-8', runs: 10, inputTokens: 1000, outputTokens: 400, cacheReadTokens: 5000, cacheWriteTokens: 250 },
    ]);
    countByStatusForOwner.mockResolvedValue({ pending: 1, running: 2, completed: 6, failed: 1, pausado: 0 });
    scheduledCountActive.mockResolvedValue(3);
    triggersCountActive.mockResolvedValue(2);
    recipesCountActive.mockResolvedValue(4);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${TARGET}/activity`,
      headers: { authorization: 'Bearer valid-admin' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // ACTIVIDAD
    expect(body.activity.totals).toEqual({ runs: 10, completed: 8, errors: 2 });
    expect(body.activity.byDay).toEqual([
      { date: '2026-07-03', runs: 10, inputTokens: 1000, outputTokens: 400, cacheReadTokens: 5000, cacheWriteTokens: 250 },
    ]);
    expect(body.activity.lastRunAt).toBe('2026-07-03T10:00:00.000Z');

    // OPERACIONES
    expect(body.operations.jobs).toEqual({ pending: 1, running: 2, completed: 6, failed: 1, pausado: 0, total: 10 });
    expect(body.operations.resources).toEqual({ scheduledTasksActive: 3, triggersActive: 2, recipesActive: 4 });

    // GASTO
    expect(body.spend.byok).toBe(true);
    expect(body.spend.tokens).toEqual({ inputTokens: 1000, outputTokens: 400, cacheReadTokens: 5000, cacheWriteTokens: 250 });
    expect(body.spend.byModel).toHaveLength(1);

    // TODOS los repos se consultaron con el :id OBJETIVO (cross-owner), NUNCA con el admin que llama.
    expect(totalsForOwner).toHaveBeenCalledWith(TARGET, { from: DEFAULT_FROM, to: NOW });
    expect(runsByDayForOwner).toHaveBeenCalledWith(TARGET, { from: DEFAULT_FROM, to: NOW });
    expect(tokensByModelForOwner).toHaveBeenCalledWith(TARGET, { from: DEFAULT_FROM, to: NOW });
    expect(countByStatusForOwner).toHaveBeenCalledWith(TARGET);
    expect(scheduledCountActive).toHaveBeenCalledWith(TARGET);
    expect(triggersCountActive).toHaveBeenCalledWith(TARGET);
    expect(recipesCountActive).toHaveBeenCalledWith(TARGET);
    for (const m of [totalsForOwner, runsByDayForOwner, tokensByModelForOwner, countByStatusForOwner, scheduledCountActive, triggersCountActive, recipesCountActive]) {
      const owners = m.mock.calls.map((c) => c[0]);
      expect(owners).not.toContain('admin-1');
    }
  });

  it('GASTO por modelo: calcularCosto por modelo con los 4 cubos; total = suma de tarifados', async () => {
    // Mismos numeros que el test del dashboard: prueba que la agregacion compartida tarifa igual por :id.
    const opus = { model: 'claude-opus-4-8', runs: 4, inputTokens: 1_000_000, outputTokens: 2_000_000, cacheReadTokens: 4_000_000, cacheWriteTokens: 800_000 };
    const sonnet = { model: 'claude-sonnet-4-6', runs: 2, inputTokens: 2_000_000, outputTokens: 500_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    tokensByModelForOwner.mockResolvedValue([opus, sonnet]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${TARGET}/activity`,
      headers: { authorization: 'Bearer valid-admin' },
    });
    const spend = res.json().spend;

    const opusRow = spend.byModel.find((m: { model: string }) => m.model === 'claude-opus-4-8');
    const sonnetRow = spend.byModel.find((m: { model: string }) => m.model === 'claude-sonnet-4-6');
    // 5*1 + 25*2 + 0.5*4 + 6.25*0.8 = 62.0 USD (calculado a mano, independiente de calcularCosto).
    expect(opusRow.costUsd).toBeCloseTo(62.0, 10);
    expect(opusRow.priced).toBe(true);
    // Sonnet sin cache: 3*2 + 15*0.5 = 13.5 USD.
    expect(sonnetRow.costUsd).toBeCloseTo(13.5, 10);
    // Total = 62.0 + 13.5 = 75.5.
    expect(spend.totalCostUsd).toBeCloseTo(75.5, 10);
    expect(spend.costComplete).toBe(true);
    expect(spend.untariffedModels).toEqual([]);
  });

  it('modelo SIN tarifa -> costUsd null, fuera del total, en untariffedModels (costComplete=false)', async () => {
    const opus = { model: 'claude-opus-4-8', runs: 1, inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const gpt = { model: 'gpt-5.5', runs: 1, inputTokens: 500_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    tokensByModelForOwner.mockResolvedValue([opus, gpt]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${TARGET}/activity`,
      headers: { authorization: 'Bearer valid-admin' },
    });
    const spend = res.json().spend;
    const gptRow = spend.byModel.find((m: { model: string }) => m.model === 'gpt-5.5');
    expect(gptRow.costUsd).toBeNull();
    expect(gptRow.priced).toBe(false);
    expect(spend.totalCostUsd).toBeCloseTo(calcularCosto('claude-opus-4-8', opus)!, 10);
    expect(spend.untariffedModels).toEqual(['gpt-5.5']);
    expect(spend.costComplete).toBe(false);
  });
});

describe('GET /v1/admin/users/:id/activity: rango y validacion', () => {
  it('sin params aplica el default (ultimos 30 dias) y lo marca en la respuesta', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${TARGET}/activity`,
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.json().range).toEqual({
      from: DEFAULT_FROM.toISOString(),
      to: NOW.toISOString(),
      defaulted: true,
      defaultWindowDays: 30,
    });
  });

  it('from/to validos: pasa el rango como Date a las lecturas del OBJETIVO, defaulted=false', async () => {
    const from = '2026-06-01T00:00:00.000Z';
    const to = '2026-06-15T23:59:59.000Z';
    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${TARGET}/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(200);
    const rangeArg = { from: new Date(from), to: new Date(to) };
    expect(totalsForOwner).toHaveBeenCalledWith(TARGET, rangeArg);
    expect(res.json().range.defaulted).toBe(false);
  });

  it(':id no-uuid -> 400 (no toca ningun repo)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/users/no-es-uuid/activity',
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(totalsForOwner).not.toHaveBeenCalled();
  });

  it('from no ISO -> 400 VALIDATION_ERROR (no toca ningun repo)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${TARGET}/activity?from=ayer`,
      headers: { authorization: 'Bearer valid-admin' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(totalsForOwner).not.toHaveBeenCalled();
  });

  it('un NO admin con :id no-uuid -> 403 (gate antes de validar)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/users/no-es-uuid/activity',
      headers: { authorization: 'Bearer valid-user' },
    });
    expect(res.statusCode).toBe(403);
    expect(totalsForOwner).not.toHaveBeenCalled();
  });
});
