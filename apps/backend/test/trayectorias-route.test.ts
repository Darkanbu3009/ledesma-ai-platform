import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { trayectoriasRoutes } from '../src/routes/trayectorias.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';
import type { TrayectoriaConPasos } from '../src/trayectorias/trayectorias-repository.js';

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const JOB_ID = '99999999-9999-4999-8999-999999999999';
const CONNECTION_ID = '88888888-8888-4888-8888-888888888888';

// Verifier falso (sin red): user-1 valido; cualquier otro token invalido.
const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    throw new Error('invalid');
  },
};

const listarPorJobConPasos = vi.fn();

function makeTrayectoria(overrides: Partial<TrayectoriaConPasos> = {}): TrayectoriaConPasos {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    ownerId: 'user-1',
    jobId: JOB_ID,
    connectionId: CONNECTION_ID,
    dominio: 'en.wikipedia.org',
    objetivo: 'lee el articulo destacado y resumelo',
    estado: 'exitosa',
    iniciadaEn: '2026-07-20T00:00:00.000Z',
    terminadaEn: '2026-07-20T00:00:42.000Z',
    duracionMs: 42_000,
    tokensIn: 1200,
    tokensOut: 340,
    creadaEn: '2026-07-20T00:00:42.000Z',
    pasos: [
      {
        id: 'paso-1',
        idx: 0,
        accion: { tipo: 'goto', instruccion: 'https://en.wikipedia.org/', metodo: null, argumentos: [] },
        selector: null,
        valorCensurado: null,
        url: 'https://en.wikipedia.org/',
        exito: true,
        creadoEn: '2026-07-20T00:00:10.000Z',
      },
    ],
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(trayectoriasRoutes(config, { verifier, trayectoriasRepo: { listarPorJobConPasos } }));
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  listarPorJobConPasos.mockResolvedValue([]);
  app = await makeApp();
});

describe('GET /v1/trayectorias', () => {
  it('sin token: 401 y el repo ni se toca', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/trayectorias?jobId=${JOB_ID}` });
    expect(res.statusCode).toBe(401);
    expect(listarPorJobConPasos).not.toHaveBeenCalled();
  });

  it('jobId invalido (no uuid): 400 de validacion', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/trayectorias?jobId=no-es-uuid',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(listarPorJobConPasos).not.toHaveBeenCalled();
  });

  it('sin jobId: 400 (el listado siempre es por job, nunca "todo")', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/trayectorias',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('devuelve las trayectorias del job con sus pasos, SIN ownerId, acotadas al owner del token', async () => {
    listarPorJobConPasos.mockResolvedValue([makeTrayectoria()]);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/trayectorias?jobId=${JOB_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    // El owner SIEMPRE sale del token (segundo argumento), jamas del cliente.
    expect(listarPorJobConPasos).toHaveBeenCalledWith(JOB_ID, 'user-1');
    const body = res.json() as { trayectorias: Array<Record<string, unknown>> };
    expect(body.trayectorias).toHaveLength(1);
    const dto = body.trayectorias[0];
    expect(dto).toMatchObject({
      jobId: JOB_ID,
      dominio: 'en.wikipedia.org',
      estado: 'exitosa',
      duracionMs: 42_000,
      tokensIn: 1200,
      tokensOut: 340,
    });
    // El DTO no filtra el owner ni ids internos de los pasos.
    expect(dto).not.toHaveProperty('ownerId');
    expect((dto?.pasos as unknown[])[0]).toMatchObject({
      idx: 0,
      selector: null,
      url: 'https://en.wikipedia.org/',
      exito: true,
    });
    expect((dto?.pasos as Array<Record<string, unknown>>)[0]).not.toHaveProperty('id');
  });

  it('job ajeno o sin trayectorias: lista vacia (misma respuesta, sin filtrar existencia)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/trayectorias?jobId=${JOB_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ trayectorias: [] });
  });
});
