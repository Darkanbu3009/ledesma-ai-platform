import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { retentionRoutes } from '../src/routes/retention.js';
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

const purgeExpired = vi.fn();
const NOW = new Date('2026-07-01T00:00:00.000Z');

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(retentionRoutes(config, { retentionRepo: { purgeExpired }, now: () => NOW }));
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  app = await makeApp();
});

describe('POST /v1/admin/retention/purge', () => {
  it('sin x-admin-token -> 401 (no purga)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/retention/purge' });
    expect(res.statusCode).toBe(401);
    expect(purgeExpired).not.toHaveBeenCalled();
  });

  it('con x-admin-token corre la purga con now del servidor y devuelve el resultado + politica', async () => {
    purgeExpired.mockResolvedValue({ agentRuns: 5, terminalJobs: 2, trayectoriasWeb: 1 });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/retention/purge',
      headers: { 'x-admin-token': 'admin-token-1234567890' },
    });
    expect(res.statusCode).toBe(200);
    // trayectoriasWebDays sale del env (RETENTION_TRAYECTORIAS_WEB_DAYS, default 30).
    expect(purgeExpired).toHaveBeenCalledWith(NOW, {
      agentRunsDays: 365,
      terminalJobsDays: 90,
      trayectoriasWebDays: 30,
    });
    const body = res.json();
    expect(body.purged).toEqual({ agentRuns: 5, terminalJobs: 2, trayectoriasWeb: 1 });
    expect(body.policy).toEqual({ agentRunsDays: 365, terminalJobsDays: 90, trayectoriasWebDays: 30 });
  });

  it('RETENTION_TRAYECTORIAS_WEB_DAYS del env ajusta SOLO la ventana de trayectorias', async () => {
    purgeExpired.mockResolvedValue({ agentRuns: 0, terminalJobs: 0, trayectoriasWeb: 3 });
    const config = parseEnv({ ...BASE, RETENTION_TRAYECTORIAS_WEB_DAYS: '7' });
    const custom = Fastify();
    registerErrorHandler(custom, config);
    await custom.register(retentionRoutes(config, { retentionRepo: { purgeExpired }, now: () => NOW }));
    const res = await custom.inject({
      method: 'POST',
      url: '/v1/admin/retention/purge',
      headers: { 'x-admin-token': 'admin-token-1234567890' },
    });
    expect(res.statusCode).toBe(200);
    expect(purgeExpired).toHaveBeenCalledWith(NOW, {
      agentRunsDays: 365,
      terminalJobsDays: 90,
      trayectoriasWebDays: 7,
    });
  });
});
