import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { dataSubjectRequestRoutes } from '../src/routes/data-requests.js';
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

const REQ_ID = '66666666-6666-4666-8666-666666666666';

const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    throw new Error('invalid');
  },
};

const createRequest = vi.fn();
const listRequestsByOwner = vi.fn();
const getRequestById = vi.fn();
const updateStatus = vi.fn();
const listConsentsByOwner = vi.fn();
const listRecordsByOwner = vi.fn();
const getState = vi.fn();
const deleteAccount = vi.fn();

function makeRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQ_ID,
    ownerId: 'user-1',
    requestType: 'access',
    status: 'pending',
    details: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    resolvedAt: null,
    resolutionNote: null,
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    dataSubjectRequestRoutes(config, {
      verifier,
      requestRepo: { createRequest, listRequestsByOwner, getRequestById, updateStatus },
      consentRepo: { listConsentsByOwner },
      processingRepo: { listRecordsByOwner },
      registrationRepo: { getState },
      accountDeletion: { deleteAccount },
    }),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  app = await makeApp();
});

const adminHeaders = { 'x-admin-token': 'admin-token-1234567890' };

describe('POST /v1/data-requests', () => {
  it('sin JWT -> 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/data-requests', payload: { request_type: 'access' } });
    expect(res.statusCode).toBe(401);
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('crea con owner del token y tipo valido -> 201', async () => {
    createRequest.mockResolvedValue(makeRequestRow({ requestType: 'erasure' }));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/data-requests',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { request_type: 'erasure', details: 'borren todo', ownerId: 'MALICIOSO' },
    });
    expect(res.statusCode).toBe(201);
    const passed = createRequest.mock.calls[0]?.[0];
    expect(passed.ownerId).toBe('user-1');
    expect(passed.requestType).toBe('erasure');
    expect(passed.details).toBe('borren todo');
  });

  it('tipo invalido -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/data-requests',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { request_type: 'inventado' },
    });
    expect(res.statusCode).toBe(400);
    expect(createRequest).not.toHaveBeenCalled();
  });
});

describe('GET /v1/data-requests', () => {
  it('lista las del owner del token', async () => {
    listRequestsByOwner.mockResolvedValue([makeRequestRow()]);
    const res = await app.inject({ method: 'GET', url: '/v1/data-requests', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(200);
    expect(listRequestsByOwner).toHaveBeenCalledWith('user-1');
    expect(res.json().requests).toHaveLength(1);
  });
});

describe('GET /v1/data-requests/export (access self-service)', () => {
  it('exporta perfil + consentimientos + solicitudes + registros de tratamiento del owner', async () => {
    getState.mockResolvedValue({ profile: { id: 'user-1' }, organization: null });
    listConsentsByOwner.mockResolvedValue([{ id: 'c1' }]);
    listRequestsByOwner.mockResolvedValue([makeRequestRow()]);
    listRecordsByOwner.mockResolvedValue([{ id: 'p1' }]);
    const res = await app.inject({ method: 'GET', url: '/v1/data-requests/export', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(200);
    const body = res.json().export;
    expect(body.subjectId).toBe('user-1');
    expect(body.profile).toEqual({ id: 'user-1' });
    expect(body.consents).toHaveLength(1);
    expect(body.dataRequests).toHaveLength(1);
    expect(body.processingRecords).toHaveLength(1);
    // cada fuente se consulto acotada por owner del token
    expect(getState).toHaveBeenCalledWith('user-1');
    expect(listConsentsByOwner).toHaveBeenCalledWith('user-1');
    expect(listRecordsByOwner).toHaveBeenCalledWith('user-1');
  });
});

describe('POST /v1/admin/data-requests/:id/resolve', () => {
  it('sin x-admin-token -> 401 (no resuelve)', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/admin/data-requests/${REQ_ID}/resolve`, payload: { status: 'completed' } });
    expect(res.statusCode).toBe(401);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('resuelve una solicitud (status) sin borrar cuando no es erasure', async () => {
    getRequestById.mockResolvedValue(makeRequestRow({ requestType: 'rectification' }));
    updateStatus.mockResolvedValue(makeRequestRow({ requestType: 'rectification', status: 'completed' }));
    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/data-requests/${REQ_ID}/resolve`,
      headers: adminHeaders,
      payload: { status: 'completed', resolution_note: 'corregido', erase: true },
    });
    expect(res.statusCode).toBe(200);
    // erase=true pero el tipo NO es erasure: no se borra nada.
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith(REQ_ID, 'completed', 'corregido');
  });

  it('con erase=true sobre una solicitud de erasure, dispara el motor atomico sobre el titular', async () => {
    getRequestById.mockResolvedValue(makeRequestRow({ requestType: 'erasure', ownerId: 'user-9' }));
    deleteAccount.mockResolvedValue({
      data: { agents: 1, agentRuns: 3, jobs: 2, scheduledTasks: 1, triggers: 0, recipes: 0, processingRecords: 1, providerCredentials: 1, consents: 1, dataSubjectRequests: 1, upgradeRequests: 0, adminActionsAnonymized: 0, subscriptions: 1, usageCounters: 1, profiles: 1, organization: 'none' },
      authUser: 'skipped',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/data-requests/${REQ_ID}/resolve`,
      headers: adminHeaders,
      payload: { status: 'completed', erase: true },
    });
    expect(res.statusCode).toBe(200);
    // borra los datos del OWNER de la solicitud (user-9), no del admin; por default NO borra auth.users.
    expect(deleteAccount).toHaveBeenCalledWith('user-9', { deleteAuthUser: false });
    expect(res.json().requestErased).toBe(true);
    expect(res.json().erased.agentRuns).toBe(3);
    expect(res.json().authUser).toBe('skipped');
    // El path de borrado NO llama updateStatus (la solicitud se borro con el resto: una sola op atomica).
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('con delete_auth_user=true propaga la opcion al motor (borra tambien la identidad)', async () => {
    getRequestById.mockResolvedValue(makeRequestRow({ requestType: 'erasure', ownerId: 'user-9' }));
    deleteAccount.mockResolvedValue({
      data: { agents: 0, agentRuns: 0, jobs: 0, scheduledTasks: 0, triggers: 0, recipes: 0, processingRecords: 0, providerCredentials: 0, consents: 0, dataSubjectRequests: 1, upgradeRequests: 0, adminActionsAnonymized: 0, subscriptions: 1, usageCounters: 1, profiles: 1, organization: 'deleted' },
      authUser: 'deleted',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/data-requests/${REQ_ID}/resolve`,
      headers: adminHeaders,
      payload: { status: 'completed', erase: true, delete_auth_user: true },
    });
    expect(res.statusCode).toBe(200);
    expect(deleteAccount).toHaveBeenCalledWith('user-9', { deleteAuthUser: true });
    expect(res.json().authUser).toBe('deleted');
  });

  it('solicitud inexistente -> 404', async () => {
    getRequestById.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/data-requests/${REQ_ID}/resolve`,
      headers: adminHeaders,
      payload: { status: 'completed' },
    });
    expect(res.statusCode).toBe(404);
    expect(updateStatus).not.toHaveBeenCalled();
  });
});
