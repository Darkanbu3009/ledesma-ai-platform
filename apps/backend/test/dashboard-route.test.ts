import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { calcularCosto } from '@ledesma-platform/shared';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { dashboardRoutes } from '../src/routes/dashboard.js';
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

// Reloj fijo para que el rango por defecto (ultimos 30 dias) sea determinista en los tests.
const NOW = new Date('2026-07-04T00:00:00.000Z');
const DEFAULT_FROM = new Date('2026-06-04T00:00:00.000Z'); // NOW - 30 dias

// Verifier falso (sin red): user-1 y user-2 validos; cualquier otro token invalido.
const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    if (token === 'valid-user-2') return { id: 'user-2', email: 'u2@test.com' };
    throw new Error('invalid');
  },
};

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

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    dashboardRoutes(config, {
      verifier,
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
  // Defaults "sin datos": un owner recien llegado (free/pro sin ejecuciones autonomas).
  totalsForOwner.mockResolvedValue(makeTotals());
  runsByDayForOwner.mockResolvedValue([]);
  tokensByModelForOwner.mockResolvedValue([]);
  countByStatusForOwner.mockResolvedValue({ pending: 0, running: 0, completed: 0, failed: 0 });
  scheduledCountActive.mockResolvedValue(0);
  triggersCountActive.mockResolvedValue(0);
  recipesCountActive.mockResolvedValue(0);
  app = await makeApp();
});

describe('auth: GET /v1/dashboard', () => {
  it('sin Authorization -> 401 (no toca ningun repo)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/dashboard' });
    expect(res.statusCode).toBe(401);
    expect(totalsForOwner).not.toHaveBeenCalled();
    expect(countByStatusForOwner).not.toHaveBeenCalled();
  });

  it('token invalido -> 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/dashboard',
      headers: { authorization: 'Bearer no-sirve' },
    });
    expect(res.statusCode).toBe(401);
    expect(totalsForOwner).not.toHaveBeenCalled();
  });
});

describe('GET /v1/dashboard: los tres ejes', () => {
  it('devuelve actividad, operaciones y gasto para el owner del token', async () => {
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
    countByStatusForOwner.mockResolvedValue({ pending: 1, running: 2, completed: 6, failed: 1 });
    scheduledCountActive.mockResolvedValue(3);
    triggersCountActive.mockResolvedValue(2);
    recipesCountActive.mockResolvedValue(4);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/dashboard',
      headers: { authorization: 'Bearer valid-user-1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // ACTIVIDAD: la serie por dia lleva runs + los 4 cubos de tokens (passthrough sin reformar).
    expect(body.activity.totals).toEqual({ runs: 10, completed: 8, errors: 2 });
    expect(body.activity.byDay).toEqual([
      { date: '2026-07-03', runs: 10, inputTokens: 1000, outputTokens: 400, cacheReadTokens: 5000, cacheWriteTokens: 250 },
    ]);
    expect(body.activity.lastRunAt).toBe('2026-07-03T10:00:00.000Z');

    // OPERACIONES: conteos de cola + recursos activos, con total derivado.
    expect(body.operations.jobs).toEqual({ pending: 1, running: 2, completed: 6, failed: 1, total: 10 });
    expect(body.operations.resources).toEqual({ scheduledTasksActive: 3, triggersActive: 2, recipesActive: 4 });

    // GASTO: 4 cubos + BYOK + desglose por modelo.
    expect(body.spend.byok).toBe(true);
    expect(typeof body.spend.note).toBe('string');
    expect(body.spend.tokens).toEqual({ inputTokens: 1000, outputTokens: 400, cacheReadTokens: 5000, cacheWriteTokens: 250 });
    expect(body.spend.byModel).toHaveLength(1);

    // El owner del token (user-1) es el que se consulta, en TODOS los repos.
    expect(totalsForOwner).toHaveBeenCalledWith('user-1', { from: DEFAULT_FROM, to: NOW });
    expect(countByStatusForOwner).toHaveBeenCalledWith('user-1');
    expect(scheduledCountActive).toHaveBeenCalledWith('user-1');
    expect(triggersCountActive).toHaveBeenCalledWith('user-1');
    expect(recipesCountActive).toHaveBeenCalledWith('user-1');
  });

  it('AISLAMIENTO: otro usuario (user-2) solo consulta lo suyo (el owner sale del token)', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/dashboard',
      headers: { authorization: 'Bearer valid-user-2' },
    });
    for (const m of [totalsForOwner, runsByDayForOwner, tokensByModelForOwner, countByStatusForOwner, scheduledCountActive, triggersCountActive, recipesCountActive]) {
      const owners = m.mock.calls.map((c) => c[0]);
      expect(owners.every((o) => o === 'user-2')).toBe(true);
      expect(owners).not.toContain('user-1');
    }
  });
});

describe('GET /v1/dashboard: GASTO desglosado por modelo (calcularCosto)', () => {
  it('aplica calcularCosto por modelo con los 4 cubos (distintos); el total es la suma de los tarifados', async () => {
    // Cubos DISTINTOS a proposito (input != output != cache_read != cache_write): asi el test detecta un
    // swap de cubos en la ruta. claude-opus-4-8 = $5 input / $25 output por millon; cache_read 0.1x del
    // input (= $0.5/M) y cache_write 1.25x (= $6.25/M).
    const opus = { model: 'claude-opus-4-8', runs: 4, inputTokens: 1_000_000, outputTokens: 2_000_000, cacheReadTokens: 4_000_000, cacheWriteTokens: 800_000 };
    const sonnet = { model: 'claude-sonnet-4-6', runs: 2, inputTokens: 2_000_000, outputTokens: 500_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    tokensByModelForOwner.mockResolvedValue([opus, sonnet]);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/dashboard',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    const spend = res.json().spend;

    const opusRow = spend.byModel.find((m: { model: string }) => m.model === 'claude-opus-4-8');
    const sonnetRow = spend.byModel.find((m: { model: string }) => m.model === 'claude-sonnet-4-6');

    // Monto calculado a MANO (independiente de calcularCosto): 5*1 + 25*2 + 0.5*4 + 6.25*0.8 = 62.0 USD.
    expect(opusRow.costUsd).toBeCloseTo(62.0, 10);
    expect(opusRow.priced).toBe(true);

    // Los cubos de cache NO son intercambiables: intercambiar read<->write da OTRO monto (12.5x de brecha),
    // asi que si la ruta hubiera cruzado los cubos, el costo no coincidiria con 62.0.
    const swapped = calcularCosto('claude-opus-4-8', {
      inputTokens: opus.inputTokens,
      outputTokens: opus.outputTokens,
      cacheReadTokens: opus.cacheWriteTokens,
      cacheWriteTokens: opus.cacheReadTokens,
    })!;
    expect(opusRow.costUsd).not.toBeCloseTo(swapped, 6);

    // Los CUATRO cubos entran al costo: incluir cache lo hace MAYOR que ignorarlo.
    const opusSinCache = calcularCosto('claude-opus-4-8', { inputTokens: opus.inputTokens, outputTokens: opus.outputTokens })!;
    expect(opusRow.costUsd).toBeGreaterThan(opusSinCache);

    // Sonnet sin cache: 3*2 + 15*0.5 = 13.5 USD.
    expect(sonnetRow.costUsd).toBeCloseTo(13.5, 10);

    // Total = suma de los modelos tarifados (62.0 + 13.5 = 75.5).
    expect(spend.totalCostUsd).toBeCloseTo(75.5, 10);
    expect(spend.costComplete).toBe(true);
    expect(spend.untariffedModels).toEqual([]);
  });

  it('modelo SIN tarifa -> costUsd null, fuera del total, listado en untariffedModels (costComplete=false)', async () => {
    const opus = { model: 'claude-opus-4-8', runs: 1, inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const gpt = { model: 'gpt-5.5', runs: 1, inputTokens: 500_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    tokensByModelForOwner.mockResolvedValue([opus, gpt]);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/dashboard',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    const spend = res.json().spend;

    const gptRow = spend.byModel.find((m: { model: string }) => m.model === 'gpt-5.5');
    expect(gptRow.costUsd).toBeNull();
    expect(gptRow.priced).toBe(false);
    // El total solo cuenta lo tarifado (opus), sin fabricar un monto para gpt.
    expect(spend.totalCostUsd).toBeCloseTo(calcularCosto('claude-opus-4-8', opus)!, 10);
    expect(spend.untariffedModels).toEqual(['gpt-5.5']);
    expect(spend.costComplete).toBe(false);
  });

  it('gasto por dia expone los 4 cubos (derivado de la serie de actividad)', async () => {
    runsByDayForOwner.mockResolvedValue([
      { date: '2026-07-01', runs: 2, inputTokens: 100, outputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: 10 },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/dashboard',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.json().spend.byDay).toEqual([
      { date: '2026-07-01', inputTokens: 100, outputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: 10 },
    ]);
  });
});

describe('GET /v1/dashboard: rango ?from/?to', () => {
  it('sin params aplica el default (ultimos 30 dias) y lo marca en la respuesta', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/dashboard',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    const range = res.json().range;
    expect(range).toEqual({
      from: DEFAULT_FROM.toISOString(),
      to: NOW.toISOString(),
      defaulted: true,
      defaultWindowDays: 30,
    });
    // El rango por defecto (Date) llega a las lecturas acotadas por fecha.
    expect(runsByDayForOwner).toHaveBeenCalledWith('user-1', { from: DEFAULT_FROM, to: NOW });
  });

  it('from/to validos: pasa el rango como Date a las lecturas de agent_runs y marca defaulted=false', async () => {
    const from = '2026-06-01T00:00:00.000Z';
    const to = '2026-06-15T23:59:59.000Z';
    const res = await app.inject({
      method: 'GET',
      url: `/v1/dashboard?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    const range = res.json().range;
    expect(range.from).toBe(new Date(from).toISOString());
    expect(range.to).toBe(new Date(to).toISOString());
    expect(range.defaulted).toBe(false);

    const rangeArg = { from: new Date(from), to: new Date(to) };
    expect(totalsForOwner).toHaveBeenCalledWith('user-1', rangeArg);
    expect(runsByDayForOwner).toHaveBeenCalledWith('user-1', rangeArg);
    expect(tokensByModelForOwner).toHaveBeenCalledWith('user-1', rangeArg);
    // Los conteos de operaciones son foto actual: NO reciben rango.
    expect(countByStatusForOwner).toHaveBeenCalledWith('user-1');
  });

  it('solo ?from: la ventana llega hasta ahora (to = now), defaulted=false', async () => {
    const from = '2026-06-20T00:00:00.000Z';
    const res = await app.inject({
      method: 'GET',
      url: `/v1/dashboard?from=${encodeURIComponent(from)}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    const range = res.json().range;
    expect(range.from).toBe(new Date(from).toISOString());
    expect(range.to).toBe(NOW.toISOString());
    expect(range.defaulted).toBe(false);
    expect(totalsForOwner).toHaveBeenCalledWith('user-1', { from: new Date(from), to: NOW });
  });

  it('solo ?to: la ventana arranca 30 dias antes de ese to, defaulted=false', async () => {
    const to = '2026-05-31T00:00:00.000Z';
    const expectedFrom = new Date(new Date(to).getTime() - 30 * 24 * 60 * 60 * 1000);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/dashboard?to=${encodeURIComponent(to)}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    const range = res.json().range;
    expect(range.to).toBe(new Date(to).toISOString());
    expect(range.from).toBe(expectedFrom.toISOString());
    expect(range.defaulted).toBe(false);
    expect(totalsForOwner).toHaveBeenCalledWith('user-1', { from: expectedFrom, to: new Date(to) });
  });

  it('from no ISO -> 400 VALIDATION_ERROR (no toca ningun repo)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/dashboard?from=ayer',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(totalsForOwner).not.toHaveBeenCalled();
    expect(countByStatusForOwner).not.toHaveBeenCalled();
  });
});

describe('GET /v1/dashboard: owner sin datos', () => {
  it('responde 200 con ceros/vacios (no 500) para un owner sin ejecuciones ni recursos', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/dashboard',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.activity).toEqual({ totals: { runs: 0, completed: 0, errors: 0 }, byDay: [], lastRunAt: null });
    expect(body.operations.jobs).toEqual({ pending: 0, running: 0, completed: 0, failed: 0, total: 0 });
    expect(body.operations.resources).toEqual({ scheduledTasksActive: 0, triggersActive: 0, recipesActive: 0 });
    expect(body.spend.tokens).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(body.spend.byModel).toEqual([]);
    expect(body.spend.byDay).toEqual([]);
    expect(body.spend.totalCostUsd).toBe(0);
    expect(body.spend.costComplete).toBe(true);
    expect(body.spend.untariffedModels).toEqual([]);
    // La ventana de retencion se documenta aunque no haya datos.
    expect(body.retention).toEqual({ agentRunsDays: 365, jobsTerminalDays: 90 });
  });
});
