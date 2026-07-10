import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { triggerRoutes } from '../src/routes/triggers.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';
import { decryptFromToken } from '../src/crypto/aes-gcm.js';
import { hashUrlToken } from '../src/triggers/trigger-auth.js';

const VAULT = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: VAULT,
  VAULT_SECRET: VAULT,
};

const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const CRED_ID = '22222222-2222-4222-8222-222222222222';
const TRIGGER_ID = '99999999-9999-4999-8999-999999999999';

const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    if (token === 'valid-user-2') return { id: 'user-2', email: 'u2@test.com' };
    throw new Error('invalid');
  },
};

const createTrigger = vi.fn();
const listByOwner = vi.fn();
const getForOwner = vi.fn();
const updateForOwner = vi.fn();
const deleteForOwner = vi.fn();
const getByIdForOwner = vi.fn();
const existsForOwner = vi.fn();
const getProfileTier = vi.fn();

function makeMeta(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIGGER_ID,
    ownerId: 'user-1',
    agentId: AGENT_ID,
    credentialId: CRED_ID,
    authMode: 'hmac',
    payloadTemplate: { messages: [{ role: 'user', content: 'hola' }] },
    isActive: true,
    lastTriggeredAt: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    triggerRoutes(config, {
      verifier,
      triggerRepo: { createTrigger, listByOwner, getForOwner, updateForOwner, deleteForOwner },
      agentRepo: { getByIdForOwner },
      credentialRepo: { existsForOwner },
      registrationRepo: { getProfileTier },
    }),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  getProfileTier.mockResolvedValue('autonomous');
  getByIdForOwner.mockResolvedValue({ id: AGENT_ID, ownerId: 'user-1' });
  existsForOwner.mockResolvedValue(true);
  app = await makeApp();
});

const hmacBody = {
  agentId: AGENT_ID,
  credentialId: CRED_ID,
  authMode: 'hmac',
  payloadTemplate: { messages: [{ role: 'user', content: 'reporte' }] },
};

describe('auth: /v1/triggers sin JWT -> 401', () => {
  it('POST', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/triggers', payload: hmacBody });
    expect(res.statusCode).toBe(401);
    expect(createTrigger).not.toHaveBeenCalled();
  });
  it('GET', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/triggers' })).statusCode).toBe(401);
  });
  it('PATCH', async () => {
    expect(
      (await app.inject({ method: 'PATCH', url: `/v1/triggers/${TRIGGER_ID}`, payload: { isActive: false } }))
        .statusCode,
    ).toBe(401);
  });
  it('DELETE', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/v1/triggers/${TRIGGER_ID}` })).statusCode).toBe(401);
  });
});

describe('POST /v1/triggers (hmac)', () => {
  it('crea con tier autonomous: devuelve el secreto UNA vez, guarda CIFRADO, owner del token', async () => {
    createTrigger.mockResolvedValue(makeMeta());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/triggers',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...hmacBody, ownerId: 'OTRO-MALICIOSO' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // El secreto se devuelve en claro UNA vez.
    expect(typeof body.hmacSecret).toBe('string');
    expect(body.hmacSecret).toMatch(/^[0-9a-f]{64}$/);
    // La URL entrante y las instrucciones de firma.
    expect(body.webhookUrl).toContain(`/webhooks/triggers/${TRIGGER_ID}`);
    expect(body.webhookUrl).not.toContain('token=');
    expect(body.signature).toMatchObject({ algorithm: 'HMAC-SHA256', timestampHeader: 'x-ledesma-timestamp' });

    const passed = createTrigger.mock.calls[0]?.[0];
    expect(passed.ownerId).toBe('user-1'); // del token, jamas del body
    expect(passed.authMode).toBe('hmac');
    expect(passed.urlTokenHash).toBeUndefined();
    // Lo guardado esta CIFRADO: al descifrar con VAULT_SECRET reproduce el secreto devuelto.
    expect(passed.hmacSecretEncrypted).not.toBe(body.hmacSecret);
    expect(decryptFromToken(passed.hmacSecretEncrypted, VAULT)).toBe(body.hmacSecret);
  });

  it('GATE POR PLAN: un tier sin autonomia (free) -> 403 (no genera ni crea)', async () => {
    getProfileTier.mockResolvedValue('free');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/triggers',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: hmacBody,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(createTrigger).not.toHaveBeenCalled();
  });

  it('tier pro (plan con autonomia) tambien crea: el gate deriva del modulo central, 201', async () => {
    getProfileTier.mockResolvedValue('pro');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/triggers',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: hmacBody,
    });
    expect(res.statusCode).toBe(201);
    expect(createTrigger).toHaveBeenCalledTimes(1);
  });

  it('tier null (sin registro) -> 403', async () => {
    getProfileTier.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/triggers',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: hmacBody,
    });
    expect(res.statusCode).toBe(403);
    expect(createTrigger).not.toHaveBeenCalled();
  });

  it('agente ajeno -> 404 (no crea)', async () => {
    getByIdForOwner.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/triggers',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: hmacBody,
    });
    expect(res.statusCode).toBe(404);
    expect(getByIdForOwner).toHaveBeenCalledWith(AGENT_ID, 'user-1');
    expect(createTrigger).not.toHaveBeenCalled();
  });

  it('credencial ajena -> 404 (no crea)', async () => {
    existsForOwner.mockResolvedValue(false);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/triggers',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: hmacBody,
    });
    expect(res.statusCode).toBe(404);
    expect(existsForOwner).toHaveBeenCalledWith('user-1', CRED_ID);
    expect(createTrigger).not.toHaveBeenCalled();
  });

  it('authMode invalido -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/triggers',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...hmacBody, authMode: 'basic' },
    });
    expect(res.statusCode).toBe(400);
    expect(createTrigger).not.toHaveBeenCalled();
  });

  it('payloadTemplate sin messages -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/triggers',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...hmacBody, payloadTemplate: { messages: [] } },
    });
    expect(res.statusCode).toBe(400);
    expect(createTrigger).not.toHaveBeenCalled();
  });
});

describe('POST /v1/triggers (url_token)', () => {
  it('crea y devuelve la URL con el token UNA vez; guarda solo el HASH', async () => {
    createTrigger.mockResolvedValue(makeMeta({ authMode: 'url_token' }));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/triggers',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...hmacBody, authMode: 'url_token' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.urlToken).toBe('string');
    expect(body.webhookUrl).toContain(`/webhooks/triggers/${TRIGGER_ID}?token=`);
    expect(body.webhookUrl).toContain(encodeURIComponent(body.urlToken));
    expect(body).not.toHaveProperty('hmacSecret');

    const passed = createTrigger.mock.calls[0]?.[0];
    expect(passed.authMode).toBe('url_token');
    expect(passed.hmacSecretEncrypted).toBeUndefined();
    // Se guarda el hash del token, no el token.
    expect(passed.urlTokenHash).toBe(hashUrlToken(body.urlToken));
    expect(passed.urlTokenHash).not.toBe(body.urlToken);
  });
});

describe('GET /v1/triggers', () => {
  it('lista del owner con URL entrante y SIN material de auth', async () => {
    listByOwner.mockResolvedValue([makeMeta(), makeMeta({ id: 'x', authMode: 'url_token' })]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/triggers',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(listByOwner).toHaveBeenCalledWith('user-1');
    const triggers = res.json().triggers;
    expect(triggers).toHaveLength(2);
    // hmac: muestra como firmar; url_token: URL sin el token (solo se mostro al crear).
    expect(triggers[0].signature).toMatchObject({ signatureHeader: 'x-ledesma-signature' });
    expect(triggers[0].webhookUrl).toContain('/webhooks/triggers/');
    expect(triggers[1].webhookUrl).not.toContain('token=');
    // Nunca hay secreto ni hash en el listado.
    const raw = JSON.stringify(triggers);
    expect(raw).not.toContain('hmacSecret');
    expect(raw).not.toContain('urlToken');
    expect(raw).not.toContain('Hash');
  });
});

describe('PATCH /v1/triggers/:id', () => {
  it('desactiva sin rotar: updateForOwner con isActive=false, sin nuevo secreto en la respuesta', async () => {
    getForOwner.mockResolvedValue(makeMeta());
    updateForOwner.mockResolvedValue(makeMeta({ isActive: false }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/triggers/${TRIGGER_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(200);
    const fields = updateForOwner.mock.calls[0]?.[2];
    expect(fields.isActive).toBe(false);
    expect(fields.hmacSecretEncrypted).toBeUndefined();
    expect(fields.urlTokenHash).toBeUndefined();
    expect(res.json()).not.toHaveProperty('hmacSecret');
  });

  it('rota un trigger hmac: devuelve NUEVO secreto una vez y lo pasa cifrado al update', async () => {
    getForOwner.mockResolvedValue(makeMeta({ authMode: 'hmac' }));
    updateForOwner.mockResolvedValue(makeMeta());
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/triggers/${TRIGGER_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { rotate: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hmacSecret).toMatch(/^[0-9a-f]{64}$/);
    const fields = updateForOwner.mock.calls[0]?.[2];
    expect(decryptFromToken(fields.hmacSecretEncrypted, VAULT)).toBe(body.hmacSecret);
    expect(fields.urlTokenHash).toBeUndefined();
  });

  it('rota un trigger url_token: devuelve NUEVO token + URL, pasa el hash al update', async () => {
    getForOwner.mockResolvedValue(makeMeta({ authMode: 'url_token' }));
    updateForOwner.mockResolvedValue(makeMeta({ authMode: 'url_token' }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/triggers/${TRIGGER_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { rotate: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.urlToken).toBe('string');
    expect(body.webhookUrl).toContain('token=');
    const fields = updateForOwner.mock.calls[0]?.[2];
    expect(fields.urlTokenHash).toBe(hashUrlToken(body.urlToken));
    expect(fields.hmacSecretEncrypted).toBeUndefined();
  });

  it('rota + activa a la vez', async () => {
    getForOwner.mockResolvedValue(makeMeta({ authMode: 'hmac', isActive: false }));
    updateForOwner.mockResolvedValue(makeMeta({ isActive: true }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/triggers/${TRIGGER_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { isActive: true, rotate: true },
    });
    expect(res.statusCode).toBe(200);
    const fields = updateForOwner.mock.calls[0]?.[2];
    expect(fields.isActive).toBe(true);
    expect(fields.hmacSecretEncrypted).toBeDefined();
  });

  it('body vacio -> 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/triggers/${TRIGGER_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(updateForOwner).not.toHaveBeenCalled();
  });

  it('trigger ajeno -> 404', async () => {
    getForOwner.mockResolvedValue(null);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/triggers/${TRIGGER_ID}`,
      headers: { authorization: 'Bearer valid-user-2' },
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(404);
    expect(getForOwner).toHaveBeenCalledWith(TRIGGER_ID, 'user-2');
    expect(updateForOwner).not.toHaveBeenCalled();
  });

  it('id no-uuid -> 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/triggers/no-uuid',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(400);
    expect(getForOwner).not.toHaveBeenCalled();
  });
});

describe('DELETE /v1/triggers/:id', () => {
  it('borra el propio -> 204', async () => {
    deleteForOwner.mockResolvedValue(true);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/triggers/${TRIGGER_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(204);
    expect(deleteForOwner).toHaveBeenCalledWith(TRIGGER_ID, 'user-1');
  });
  it('ajeno -> 404', async () => {
    deleteForOwner.mockResolvedValue(false);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/triggers/${TRIGGER_ID}`,
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(res.statusCode).toBe(404);
  });
  it('id no-uuid -> 400', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/triggers/no-uuid',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(deleteForOwner).not.toHaveBeenCalled();
  });
});
