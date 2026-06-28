import { describe, it, expect, vi, beforeEach } from 'vitest';

const { registerIndividualMock, registerOrganizationMock, getStateMock, approveOrganizationMock } = vi.hoisted(() => ({
  registerIndividualMock: vi.fn(),
  registerOrganizationMock: vi.fn(),
  getStateMock: vi.fn(),
  approveOrganizationMock: vi.fn(),
}));

vi.mock('../src/registration/registration-repository.js', () => ({
  RegistrationRepository: class {
    registerIndividual = registerIndividualMock;
    registerOrganization = registerOrganizationMock;
    getState = getStateMock;
    approveOrganization = approveOrganizationMock;
  },
}));
vi.mock('../src/db/client.js', () => ({ getSql: vi.fn(() => ({})), setSqlForTesting: vi.fn() }));

// Mockeamos jose para verificar JWT sin red (mismo enfoque que agents-route.test.ts).
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: vi.fn(async (token: string) => {
    if (token === 'valid-user-1') return { payload: { sub: 'user-1', email: 'u1@test.com' } };
    throw new Error('invalid');
  }),
}));

import { buildServer } from '../src/server.js';
import { parseEnv } from '../src/config/env.js';
import type { FastifyInstance } from 'fastify';

const ADMIN_TOKEN = 'test-admin-token-1234567890';
const ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: ADMIN_TOKEN,
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const individualState = {
  created: true,
  needsRegistration: false,
  profile: { id: 'user-1', orgId: null, accountType: 'individual', role: 'individual', fullName: 'Ada', identityVerified: false, createdAt: 'x', updatedAt: 'x' },
  organization: null,
  subscription: { id: 's1', profileId: 'user-1', plan: 'free', status: 'active', createdAt: 'x' },
  usageCounter: { id: 'u1', profileId: 'user-1', runsUsed: 0, runsLimit: 10, periodKind: 'lifetime', createdAt: 'x' },
};

let app: FastifyInstance;
beforeEach(async () => {
  registerIndividualMock.mockReset();
  registerOrganizationMock.mockReset();
  getStateMock.mockReset();
  approveOrganizationMock.mockReset();
  app = await buildServer(parseEnv(ENV));
});

describe('POST /v1/register/individual', () => {
  it('401 sin Authorization', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/register/individual', payload: { full_name: 'Ada' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(registerIndividualMock).not.toHaveBeenCalled();
  });

  it('400 si falta full_name', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/register/individual', headers: { authorization: 'Bearer valid-user-1' }, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(registerIndividualMock).not.toHaveBeenCalled();
  });

  it('201 al crear, pasando el sub del token como identidad', async () => {
    registerIndividualMock.mockResolvedValue(individualState);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/register/individual',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { full_name: 'Ada' },
    });
    expect(res.statusCode).toBe(201);
    expect(registerIndividualMock).toHaveBeenCalledWith({ sub: 'user-1', fullName: 'Ada' });
    expect(res.json().subscription.plan).toBe('free');
    expect(res.json().usageCounter.runsLimit).toBe(10);
  });

  it('200 (no 201) cuando es idempotente: el perfil ya existia', async () => {
    registerIndividualMock.mockResolvedValue({ ...individualState, created: false });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/register/individual',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { full_name: 'Ada' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(false);
  });
});

describe('POST /v1/register/organization', () => {
  const orgState = {
    created: true,
    needsRegistration: false,
    profile: { id: 'user-1', orgId: 'org-1', accountType: 'empresa_member', role: 'org_admin', fullName: 'Ada', identityVerified: false, createdAt: 'x', updatedAt: 'x' },
    organization: { id: 'org-1', name: 'Acme', status: 'pending', approvedAt: null, createdAt: 'x', updatedAt: 'x' },
    subscription: null,
    usageCounter: null,
  };

  it('401 sin Authorization', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/register/organization', payload: { org_name: 'Acme', full_name: 'Ada' } });
    expect(res.statusCode).toBe(401);
    expect(registerOrganizationMock).not.toHaveBeenCalled();
  });

  it('400 si falta org_name o full_name', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/register/organization', headers: { authorization: 'Bearer valid-user-1' }, payload: { org_name: 'Acme' } });
    expect(res.statusCode).toBe(400);
    expect(registerOrganizationMock).not.toHaveBeenCalled();
  });

  it('201 crea org en pending y org_admin, sin suscripcion', async () => {
    registerOrganizationMock.mockResolvedValue(orgState);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/register/organization',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { org_name: 'Acme', full_name: 'Ada' },
    });
    expect(res.statusCode).toBe(201);
    expect(registerOrganizationMock).toHaveBeenCalledWith({ sub: 'user-1', orgName: 'Acme', fullName: 'Ada' });
    expect(res.json().organization.status).toBe('pending');
    expect(res.json().profile.role).toBe('org_admin');
    expect(res.json().subscription).toBeNull();
  });

  it('200 (no 201) cuando es idempotente: el perfil/empresa ya existia', async () => {
    registerOrganizationMock.mockResolvedValue({ ...orgState, created: false });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/register/organization',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { org_name: 'Acme', full_name: 'Ada' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(false);
  });
});

describe('GET /v1/me', () => {
  it('401 sin Authorization', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
  });

  it('devuelve needsRegistration true si el usuario no tiene perfil', async () => {
    getStateMock.mockResolvedValue({ needsRegistration: true, profile: null, organization: null, subscription: null, usageCounter: null });
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().needsRegistration).toBe(true);
    expect(getStateMock).toHaveBeenCalledWith('user-1');
  });

  it('devuelve el estado consolidado del perfil', async () => {
    getStateMock.mockResolvedValue({ ...individualState, created: undefined });
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.id).toBe('user-1');
    expect(res.json().usageCounter.periodKind).toBe('lifetime');
  });
});

describe('POST /v1/admin/organizations/:id/approve', () => {
  it('401 sin token admin (NO usa requireUser)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/organizations/org-1/approve' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(approveOrganizationMock).not.toHaveBeenCalled();
  });

  it('401 con token admin incorrecto', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/organizations/org-1/approve', headers: { 'x-admin-token': 'malo' } });
    expect(res.statusCode).toBe(401);
    expect(approveOrganizationMock).not.toHaveBeenCalled();
  });

  it('un Bearer de usuario normal NO sirve para aprobar (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/organizations/org-1/approve', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(401);
    expect(approveOrganizationMock).not.toHaveBeenCalled();
  });

  it('404 si la organizacion no existe', async () => {
    approveOrganizationMock.mockResolvedValue(null);
    const res = await app.inject({ method: 'POST', url: '/v1/admin/organizations/no-existe/approve', headers: { 'x-admin-token': ADMIN_TOKEN } });
    expect(res.statusCode).toBe(404);
    expect(approveOrganizationMock).toHaveBeenCalledWith('no-existe');
  });

  it('200 aprueba y devuelve la organizacion con status approved', async () => {
    approveOrganizationMock.mockResolvedValue({ id: 'org-1', name: 'Acme', status: 'approved', approvedAt: '2026-06-28T00:00:00.000Z', createdAt: 'x', updatedAt: 'x' });
    const res = await app.inject({ method: 'POST', url: '/v1/admin/organizations/org-1/approve', headers: { 'x-admin-token': ADMIN_TOKEN } });
    expect(res.statusCode).toBe(200);
    expect(res.json().organization.status).toBe('approved');
    expect(res.json().organization.approvedAt).not.toBeNull();
    expect(approveOrganizationMock).toHaveBeenCalledWith('org-1');
  });
});
