import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { incomingTriggerRoutes } from '../src/routes/incoming-triggers.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';
import { encryptToToken } from '../src/crypto/aes-gcm.js';
import { signWebhookPayload } from '../src/tools/webhook-signature.js';
import { generateHmacSecret, generateUrlToken, hashUrlToken } from '../src/triggers/trigger-auth.js';

const VAULT = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: VAULT,
  VAULT_SECRET: VAULT,
};

const TRIGGER_ID = '99999999-9999-4999-8999-999999999999';
const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const CRED_ID = '22222222-2222-4222-8222-222222222222';
const NOW = 1_700_000_000;

const getByIdForDispatch = vi.fn();
const markTriggered = vi.fn();
const createJob = vi.fn();
let clockValue = NOW;

function dispatchTrigger(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIGGER_ID,
    ownerId: 'user-1',
    agentId: AGENT_ID,
    credentialId: CRED_ID,
    authMode: 'hmac',
    hmacSecretEncrypted: null,
    urlTokenHash: null,
    payloadTemplate: { messages: [{ role: 'user', content: 'base' }] },
    isActive: true,
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    incomingTriggerRoutes(config, {
      triggerRepo: { getByIdForDispatch, markTriggered },
      jobsRepo: { createJob },
      clock: () => clockValue,
    }),
  );
  // Ruta hermana con parseo JSON normal: prueba que el raw-body parser NO se filtro fuera del plugin.
  await app.register(async (scope) => {
    scope.post('/sibling', async (req) => ({ received: req.body }));
  });
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  clockValue = NOW;
  createJob.mockResolvedValue({ id: 'job-1' });
  markTriggered.mockResolvedValue(undefined);
  app = await makeApp();
});

function hmacHeaders(rawBody: string, secret: string, ts = NOW) {
  return {
    'content-type': 'application/json',
    'x-ledesma-timestamp': String(ts),
    'x-ledesma-signature': signWebhookPayload(rawBody, ts, secret),
  };
}

describe('POST /webhooks/triggers/:triggerId (hmac)', () => {
  const secret = generateHmacSecret();
  const raw = JSON.stringify({ evento: 'pago', monto: 100 });

  beforeEach(() => {
    getByIdForDispatch.mockResolvedValue(
      dispatchTrigger({ authMode: 'hmac', hmacSecretEncrypted: encryptToToken(secret, VAULT) }),
    );
  });

  it('firma valida -> 202 y encola un job pending con los datos del trigger + contexto del evento', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}`,
      headers: hmacHeaders(raw, secret),
      payload: raw,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'accepted' });

    expect(createJob).toHaveBeenCalledTimes(1);
    const job = createJob.mock.calls[0]?.[0];
    // Datos del trigger para que el worker lo ejecute (mismo patron que el scheduler).
    expect(job.agentId).toBe(AGENT_ID);
    expect(job.ownerId).toBe('user-1');
    expect(job.credentialId).toBe(CRED_ID);
    expect(job.scheduledFor).toBeUndefined(); // ASAP
    // payload = template + el evento entrante como mensaje user extra.
    expect(job.payload.messages[0]).toEqual({ role: 'user', content: 'base' });
    expect(job.payload.messages[1].role).toBe('user');
    expect(job.payload.messages[1].content).toContain('"evento":"pago"');
    // marca last_triggered_at.
    expect(markTriggered).toHaveBeenCalledWith(TRIGGER_ID);
  });

  it('firma invalida -> 401 (no encola)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}`,
      headers: {
        'content-type': 'application/json',
        'x-ledesma-timestamp': String(NOW),
        'x-ledesma-signature': 'deadbeef'.repeat(8),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(401);
    expect(createJob).not.toHaveBeenCalled();
    expect(markTriggered).not.toHaveBeenCalled();
  });

  it('body alterado tras firmar -> 401 (la firma es sobre el raw body exacto)', async () => {
    const headers = hmacHeaders(raw, secret);
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}`,
      headers,
      payload: raw + ' ', // un byte extra: la firma ya no corresponde
    });
    expect(res.statusCode).toBe(401);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('timestamp viejo (replay) -> 401', async () => {
    clockValue = NOW + 301; // 301s despues de la firma: fuera de la ventana anti-replay
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}`,
      headers: hmacHeaders(raw, secret, NOW),
      payload: raw,
    });
    expect(res.statusCode).toBe(401);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('faltan headers de firma -> 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}`,
      headers: { 'content-type': 'application/json' },
      payload: raw,
    });
    expect(res.statusCode).toBe(401);
    expect(createJob).not.toHaveBeenCalled();
  });
});

describe('POST /webhooks/triggers/:triggerId (url_token)', () => {
  const token = generateUrlToken();

  beforeEach(() => {
    getByIdForDispatch.mockResolvedValue(
      dispatchTrigger({ authMode: 'url_token', hmacSecretEncrypted: null, urlTokenHash: hashUrlToken(token) }),
    );
  });

  it('token correcto en la query -> 202 y encola', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}?token=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ x: 1 }),
    });
    expect(res.statusCode).toBe(202);
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(createJob.mock.calls[0]?.[0]?.ownerId).toBe('user-1');
    expect(markTriggered).toHaveBeenCalledWith(TRIGGER_ID);
  });

  it('token correcto en header x-trigger-token -> 202', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}`,
      headers: { 'content-type': 'application/json', 'x-trigger-token': token },
      payload: JSON.stringify({ x: 1 }),
    });
    expect(res.statusCode).toBe(202);
    expect(createJob).toHaveBeenCalledTimes(1);
  });

  it('content-type NO json (text/plain) sigue dando raw body -> 202 (parser catch-all)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}?token=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: 'datos-crudos',
    });
    expect(res.statusCode).toBe(202);
    expect(createJob).toHaveBeenCalledTimes(1);
  });

  it('token incorrecto -> 401 (no encola)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}?token=${encodeURIComponent(generateUrlToken())}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ x: 1 }),
    });
    expect(res.statusCode).toBe(401);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('sin token -> 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ x: 1 }),
    });
    expect(res.statusCode).toBe(401);
    expect(createJob).not.toHaveBeenCalled();
  });
});

describe('resolucion del trigger', () => {
  it('trigger inactivo -> 404 generico (no encola, no autentica)', async () => {
    getByIdForDispatch.mockResolvedValue(dispatchTrigger({ isActive: false }));
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}`,
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(createJob).not.toHaveBeenCalled();
  });

  it('trigger inexistente -> 404 generico', async () => {
    getByIdForDispatch.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}`,
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(404);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('id no-uuid -> 404 (no revela formato ni existencia)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/triggers/no-es-uuid',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(404);
    expect(getByIdForDispatch).not.toHaveBeenCalled();
  });
});

describe('composicion del payload', () => {
  const token = generateUrlToken();
  beforeEach(() => {
    getByIdForDispatch.mockResolvedValue(
      dispatchTrigger({ authMode: 'url_token', urlTokenHash: hashUrlToken(token) }),
    );
  });

  it('cuerpo vacio -> solo el template (sin mensaje de evento)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}?token=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(res.statusCode).toBe(202);
    const job = createJob.mock.calls[0]?.[0];
    expect(job.payload.messages).toHaveLength(1);
    expect(job.payload.messages[0]).toEqual({ role: 'user', content: 'base' });
  });

  it('cuerpo no-JSON -> solo el template (no se anexa basura)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/triggers/${TRIGGER_ID}?token=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/json' },
      payload: 'esto no es json',
    });
    expect(res.statusCode).toBe(202);
    expect(createJob.mock.calls[0]?.[0]?.payload.messages).toHaveLength(1);
  });
});

describe('encapsulacion del raw-body parser', () => {
  it('la ruta hermana sigue parseando JSON como objeto (el parser raw no se filtro)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sibling',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ a: 1, b: 'dos' }),
    });
    expect(res.statusCode).toBe(200);
    // Si el raw parser hubiera leakeado, req.body seria un string, no un objeto.
    expect(res.json().received).toEqual({ a: 1, b: 'dos' });
  });
});
