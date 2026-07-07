import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock del SDK de Supabase: createClient LANZA de forma sincrona, igual que el SDK real cuando la url/key
// faltan ("supabaseUrl is required."). Esto reproduce el MECANISMO EXACTO del crash de produccion: si el
// codigo fuera EAGER (createClient al registrar la ruta), este throw tumbaria el registro del plugin y
// app.ready() rechazaria -> el servidor nunca arranca. Con la inicializacion PEREZOSA, createClient no se
// toca en el boot, asi que el arranque sobrevive aunque createClient vaya a lanzar. vi.hoisted corre antes
// del hoisting de vi.mock.
const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(() => {
    throw new Error('supabaseUrl is required.');
  }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

import Fastify from 'fastify';
import { dataSubjectRequestRoutes } from '../src/routes/data-requests.js';
import { parseEnv } from '../src/config/env.js';
import { setSqlForTesting } from '../src/db/client.js';
import type { Sql } from '../src/db/client.js';

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Sql falso: al usar los DEFAULTS reales del plugin, los repos reciben este handle y NO abren un pool
  // real de postgres al registrar la ruta. No se ejecuta ninguna query en el arranque.
  setSqlForTesting((() => {
    /* no-op */
  }) as unknown as Sql);
});

afterEach(() => {
  setSqlForTesting(undefined);
});

describe('arranque de la ruta data-requests: cliente Supabase PEREZOSO (no eager en el boot)', () => {
  it('CON la key configurada: registra y queda ready aunque createClient LANZARIA (lazy: nunca se llama en el boot)', async () => {
    const config = parseEnv({ ...BASE, SUPABASE_SERVICE_ROLE_KEY: 'super-secret-service-role-key' });
    const app = Fastify();
    app.get('/health', async () => ({ status: 'ok' }));
    // El registro usa los DEFAULTS reales (incluido createSupabaseAuthUserDeleter): reproduce el camino
    // exacto que crasheaba en produccion. createClientMock LANZA: si el codigo fuera eager, este register/
    // ready rechazaria. Que resuelva demuestra directamente que el fix (lazy) evita el crash de boot.
    await app.register(dataSubjectRequestRoutes(config));
    await expect(app.ready()).resolves.toBeDefined();

    // El arranque NO crea el cliente admin: eso es LAZY (solo al borrar un usuario).
    expect(createClientMock).not.toHaveBeenCalled();
    // El health check responde (el servidor quedo arriba).
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('SIN la key (feature desactivada): el servidor arranca igual (el crash de boot original NO se reproduce)', async () => {
    const config = parseEnv(BASE); // sin SUPABASE_SERVICE_ROLE_KEY
    const app = Fastify();
    // No debe lanzar: registrar + ready resuelven aunque falte la key.
    await app.register(dataSubjectRequestRoutes(config));
    await expect(app.ready()).resolves.toBeDefined();
    expect(createClientMock).not.toHaveBeenCalled();
    await app.close();
  });
});
