import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { grabacionesRoutes } from '../src/routes/grabaciones.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';
import type { Grabacion } from '../src/grabaciones/grabaciones-repository.js';

/**
 * GRABACION DE TAREAS: los endpoints con los que el usuario le ENSENA una tarea al sistema.
 *
 * Lo que protegen estos tests, en orden de importancia:
 *  1. EL INVARIANTE: una grabacion SOLO se abre sobre un sitio en estado 'activo'. En
 *     'esperando_login' -- que es exactamente la pantalla donde el usuario teclea su contrasena -- se
 *     rechaza sin encolar nada.
 *  2. TENANCIA: el owner sale SIEMPRE del token; una grabacion ajena es 404.
 *  3. Ningun endpoint ejecuta nada inline: crear y confirmar solo ENCOLAN, con agente y credencial en
 *     null (estos jobs no corren ningun modelo).
 */

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const ID = '11111111-1111-4111-8111-111111111111';
const CONEXION = '22222222-2222-4222-8222-222222222222';

const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    throw new Error('invalid');
  },
};

const crear = vi.fn();
const obtener = vi.fn();
const terminar = vi.fn();
const obtenerPorId = vi.fn();
const createJob = vi.fn();
const getProfileTier = vi.fn();

function makeGrabacion(overrides: Partial<Grabacion> = {}): Grabacion {
  return {
    id: ID,
    ownerId: 'user-1',
    connectionId: CONEXION,
    dominio: 'app.ejemplo.com',
    descripcion: 'enviar el reporte semanal',
    estado: 'grabando',
    motivo: null,
    pasos: [],
    vistaEnVivoUrl: null,
    creadaEn: '2026-07-24T00:00:00.000Z',
    actualizadaEn: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    grabacionesRoutes(config, {
      verifier,
      grabacionesRepo: { crear, obtener, terminar },
      sitiosRepo: { obtenerPorId },
      jobsRepo: { createJob },
      registrationRepo: { getProfileTier },
    }),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  getProfileTier.mockResolvedValue('autonomous');
  obtenerPorId.mockResolvedValue({ id: CONEXION, dominio: 'app.ejemplo.com', estado: 'activo' });
  crear.mockImplementation(async () => makeGrabacion());
  obtener.mockResolvedValue(makeGrabacion());
  terminar.mockResolvedValue(true);
  createJob.mockResolvedValue({ id: 'job-1' });
  app = await makeApp();
});

const AUTH = { authorization: 'Bearer valid-user-1' };

describe('auth y gate por plan', () => {
  it('sin Authorization -> 401 y no se toca nada', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/grabaciones', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(crear).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('un plan sin autonomia -> 403 sin encolar nada', async () => {
    getProfileTier.mockResolvedValue('free');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/grabaciones',
      headers: AUTH,
      payload: { connectionId: CONEXION, descripcion: 'enviar el reporte' },
    });
    expect(res.statusCode).toBe(403);
    expect(createJob).not.toHaveBeenCalled();
  });
});

describe('POST /v1/grabaciones', () => {
  it('sobre un sitio ACTIVO crea la grabacion y encola el job sin agente ni credencial', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/grabaciones',
      headers: AUTH,
      payload: { connectionId: CONEXION, descripcion: 'enviar el reporte semanal' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'accepted', jobId: 'job-1' });
    expect(crear).toHaveBeenCalledWith({
      ownerId: 'user-1',
      connectionId: CONEXION,
      dominio: 'app.ejemplo.com',
      descripcion: 'enviar el reporte semanal',
    });
    expect(createJob).toHaveBeenCalledWith({
      agentId: null,
      ownerId: 'user-1',
      credentialId: null,
      payload: { kind: 'grabar_tarea', connectionId: CONEXION, grabacionId: ID },
    });
  });

  it('EL INVARIANTE: sobre un sitio en esperando_login se rechaza y no se graba nada', async () => {
    obtenerPorId.mockResolvedValue({ id: CONEXION, dominio: 'x.com', estado: 'esperando_login' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/grabaciones',
      headers: AUTH,
      payload: { connectionId: CONEXION, descripcion: 'algo' },
    });
    expect(res.statusCode).toBe(400);
    expect(crear).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('un sitio caducado tampoco se puede grabar', async () => {
    obtenerPorId.mockResolvedValue({ id: CONEXION, dominio: 'x.com', estado: 'caducado' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/grabaciones',
      headers: AUTH,
      payload: { connectionId: CONEXION, descripcion: 'algo' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('un sitio ajeno o inexistente -> 404', async () => {
    obtenerPorId.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/grabaciones',
      headers: AUTH,
      payload: { connectionId: CONEXION, descripcion: 'algo' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('una descripcion vacia -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/grabaciones',
      headers: AUTH,
      payload: { connectionId: CONEXION, descripcion: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(crear).not.toHaveBeenCalled();
  });
});

describe('GET /v1/grabaciones/:id', () => {
  it('devuelve la grabacion sin exponer el owner', async () => {
    obtener.mockResolvedValue(makeGrabacion({ vistaEnVivoUrl: 'https://vista' }));
    const res = await app.inject({ method: 'GET', url: `/v1/grabaciones/${ID}`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    const { grabacion } = res.json();
    expect(grabacion).toMatchObject({ id: ID, estado: 'grabando', vistaEnVivoUrl: 'https://vista' });
    expect(grabacion.ownerId).toBeUndefined();
    expect(obtener).toHaveBeenCalledWith(ID, 'user-1');
  });

  it('una grabacion ajena o inexistente -> 404', async () => {
    obtener.mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: `/v1/grabaciones/${ID}`, headers: AUTH });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /v1/grabaciones/:id/terminar', () => {
  it('termina la grabacion en curso', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/grabaciones/${ID}/terminar`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(terminar).toHaveBeenCalledWith(ID, 'user-1');
  });

  it('una grabacion que ya no estaba en curso -> 409', async () => {
    terminar.mockResolvedValue(false);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/grabaciones/${ID}/terminar`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('POST /v1/grabaciones/:id/confirmar', () => {
  beforeEach(() => {
    obtener.mockResolvedValue(makeGrabacion({ estado: 'terminada' }));
  });

  it('encola la promocion con los datos marcados, sin agente ni credencial', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/grabaciones/${ID}/confirmar`,
      headers: AUTH,
      payload: { variables: [{ idx: 2, marcador: 'destinatario' }] },
    });
    expect(res.statusCode).toBe(202);
    expect(createJob).toHaveBeenCalledWith({
      agentId: null,
      ownerId: 'user-1',
      credentialId: null,
      payload: {
        kind: 'promover_grabacion',
        grabacionId: ID,
        variables: [{ idx: 2, marcador: 'destinatario' }],
      },
    });
  });

  it('un tipo de dato inventado -> 400 sin encolar (el vocabulario es el de las recetas)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/grabaciones/${ID}/confirmar`,
      headers: AUTH,
      payload: { variables: [{ idx: 0, marcador: 'clave' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('una grabacion que todavia no termino -> 400', async () => {
    obtener.mockResolvedValue(makeGrabacion({ estado: 'grabando' }));
    const res = await app.inject({
      method: 'POST',
      url: `/v1/grabaciones/${ID}/confirmar`,
      headers: AUTH,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('una grabacion DESCARTADA por contrasena no se puede guardar', async () => {
    obtener.mockResolvedValue(makeGrabacion({ estado: 'descartada', motivo: 'contrasena' }));
    const res = await app.inject({
      method: 'POST',
      url: `/v1/grabaciones/${ID}/confirmar`,
      headers: AUTH,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(createJob).not.toHaveBeenCalled();
  });
});
