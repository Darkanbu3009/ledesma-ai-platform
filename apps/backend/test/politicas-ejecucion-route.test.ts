import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { politicasEjecucionRoutes } from '../src/routes/politicas-ejecucion.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';
import type { PoliticaEjecucion } from '../src/politicas/politicas-ejecucion-repository.js';

/**
 * POLITICA DE EJECUCION (V034): los tres ajustes que el usuario configura UNA sola vez. Lo critico
 * de esta superficie es la TENANCIA: el owner sale SIEMPRE del token y jamas del body, asi que no
 * existe forma de leer ni de escribir la politica de otro usuario. Lo segundo es que un GET no
 * escribe: sin fila configurada devuelve los defaults sin crear nada.
 */

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    if (token === 'valid-user-2') return { id: 'user-2', email: 'u2@test.com' };
    throw new Error('invalid');
  },
};

const obtenerPorOwner = vi.fn();
const guardar = vi.fn();

function makePolitica(overrides: Partial<PoliticaEjecucion> = {}): PoliticaEjecucion {
  return {
    ownerId: 'user-1',
    ejecutarAccionesIrreversibles: true,
    topeMontoSinConfirmacion: 5000,
    sitiosExcluidos: ['banco.com'],
    creadaEn: '2026-07-20T00:00:00.000Z',
    actualizadaEn: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    politicasEjecucionRoutes(config, { verifier, politicasRepo: { obtenerPorOwner, guardar } }),
  );
  return app;
}

const BODY_VALIDO = {
  ejecutarAccionesIrreversibles: true,
  topeMontoSinConfirmacion: 5000,
  sitiosExcluidos: ['banco.com'],
};

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  obtenerPorOwner.mockResolvedValue(null);
  guardar.mockImplementation(async (ownerId: string, input: typeof BODY_VALIDO) =>
    makePolitica({ ownerId, ...input }),
  );
  app = await makeApp();
});

describe('auth', () => {
  it('sin Authorization -> 401 en GET y PUT, sin tocar el repositorio', async () => {
    for (const [method, url] of [
      ['GET', '/v1/politicas-ejecucion'],
      ['PUT', '/v1/politicas-ejecucion'],
    ] as const) {
      const res = await app.inject({ method, url, payload: method === 'PUT' ? BODY_VALIDO : undefined });
      expect(res.statusCode).toBe(401);
    }
    expect(obtenerPorOwner).not.toHaveBeenCalled();
    expect(guardar).not.toHaveBeenCalled();
  });

  it('token invalido -> 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/politicas-ejecucion',
      headers: { authorization: 'Bearer basura' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('tenancia: el owner sale del token, nunca del body', () => {
  it('GET lee SOLO la politica del owner del token', async () => {
    obtenerPorOwner.mockResolvedValue(makePolitica({ ownerId: 'user-2' }));
    await app.inject({
      method: 'GET',
      url: '/v1/politicas-ejecucion',
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(obtenerPorOwner).toHaveBeenCalledWith('user-2');
    expect(obtenerPorOwner).not.toHaveBeenCalledWith('user-1');
  });

  it('PUT con un ownerId inventado en el body escribe igual sobre el owner del TOKEN', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/politicas-ejecucion',
      headers: { authorization: 'Bearer valid-user-2' },
      payload: { ...BODY_VALIDO, ownerId: 'user-1', owner_id: 'user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(guardar.mock.calls[0]?.[0]).toBe('user-2');
    // El body no aporta identidad: solo los tres ajustes llegan al repositorio.
    expect(Object.keys(guardar.mock.calls[0]?.[1] as object).sort()).toEqual([
      'ejecutarAccionesIrreversibles',
      'sitiosExcluidos',
      'topeMontoSinConfirmacion',
    ]);
  });

  it('dos usuarios distintos consultan cada uno lo suyo', async () => {
    obtenerPorOwner.mockImplementation(async (ownerId: string) =>
      ownerId === 'user-1' ? makePolitica({ topeMontoSinConfirmacion: 1 }) : makePolitica({ topeMontoSinConfirmacion: 2 }),
    );
    const uno = await app.inject({
      method: 'GET',
      url: '/v1/politicas-ejecucion',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    const dos = await app.inject({
      method: 'GET',
      url: '/v1/politicas-ejecucion',
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(uno.json().politica.topeMontoSinConfirmacion).toBe(1);
    expect(dos.json().politica.topeMontoSinConfirmacion).toBe(2);
  });
});

describe('GET', () => {
  it('sin fila configurada devuelve los DEFAULTS y no escribe nada', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/politicas-ejecucion',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().politica).toEqual({
      ejecutarAccionesIrreversibles: true,
      topeMontoSinConfirmacion: 0,
      sitiosExcluidos: [],
      configurada: false,
    });
    expect(guardar).not.toHaveBeenCalled();
  });

  it('con fila devuelve los ajustes guardados marcados como configurados', async () => {
    obtenerPorOwner.mockResolvedValue(makePolitica());
    const res = await app.inject({
      method: 'GET',
      url: '/v1/politicas-ejecucion',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.json().politica).toEqual({
      ejecutarAccionesIrreversibles: true,
      topeMontoSinConfirmacion: 5000,
      sitiosExcluidos: ['banco.com'],
      configurada: true,
    });
  });
});

describe('PUT: validacion', () => {
  it('normaliza los dominios (URL pegada, mayusculas, www) y deduplica', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/politicas-ejecucion',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: {
        ...BODY_VALIDO,
        sitiosExcluidos: ['https://WWW.Banco.com/login?x=1', 'banco.com', 'sat.gob.mx:443'],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(guardar.mock.calls[0]?.[1]).toMatchObject({
      sitiosExcluidos: ['banco.com', 'sat.gob.mx'],
    });
  });

  it('un dominio que no queda como dominio -> 400 (nunca se guarda a medias)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/politicas-ejecucion',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...BODY_VALIDO, sitiosExcluidos: ['no es un dominio'] },
    });
    expect(res.statusCode).toBe(400);
    expect(guardar).not.toHaveBeenCalled();
  });

  it('un tope negativo -> 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/politicas-ejecucion',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...BODY_VALIDO, topeMontoSinConfirmacion: -1 },
    });
    expect(res.statusCode).toBe(400);
    expect(guardar).not.toHaveBeenCalled();
  });

  it('un tope que no es numero -> 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/politicas-ejecucion',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...BODY_VALIDO, topeMontoSinConfirmacion: 'muchisimo' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('apagar las acciones irreversibles se guarda tal cual', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/politicas-ejecucion',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...BODY_VALIDO, ejecutarAccionesIrreversibles: false },
    });
    expect(res.statusCode).toBe(200);
    expect(guardar.mock.calls[0]?.[1]).toMatchObject({ ejecutarAccionesIrreversibles: false });
  });
});
