import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { adminAtlasSitiosRoutes } from '../src/routes/admin-atlas-sitios.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';

/**
 * ADMINISTRACION MINIMA del ATLAS DE SITIOS (V040): purgar por dominio. Gate por x-admin-token (la
 * fuente unica requireAdmin), sin endpoint de lectura y sin UI de usuario en esta fase.
 */

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const purgarDominio = vi.fn();

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(adminAtlasSitiosRoutes(config, { atlasRepo: { purgarDominio } }));
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  purgarDominio.mockResolvedValue(3);
  app = await makeApp();
});

const URL = '/v1/admin/atlas-sitios/purgar';

describe('POST /v1/admin/atlas-sitios/purgar', () => {
  it('sin token admin responde 401 y no toca la base', async () => {
    const res = await app.inject({ method: 'POST', url: URL, payload: { dominio: 'mail.ejemplo.com' } });
    expect(res.statusCode).toBe(401);
    expect(purgarDominio).not.toHaveBeenCalled();
  });

  it('con token invalido responde 401 y no toca la base', async () => {
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { 'x-admin-token': 'otro' },
      payload: { dominio: 'mail.ejemplo.com' },
    });
    expect(res.statusCode).toBe(401);
    expect(purgarDominio).not.toHaveBeenCalled();
  });

  it('con token admin purga el dominio y devuelve cuantas entradas se fueron', async () => {
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { 'x-admin-token': BASE.ADMIN_API_TOKEN },
      payload: { dominio: 'MAIL.Ejemplo.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ dominio: 'mail.ejemplo.com', purgadas: 3 });
    expect(purgarDominio).toHaveBeenCalledWith('mail.ejemplo.com');
  });

  it('un dominio que no es un hostname se rechaza en vez de purgar cero filas en silencio', async () => {
    for (const dominio of ['https://mail.ejemplo.com/', 'mail.ejemplo.com/inbox', '*', 'localhost']) {
      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: { 'x-admin-token': BASE.ADMIN_API_TOKEN },
        payload: { dominio },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(purgarDominio).not.toHaveBeenCalled();
  });

  it('sin dominio responde 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { 'x-admin-token': BASE.ADMIN_API_TOKEN },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(purgarDominio).not.toHaveBeenCalled();
  });
});
