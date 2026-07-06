import { describe, it, expect, vi, beforeEach } from 'vitest';

const { registerIndividualMock, registerOrganizationMock, getStateMock, approveOrganizationMock, updateProfileTierMock, updateOwnProfileNameMock, getProfileTierMock, recordAdminActionMock } = vi.hoisted(() => ({
  registerIndividualMock: vi.fn(),
  registerOrganizationMock: vi.fn(),
  getStateMock: vi.fn(),
  approveOrganizationMock: vi.fn(),
  updateProfileTierMock: vi.fn(),
  updateOwnProfileNameMock: vi.fn(),
  getProfileTierMock: vi.fn(),
  recordAdminActionMock: vi.fn(),
}));

vi.mock('../src/registration/registration-repository.js', () => ({
  RegistrationRepository: class {
    registerIndividual = registerIndividualMock;
    registerOrganization = registerOrganizationMock;
    getState = getStateMock;
    approveOrganization = approveOrganizationMock;
    updateProfileTier = updateProfileTierMock;
    updateOwnProfileName = updateOwnProfileNameMock;
    getProfileTier = getProfileTierMock;
    recordAdminAction = recordAdminActionMock;
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
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const individualState = {
  created: true,
  needsRegistration: false,
  profile: { id: 'user-1', orgId: null, accountType: 'individual', role: 'individual', fullName: 'Ada', identityVerified: false, tier: 'free', createdAt: 'x', updatedAt: 'x' },
  organization: null,
  subscription: { id: 's1', profileId: 'user-1', plan: 'free', status: 'active', createdAt: 'x' },
  usageCounter: { id: 'u1', profileId: 'user-1', runsUsed: 0, runsLimit: 10, periodKind: 'lifetime', createdAt: 'x' },
  isAdmin: false,
};

let app: FastifyInstance;
beforeEach(async () => {
  registerIndividualMock.mockReset();
  registerOrganizationMock.mockReset();
  getStateMock.mockReset();
  approveOrganizationMock.mockReset();
  updateProfileTierMock.mockReset();
  updateOwnProfileNameMock.mockReset();
  getProfileTierMock.mockReset();
  recordAdminActionMock.mockReset();
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

  it('devuelve el estado consolidado del perfil, incluyendo el tier', async () => {
    getStateMock.mockResolvedValue({ ...individualState, created: undefined });
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer valid-user-1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.id).toBe('user-1');
    expect(res.json().profile.tier).toBe('free');
    expect(res.json().usageCounter.periodKind).toBe('lifetime');
    // /v1/me reenvia el flag de admin tal cual lo calcula el repo (passthrough): la consola lo consume
    // para mostrar/ocultar el area de admin. La seguridad real sigue siendo server-side.
    expect(res.json().isAdmin).toBe(false);
  });
});

describe('PATCH /v1/me/profile', () => {
  it('401 sin Authorization (no toca el perfil)', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/v1/me/profile', payload: { fullName: 'Ada Lovelace' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(updateOwnProfileNameMock).not.toHaveBeenCalled();
  });

  it('200 edita full_name del PROPIO owner (sub del token) y devuelve el estado consolidado', async () => {
    updateOwnProfileNameMock.mockResolvedValue({ ...individualState.profile, fullName: 'Ada Lovelace' });
    getStateMock.mockResolvedValue({ ...individualState, created: undefined, profile: { ...individualState.profile, fullName: 'Ada Lovelace' } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { fullName: 'Ada Lovelace' },
    });
    expect(res.statusCode).toBe(200);
    // El OWNER es el sub del token ('user-1'), NUNCA un id del body/params. Y solo se pasa el nombre.
    expect(updateOwnProfileNameMock).toHaveBeenCalledWith('user-1', 'Ada Lovelace');
    // Devuelve el RegistrationState completo (misma forma que GET /v1/me) para refrescar ['me'].
    expect(res.json().profile.fullName).toBe('Ada Lovelace');
    expect(res.json().needsRegistration).toBe(false);
    expect(getStateMock).toHaveBeenCalledWith('user-1');
  });

  it('400 si fullName esta vacio (validacion reusada del registro)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { fullName: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(updateOwnProfileNameMock).not.toHaveBeenCalled();
  });

  it('400 si falta fullName', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(updateOwnProfileNameMock).not.toHaveBeenCalled();
  });

  it('400 si fullName excede 200 caracteres (mismo limite que el registro)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { fullName: 'a'.repeat(201) },
    });
    expect(res.statusCode).toBe(400);
    expect(updateOwnProfileNameMock).not.toHaveBeenCalled();
  });

  it('BLINDAJE: mandar tier/role/is_admin en el body NO los cambia; solo llega full_name al UPDATE', async () => {
    // Este es el punto del PR: aunque el cliente intente colar campos sensibles en el body, el schema
    // estrecho los descarta y el repo se invoca con SOLO (owner, fullName). tier/role/is_admin JAMAS
    // llegan al UPDATE -> no se reabre la escalada que cerro V018.
    updateOwnProfileNameMock.mockResolvedValue({ ...individualState.profile, fullName: 'Malicia' });
    getStateMock.mockResolvedValue({ ...individualState, created: undefined, profile: { ...individualState.profile, fullName: 'Malicia' } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { fullName: 'Malicia', tier: 'autonomous', role: 'org_admin', is_admin: true, account_type: 'empresa_member', identity_verified: true, id: 'otro-usuario' },
    });
    expect(res.statusCode).toBe(200);
    // La firma del repo recibe EXACTAMENTE (sub-del-token, fullName): dos argumentos, sin rastro de los
    // campos sensibles. El owner es 'user-1' del token, NO el 'id' del body.
    expect(updateOwnProfileNameMock).toHaveBeenCalledTimes(1);
    expect(updateOwnProfileNameMock).toHaveBeenCalledWith('user-1', 'Malicia');
    // Defensa extra: el objeto de args no contiene ningun campo sensible (el repo recibe solo 2 strings).
    const callArgs = updateOwnProfileNameMock.mock.calls[0];
    expect(callArgs).toEqual(['user-1', 'Malicia']);
    // El tier NO viaja: el segundo argumento es el nombre, no el objeto del body.
    expect(callArgs?.[1]).toBe('Malicia');
    // BLINDAJE (invariante fuerte): el handler NO invoca NINGUN otro mutador sensible. Sin esto, una
    // regresion futura que agregara una segunda escritura en la ruta (p.ej. updateProfileTier con el
    // tier del body) dejaria el test en verde y reabriria el agujero de V018. El unico efecto permitido
    // de este endpoint es escribir full_name via updateOwnProfileName.
    expect(updateProfileTierMock).not.toHaveBeenCalled();
    expect(approveOrganizationMock).not.toHaveBeenCalled();
    expect(recordAdminActionMock).not.toHaveBeenCalled();
    expect(registerIndividualMock).not.toHaveBeenCalled();
    expect(registerOrganizationMock).not.toHaveBeenCalled();
  });

  it('el owner es SIEMPRE el del token: no hay parametro de id para editar el perfil de otro', async () => {
    // No existe la ruta /v1/me/profile/:id ni similar: el unico perfil editable es el del sub del token.
    updateOwnProfileNameMock.mockResolvedValue({ ...individualState.profile, fullName: 'Ada' });
    getStateMock.mockResolvedValue({ ...individualState, created: undefined });
    await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { fullName: 'Ada' },
    });
    // El primer argumento (owner) es el sub del token, no algo controlable por el cliente.
    expect(updateOwnProfileNameMock.mock.calls[0]?.[0]).toBe('user-1');
  });

  it('404 si el usuario aun no tiene perfil (needsRegistration): nada que editar', async () => {
    updateOwnProfileNameMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { fullName: 'Ada' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(updateOwnProfileNameMock).toHaveBeenCalledWith('user-1', 'Ada');
    // Sin perfil no se arma el estado consolidado (no se llama getState tras el 404).
    expect(getStateMock).not.toHaveBeenCalled();
  });
});

describe('POST /v1/admin/profiles/:id/tier', () => {
  const autonomousProfile = {
    id: 'user-1', orgId: null, accountType: 'individual', role: 'individual',
    fullName: 'Ada', identityVerified: false, tier: 'autonomous', createdAt: 'x', updatedAt: 'x',
  };

  it('401 sin token admin (NO usa requireUser)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/profiles/user-1/tier', payload: { tier: 'autonomous' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(updateProfileTierMock).not.toHaveBeenCalled();
  });

  it('401 con token admin incorrecto', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/profiles/user-1/tier', headers: { 'x-admin-token': 'malo' }, payload: { tier: 'autonomous' } });
    expect(res.statusCode).toBe(401);
    expect(updateProfileTierMock).not.toHaveBeenCalled();
  });

  it('un Bearer de usuario normal NO sirve para cambiar el tier (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/profiles/user-1/tier', headers: { authorization: 'Bearer valid-user-1' }, payload: { tier: 'autonomous' } });
    expect(res.statusCode).toBe(401);
    expect(updateProfileTierMock).not.toHaveBeenCalled();
  });

  it('400 con tier invalido en el body', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/profiles/user-1/tier', headers: { 'x-admin-token': ADMIN_TOKEN }, payload: { tier: 'enterprise' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(updateProfileTierMock).not.toHaveBeenCalled();
  });

  it('400 sin tier en el body', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/profiles/user-1/tier', headers: { 'x-admin-token': ADMIN_TOKEN }, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(updateProfileTierMock).not.toHaveBeenCalled();
  });

  it('404 si el perfil no existe', async () => {
    updateProfileTierMock.mockResolvedValue(null);
    const res = await app.inject({ method: 'POST', url: '/v1/admin/profiles/no-existe/tier', headers: { 'x-admin-token': ADMIN_TOKEN }, payload: { tier: 'autonomous' } });
    expect(res.statusCode).toBe(404);
    expect(updateProfileTierMock).toHaveBeenCalledWith('no-existe', 'autonomous');
    // No-regresion: un 404 NO registra ninguna accion en el audit log.
    expect(recordAdminActionMock).not.toHaveBeenCalled();
  });

  it('200 actualiza el tier y devuelve el perfil', async () => {
    updateProfileTierMock.mockResolvedValue(autonomousProfile);
    const res = await app.inject({ method: 'POST', url: '/v1/admin/profiles/user-1/tier', headers: { 'x-admin-token': ADMIN_TOKEN }, payload: { tier: 'autonomous' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.tier).toBe('autonomous');
    expect(updateProfileTierMock).toHaveBeenCalledWith('user-1', 'autonomous');
  });

  it('registra en el audit log la accion change_tier con el from->to y el target correctos', async () => {
    getProfileTierMock.mockResolvedValue('free'); // tier ACTUAL antes del cambio (from)
    updateProfileTierMock.mockResolvedValue(autonomousProfile);
    recordAdminActionMock.mockResolvedValue(undefined);
    const res = await app.inject({ method: 'POST', url: '/v1/admin/profiles/user-1/tier', headers: { 'x-admin-token': ADMIN_TOKEN }, payload: { tier: 'autonomous' } });
    expect(res.statusCode).toBe(200);
    expect(getProfileTierMock).toHaveBeenCalledWith('user-1');
    // Invariante: el from se lee ANTES del update (si se leyera despues, seria el tier NUEVO). Se
    // afirma el ORDEN real de invocacion, no solo que ambos se llamaron. invocationCallOrder es 1-based,
    // asi que 0 es un centinela de "no invocado".
    const fromOrder = getProfileTierMock.mock.invocationCallOrder[0] ?? 0;
    const updateOrder = updateProfileTierMock.mock.invocationCallOrder[0] ?? 0;
    expect(fromOrder).toBeGreaterThan(0);
    expect(updateOrder).toBeGreaterThan(fromOrder);
    // actorId null: el endpoint corre bajo x-admin-token (sin identidad de actor).
    expect(recordAdminActionMock).toHaveBeenCalledWith({
      actorId: null,
      action: 'change_tier',
      targetId: 'user-1',
      details: { from: 'free', to: 'autonomous' },
    });
  });

  it('best-effort: si el registro del audit falla, el cambio de tier conserva su 200 y su { profile }', async () => {
    getProfileTierMock.mockResolvedValue('free');
    updateProfileTierMock.mockResolvedValue(autonomousProfile);
    recordAdminActionMock.mockRejectedValue(new Error('audit boom'));
    const res = await app.inject({ method: 'POST', url: '/v1/admin/profiles/user-1/tier', headers: { 'x-admin-token': ADMIN_TOKEN }, payload: { tier: 'autonomous' } });
    // El cambio de tier NO se rompe por el fallo del audit: misma respuesta.
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.tier).toBe('autonomous');
    expect(updateProfileTierMock).toHaveBeenCalledWith('user-1', 'autonomous');
    expect(recordAdminActionMock).toHaveBeenCalledTimes(1);
  });

  it('best-effort: si la lectura del tier previo (from) falla, el cambio de tier NO se rompe (from queda null)', async () => {
    // getProfileTier es maquinaria de auditoria (solo para el from): su fallo no debe abortar el update.
    getProfileTierMock.mockRejectedValue(new Error('read boom'));
    updateProfileTierMock.mockResolvedValue(autonomousProfile);
    recordAdminActionMock.mockResolvedValue(undefined);
    const res = await app.inject({ method: 'POST', url: '/v1/admin/profiles/user-1/tier', headers: { 'x-admin-token': ADMIN_TOKEN }, payload: { tier: 'autonomous' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.tier).toBe('autonomous');
    expect(updateProfileTierMock).toHaveBeenCalledWith('user-1', 'autonomous');
    // El cambio igual se audita, con from null (la lectura fallo).
    expect(recordAdminActionMock).toHaveBeenCalledWith({
      actorId: null,
      action: 'change_tier',
      targetId: 'user-1',
      details: { from: null, to: 'autonomous' },
    });
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
