import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { verifyRelayToken } from '@ledesma-platform/shared/relay-token';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { sitiosRoutes } from '../src/routes/sitios.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';

const RELAY_SECRET = 'relay-secret-0123456789abcdef0123456789abcdef';

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const RELAY_ENV = {
  RELAY_TOKEN_SECRET: RELAY_SECRET,
  RELAY_PUBLIC_URL: 'wss://relay.ledesma.example/v1/relay/teclado',
};

const SITIO_ID = '11111111-1111-4111-8111-111111111111';

const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    if (token === 'valid-user-2') return { id: 'user-2', email: 'u2@test.com' };
    throw new Error('invalid');
  },
};

const obtenerPorId = vi.fn();
const getProfileTier = vi.fn();

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
    sesionExternaId: 'ses-remota-1',
    vistaEnVivoUrl: 'https://live.browserbase.example/ses-1',
    estado: 'esperando_login',
    tieneContexto: false,
    creadoEn: '2026-07-01T00:00:00.000Z',
    ultimoUsoEn: null,
    expiraEn: null,
    ...overrides,
  };
}

async function makeApp(extra: Record<string, string> = RELAY_ENV): Promise<FastifyInstance> {
  const config = parseEnv({ ...BASE, ...extra });
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    sitiosRoutes(config, {
      verifier,
      sitiosRepo: { listarPorOwner: vi.fn(), obtenerPorId },
      jobsRepo: { createJob: vi.fn() },
      registrationRepo: { getProfileTier, getProfilePais: vi.fn() },
    }),
  );
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  obtenerPorId.mockResolvedValue(null);
  getProfileTier.mockResolvedValue('autonomous');
});

describe('POST /v1/sitios/:id/relay-token', () => {
  it('sin JWT -> 401 sin tocar repos', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/v1/sitios/${SITIO_ID}/relay-token` });
    expect(res.statusCode).toBe(401);
    expect(obtenerPorId).not.toHaveBeenCalled();
  });

  it('sitio propio en esperando_login -> 201 con token ligado a (owner, conexion, sesion) y relayUrl', async () => {
    obtenerPorId.mockResolvedValue(makeSitio());
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sitios/${SITIO_ID}/relay-token`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { token: string; expiresAt: string; relayUrl: string; hs: string };
    expect(body.relayUrl).toBe(RELAY_ENV.RELAY_PUBLIC_URL);
    const claims = verifyRelayToken(body.token, RELAY_SECRET);
    expect(claims).not.toBeNull();
    expect(claims?.ownerId).toBe('user-1');
    expect(claims?.connectionId).toBe(SITIO_ID);
    expect(claims?.sesionExternaId).toBe('ses-remota-1');
    // El token NUNCA es la vista en vivo ni el connectUrl: solo la terna cifrada.
    expect(body.token).not.toContain('browserbase');
    // `hs` es el secreto de enlace del handshake (A-1): 32 bytes base64url, y coincide con el que el
    // token trae cifrado (bindingKey). El cliente lo recibe POR ESTE canal confiable con el backend.
    expect(Buffer.from(body.hs, 'base64url').length).toBe(32);
    expect(body.hs).toBe(claims?.bindingKey);
  });

  it('sitio de OTRO owner -> 404, sin acunar token', async () => {
    // user-2 pide token del sitio de user-1: obtenerPorId (acotado por owner) devuelve null.
    obtenerPorId.mockResolvedValue(null);
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sitios/${SITIO_ID}/relay-token`,
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(res.statusCode).toBe(404);
    expect(obtenerPorId).toHaveBeenCalledWith(SITIO_ID, 'user-2');
  });

  it('sitio sin login en curso (activo) -> 400', async () => {
    obtenerPorId.mockResolvedValue(makeSitio({ estado: 'activo', sesionExternaId: null }));
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sitios/${SITIO_ID}/relay-token`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('esperando_login pero sin sesion del proveedor -> 400', async () => {
    obtenerPorId.mockResolvedValue(makeSitio({ sesionExternaId: null }));
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sitios/${SITIO_ID}/relay-token`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('tier sin autonomia -> 403 sin revelar si el sitio existe', async () => {
    getProfileTier.mockResolvedValue('free');
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sitios/${SITIO_ID}/relay-token`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(403);
    expect(obtenerPorId).not.toHaveBeenCalled();
  });

  it('id no-uuid -> 400 sin consultar', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sitios/no-es-uuid/relay-token',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(obtenerPorId).not.toHaveBeenCalled();
  });

  it('relay NO configurado (sin RELAY_TOKEN_SECRET/RELAY_PUBLIC_URL) -> 501 RELAY_NO_DISPONIBLE', async () => {
    obtenerPorId.mockResolvedValue(makeSitio());
    const app = await makeApp({}); // sin RELAY_ENV
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sitios/${SITIO_ID}/relay-token`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe('RELAY_NO_DISPONIBLE');
  });
});
