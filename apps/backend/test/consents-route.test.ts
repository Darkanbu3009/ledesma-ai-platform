import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { consentRoutes } from '../src/routes/consents.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';
import { CURRENT_DOCUMENT_VERSIONS } from '../src/privacy/documents.js';

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

const recordConsent = vi.fn();
const listConsentsByOwner = vi.fn();

function makeConsent(overrides: Record<string, unknown> = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    ownerId: 'user-1',
    documentType: 'privacy_notice',
    documentVersion: CURRENT_DOCUMENT_VERSIONS.privacy_notice,
    acceptedAt: '2026-06-30T00:00:00.000Z',
    ipAddress: '10.0.0.1',
    userAgent: 'jest',
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(consentRoutes(config, { verifier, consentRepo: { recordConsent, listConsentsByOwner } }));
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  app = await makeApp();
});

describe('auth', () => {
  it('POST /v1/consents sin JWT -> 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/consents', payload: { document_type: 'privacy_notice', document_version: '2025-03-21' } });
    expect(res.statusCode).toBe(401);
    expect(recordConsent).not.toHaveBeenCalled();
  });
  it('GET /v1/consents/me sin JWT -> 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/consents/me' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/consents', () => {
  it('registra el consentimiento con owner del token (jamas del body) -> 201', async () => {
    recordConsent.mockResolvedValue(makeConsent());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/consents',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { document_type: 'privacy_notice', document_version: CURRENT_DOCUMENT_VERSIONS.privacy_notice, ownerId: 'MALICIOSO' },
    });
    expect(res.statusCode).toBe(201);
    const passed = recordConsent.mock.calls[0]?.[0];
    expect(passed.ownerId).toBe('user-1');
    expect(passed.documentType).toBe('privacy_notice');
    expect(passed.documentVersion).toBe(CURRENT_DOCUMENT_VERSIONS.privacy_notice);
    expect(res.json().consent.id).toBeDefined();
  });

  it('captura ip/user-agent como evidencia', async () => {
    recordConsent.mockResolvedValue(makeConsent());
    await app.inject({
      method: 'POST',
      url: '/v1/consents',
      headers: { authorization: 'Bearer valid-user-1', 'user-agent': 'Mozilla/5.0 test' },
      payload: { document_type: 'terms', document_version: '2025-03-21' },
    });
    const passed = recordConsent.mock.calls[0]?.[0];
    expect(passed.userAgent).toBe('Mozilla/5.0 test');
    expect(typeof passed.ipAddress === 'string' || passed.ipAddress === null).toBe(true);
  });

  it('document_type invalido -> 400 (no registra)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/consents',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { document_type: 'otro', document_version: '2025-03-21' },
    });
    expect(res.statusCode).toBe(400);
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it('document_version vacio -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/consents',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { document_type: 'privacy_notice', document_version: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(recordConsent).not.toHaveBeenCalled();
  });
});

describe('GET /v1/consents/me', () => {
  it('con las versiones vigentes aceptadas -> missing vacio', async () => {
    listConsentsByOwner.mockResolvedValue([
      makeConsent({ documentType: 'privacy_notice', documentVersion: CURRENT_DOCUMENT_VERSIONS.privacy_notice }),
      makeConsent({ documentType: 'terms', documentVersion: CURRENT_DOCUMENT_VERSIONS.terms }),
    ]);
    const res = await app.inject({ method: 'GET', url: '/v1/consents/me', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(200);
    expect(listConsentsByOwner).toHaveBeenCalledWith('user-1');
    const body = res.json();
    expect(body.missing).toEqual([]);
    expect(body.current).toEqual(CURRENT_DOCUMENT_VERSIONS);
  });

  it('sin ningun consentimiento -> missing exige solo privacy_notice (terms no se fuerza aun)', async () => {
    listConsentsByOwner.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/v1/consents/me', headers: { authorization: 'Bearer valid-user-2' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().missing).toEqual(['privacy_notice']);
    expect(res.json().missing).not.toContain('terms');
  });

  it('con una version VIEJA -> ese documento sigue en missing (re-aceptar por cambio de version)', async () => {
    listConsentsByOwner.mockResolvedValue([
      makeConsent({ documentType: 'privacy_notice', documentVersion: '1900-01-01' }),
      makeConsent({ documentType: 'terms', documentVersion: CURRENT_DOCUMENT_VERSIONS.terms }),
    ]);
    const res = await app.inject({ method: 'GET', url: '/v1/consents/me', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.json().missing).toEqual(['privacy_notice']);
  });
});
