import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { sitiosRoutes } from '../src/routes/sitios.js';
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

const SITIO_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '99999999-9999-4999-8999-999999999999';

// Verifier falso (sin red): user-1 y user-2 validos; cualquier otro token invalido.
const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    if (token === 'valid-user-2') return { id: 'user-2', email: 'u2@test.com' };
    throw new Error('invalid');
  },
};

const listarPorOwner = vi.fn();
const obtenerPorId = vi.fn();
const createJob = vi.fn();
const getProfileTier = vi.fn();
const getProfilePais = vi.fn();

/** Un sitio conectado tal como lo devuelve el repositorio de 7.1a (camelCase, sin blobs). */
function makeSitio(overrides: Record<string, unknown> = {}) {
  return {
    id: SITIO_ID,
    ownerId: 'user-1',
    dominio: 'app.ejemplo.com',
    urlLogin: 'https://app.ejemplo.com/login',
    contextoExternoId: 'ctx-1',
    proxyRef: 'proxy-1',
    egressIp: '10.0.0.9',
    fingerprintRef: 'fp-1',
    sesionExternaId: 'ses-1',
    vistaEnVivoUrl: 'https://live.browserbase.example/ses-1',
    estado: 'esperando_login',
    tieneContexto: false,
    creadoEn: '2026-07-01T00:00:00.000Z',
    ultimoUsoEn: null,
    expiraEn: null,
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    sitiosRoutes(config, {
      verifier,
      sitiosRepo: { listarPorOwner, obtenerPorId },
      jobsRepo: { createJob },
      registrationRepo: { getProfileTier, getProfilePais },
    }),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  listarPorOwner.mockResolvedValue([]);
  obtenerPorId.mockResolvedValue(null);
  createJob.mockResolvedValue({ id: JOB_ID });
  getProfileTier.mockResolvedValue('autonomous');
  // Por defecto el perfil NO tiene pais declarado: cada test que lo necesite lo setea explicito.
  getProfilePais.mockResolvedValue(null);
  app = await makeApp();
});

describe('auth: sin JWT -> 401 en todas las rutas', () => {
  it.each([
    ['POST', '/v1/sitios/conectar'],
    ['GET', '/v1/sitios'],
    ['POST', `/v1/sitios/${SITIO_ID}/confirmar`],
    ['DELETE', `/v1/sitios/${SITIO_ID}`],
  ] as const)('%s %s -> 401 (no toca repos)', async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(401);
    expect(createJob).not.toHaveBeenCalled();
    expect(listarPorOwner).not.toHaveBeenCalled();
  });
});

describe('POST /v1/sitios/conectar', () => {
  it('encola conectar_sitio con agentId/credentialId NULOS, el pais NORMALIZADO y responde 202', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sitios/conectar',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { url: 'https://App.Ejemplo.com/login', pais: 'ar' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'accepted', jobId: JOB_ID, dominio: 'app.ejemplo.com' });
    expect(createJob).toHaveBeenCalledWith({
      agentId: null,
      ownerId: 'user-1',
      credentialId: null,
      payload: { kind: 'conectar_sitio', url: 'https://App.Ejemplo.com/login', pais: 'AR' },
    });
  });

  it('sin pais en el body: usa el DECLARADO en el perfil (profiles.pais, V029)', async () => {
    getProfilePais.mockResolvedValue('CL');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sitios/conectar',
      // Accept-Language presente A PROPOSITO: el perfil tiene prioridad sobre la heuristica.
      headers: { authorization: 'Bearer valid-user-1', 'accept-language': 'es-AR,es;q=0.9' },
      payload: { url: 'https://app.ejemplo.com/login' },
    });
    expect(res.statusCode).toBe(202);
    expect(getProfilePais).toHaveBeenCalledWith('user-1');
    const payload = createJob.mock.calls[0]?.[0]?.payload as Record<string, unknown>;
    expect(payload.pais).toBe('CL');
  });

  it('con pais en el body NO se lee el perfil: el body (lo que manda la consola) tiene prioridad', async () => {
    getProfilePais.mockResolvedValue('CL');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sitios/conectar',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { url: 'https://app.ejemplo.com/login', pais: 'uy' },
    });
    expect(res.statusCode).toBe(202);
    expect(getProfilePais).not.toHaveBeenCalled();
    const payload = createJob.mock.calls[0]?.[0]?.payload as Record<string, unknown>;
    expect(payload.pais).toBe('UY');
  });

  it('sin pais en body ni perfil: lo deriva de Accept-Language (region del primer tag)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sitios/conectar',
      headers: { authorization: 'Bearer valid-user-1', 'accept-language': 'es-AR,es;q=0.9,en;q=0.8' },
      payload: { url: 'https://app.ejemplo.com/login' },
    });
    expect(res.statusCode).toBe(202);
    const payload = createJob.mock.calls[0]?.[0]?.payload as Record<string, unknown>;
    expect(payload.pais).toBe('AR');
  });

  it('sin pais derivable (ni body, ni perfil, ni Accept-Language): 400 accionable, JAMAS un default silencioso', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sitios/conectar',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { url: 'https://app.ejemplo.com/login' },
    });
    expect(res.statusCode).toBe(400);
    // Codigo propio para que la consola lo traduzca, y mensaje accionable para el usuario final en
    // ES y EN (declarar el pais en el perfil), no un detalle tecnico del body.
    expect(res.json().error.code).toBe('PAIS_REQUERIDO');
    expect(res.json().error.message).toContain('pais');
    expect(res.json().error.message).toContain('country');
    expect(createJob).not.toHaveBeenCalled();
  });

  it('pais invalido en el body (no ISO-2) -> 400 sin encolar', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sitios/conectar',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { url: 'https://app.ejemplo.com/login', pais: 'ARG' },
    });
    expect(res.statusCode).toBe(400);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('el body SOLO admite url y pais: no existe ningun campo de contrasena en este flujo', async () => {
    // Un body con password extra no rompe (zod lo descarta), pero JAMAS llega al payload del job.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sitios/conectar',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { url: 'https://app.ejemplo.com/login', pais: 'AR', password: 'super-secreta' },
    });
    expect(res.statusCode).toBe(202);
    const payload = createJob.mock.calls[0]?.[0]?.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['kind', 'pais', 'url']);
    expect(JSON.stringify(payload)).not.toContain('super-secreta');
  });

  it('url invalida (no URL) -> 400 sin encolar', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sitios/conectar',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { url: 'no-es-una-url' },
    });
    expect(res.statusCode).toBe(400);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('url con esquema no http(s) -> 400 sin encolar', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sitios/conectar',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { url: 'javascript:alert(1)' },
    });
    expect(res.statusCode).toBe(400);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('tier sin autonomia -> 403 sin encolar', async () => {
    getProfileTier.mockResolvedValue('free');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sitios/conectar',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { url: 'https://app.ejemplo.com/login', pais: 'AR' },
    });
    expect(res.statusCode).toBe(403);
    expect(createJob).not.toHaveBeenCalled();
  });
});

describe('GET /v1/sitios', () => {
  it('lista los sitios del owner del token con el DTO minimo (sin ids del proveedor ni terna de red)', async () => {
    listarPorOwner.mockResolvedValue([makeSitio()]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sitios',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(listarPorOwner).toHaveBeenCalledWith('user-1');
    const [sitio] = res.json().sitios;
    expect(sitio).toEqual({
      id: SITIO_ID,
      dominio: 'app.ejemplo.com',
      estado: 'esperando_login',
      vistaEnVivoUrl: 'https://live.browserbase.example/ses-1',
      creadoEn: '2026-07-01T00:00:00.000Z',
      ultimoUsoEn: null,
    });
    // Lo interno JAMAS viaja: ni ids del proveedor, ni la terna pineada, ni contexto alguno.
    expect(sitio).not.toHaveProperty('contextoExternoId');
    expect(sitio).not.toHaveProperty('proxyRef');
    expect(sitio).not.toHaveProperty('egressIp');
    expect(sitio).not.toHaveProperty('fingerprintRef');
    expect(sitio).not.toHaveProperty('sesionExternaId');
    expect(sitio).not.toHaveProperty('tieneContexto');
  });

  it('el owner sale del token: user-2 lista lo suyo', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/sitios',
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(listarPorOwner).toHaveBeenCalledWith('user-2');
  });
});

describe('POST /v1/sitios/:id/confirmar', () => {
  it('encola confirmar_conexion para un sitio propio esperando login -> 202', async () => {
    obtenerPorId.mockResolvedValue(makeSitio());
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sitios/${SITIO_ID}/confirmar`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'accepted', jobId: JOB_ID });
    expect(obtenerPorId).toHaveBeenCalledWith(SITIO_ID, 'user-1');
    expect(createJob).toHaveBeenCalledWith({
      agentId: null,
      ownerId: 'user-1',
      credentialId: null,
      payload: { kind: 'confirmar_conexion', connectionId: SITIO_ID },
    });
  });

  it('sitio ajeno o inexistente -> 404 sin encolar', async () => {
    obtenerPorId.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sitios/${SITIO_ID}/confirmar`,
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(res.statusCode).toBe(404);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('sitio sin login en curso (activo) -> 400 sin encolar', async () => {
    obtenerPorId.mockResolvedValue(makeSitio({ estado: 'activo', vistaEnVivoUrl: null }));
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sitios/${SITIO_ID}/confirmar`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('id no-uuid -> 400 sin consultar', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sitios/no-es-uuid/confirmar',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(obtenerPorId).not.toHaveBeenCalled();
  });

  it('tier sin autonomia -> 403 sin revelar si el sitio existe', async () => {
    getProfileTier.mockResolvedValue('free');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sitios/${SITIO_ID}/confirmar`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(403);
    expect(obtenerPorId).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });
});

describe('DELETE /v1/sitios/:id', () => {
  it('encola desconectar_sitio para un sitio propio -> 202', async () => {
    obtenerPorId.mockResolvedValue(makeSitio({ estado: 'activo' }));
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/sitios/${SITIO_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'accepted', jobId: JOB_ID });
    expect(createJob).toHaveBeenCalledWith({
      agentId: null,
      ownerId: 'user-1',
      credentialId: null,
      payload: { kind: 'desconectar_sitio', connectionId: SITIO_ID },
    });
  });

  it('con ?force=true encola el payload con force: true (borrado garantizado) -> 202', async () => {
    obtenerPorId.mockResolvedValue(makeSitio({ estado: 'activo' }));
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/sitios/${SITIO_ID}?force=true`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(202);
    expect(createJob).toHaveBeenCalledWith({
      agentId: null,
      ownerId: 'user-1',
      credentialId: null,
      payload: { kind: 'desconectar_sitio', connectionId: SITIO_ID, force: true },
    });
  });

  // El borrado FORZADO es la salida para filas atascadas: se acepta desde CUALQUIER estado.
  it.each(['activo', 'esperando_login', 'error', 'caducado'] as const)(
    'con ?force=true desde estado %s -> 202 con force en el payload',
    async (estado) => {
      obtenerPorId.mockResolvedValue(makeSitio({ estado, sesionExternaId: null, vistaEnVivoUrl: null }));
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/sitios/${SITIO_ID}?force=true`,
        headers: { authorization: 'Bearer valid-user-1' },
      });
      expect(res.statusCode).toBe(202);
      expect(createJob).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { kind: 'desconectar_sitio', connectionId: SITIO_ID, force: true },
        }),
      );
    },
  );

  it('la clave repetida (?force=true&force=true) sigue siendo borrado forzado, jamas se degrada', async () => {
    obtenerPorId.mockResolvedValue(makeSitio({ estado: 'activo' }));
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/sitios/${SITIO_ID}?force=true&force=true`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(202);
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { kind: 'desconectar_sitio', connectionId: SITIO_ID, force: true },
      }),
    );
  });

  it('un force distinto del literal true (false, basura) es el flujo limpio, sin force', async () => {
    obtenerPorId.mockResolvedValue(makeSitio({ estado: 'activo' }));
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/sitios/${SITIO_ID}?force=si`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(202);
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { kind: 'desconectar_sitio', connectionId: SITIO_ID },
      }),
    );
  });

  // Desconectar se permite desde CUALQUIER estado: una fila atascada en 'error' o 'esperando_login'
  // (sesion del proveedor expirada, modal cerrado a medias) se limpia igual; el worker es idempotente
  // ante el contexto remoto ya inexistente. Regresion del defecto de estados huerfanos.
  it.each(['error', 'esperando_login', 'caducado'] as const)(
    'encola desconectar_sitio desde estado %s -> 202',
    async (estado) => {
      obtenerPorId.mockResolvedValue(makeSitio({ estado, sesionExternaId: null, vistaEnVivoUrl: null }));
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/sitios/${SITIO_ID}`,
        headers: { authorization: 'Bearer valid-user-1' },
      });
      expect(res.statusCode).toBe(202);
      expect(createJob).toHaveBeenCalledWith({
        agentId: null,
        ownerId: 'user-1',
        credentialId: null,
        payload: { kind: 'desconectar_sitio', connectionId: SITIO_ID },
      });
    },
  );

  it('sitio ajeno o inexistente -> 404 sin encolar', async () => {
    obtenerPorId.mockResolvedValue(null);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/sitios/${SITIO_ID}`,
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(res.statusCode).toBe(404);
    expect(createJob).not.toHaveBeenCalled();
  });
});
