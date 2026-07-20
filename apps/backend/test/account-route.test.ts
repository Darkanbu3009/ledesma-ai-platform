import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import type { AccountDataDeletionResult } from '../src/account/account-deletion-repository.js';
import type { DeleteAccountResult } from '../src/account/account-deletion-service.js';
import { accountRoutes } from '../src/routes/account.js';
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

// El token de user-1 trae su email (fuente de verdad de la confirmacion). user-2 sirve para verificar
// que el email de OTRO no confirma. token 'no-email' representa un JWT sin claim email.
const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    if (token === 'no-email') return { id: 'user-1', email: null };
    // jwt-verifier deja email='' (no null) cuando el claim `email` del JWT viene vacio.
    if (token === 'empty-email') return { id: 'user-1', email: '' };
    throw new Error('invalid');
  },
};

const deleteAccount = vi.fn();

/** Resultado del motor con `data` completo (17 tablas) y el `authUser` que se quiera probar. */
function makeResult(authUser: DeleteAccountResult['authUser']): DeleteAccountResult {
  const data: AccountDataDeletionResult = {
    agents: 2, agentRuns: 5, jobs: 3, scheduledTasks: 1, triggers: 0, recipes: 0, processingRecords: 1,
    providerCredentials: 1, consents: 1, dataSubjectRequests: 0, upgradeRequests: 0, sitiosConectados: 0,
    sitiosConectadosContextosExternos: [], adminActionsAnonymized: 0,
    subscriptions: 1, usageCounters: 1, profiles: 1, organization: 'deleted',
  };
  return { data, authUser };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(accountRoutes(config, { verifier, accountDeletion: { deleteAccount } }));
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  app = await makeApp();
});

describe('DELETE /v1/me (borrado self-service)', () => {
  it('sin JWT -> 401 y el motor NO se invoca (nada se borra)', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/me', payload: { confirmEmail: 'u1@test.com' } });
    expect(res.statusCode).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('body sin confirmEmail -> 400 y el motor NO se invoca', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('body malformado (confirmEmail no string) -> 400 y el motor NO se invoca', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { confirmEmail: 123 },
    });
    expect(res.statusCode).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('confirmEmail que NO coincide con el email del token -> 400 y el motor NO se invoca', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { confirmEmail: 'otro@test.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('no coincide');
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('token sin email -> 400 (no hay con que confirmar) y el motor NO se invoca', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: 'Bearer no-email' },
      payload: { confirmEmail: 'u1@test.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('token con email VACIO + confirmEmail en blanco -> 400 (no se elude la confirmacion) y el motor NO se invoca', async () => {
    // Regresion: un token con email='' + una confirmacion de solo espacios (ambos normalizan a '') NO
    // debe "coincidir" y borrar la cuenta. El email vacio del token se trata como ausente -> 400.
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: 'Bearer empty-email' },
      payload: { confirmEmail: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('confirmEmail correcto -> invoca el motor con el owner del token + deleteAuthUser:true, exito 200', async () => {
    deleteAccount.mockResolvedValue(makeResult('deleted'));
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { confirmEmail: 'u1@test.com' },
    });
    expect(res.statusCode).toBe(200);
    // Borra la PROPIA cuenta (user-1), identidad incluida.
    expect(deleteAccount).toHaveBeenCalledWith('user-1', { deleteAuthUser: true });
    const body = res.json();
    expect(body.accountDeleted).toBe(true);
    expect(body.authUser).toBe('deleted');
    expect(body.data.profiles).toBe(1);
  });

  it('confirmEmail se compara normalizado (trim + lowercase): "  U1@TEST.COM " coincide', async () => {
    deleteAccount.mockResolvedValue(makeResult('deleted'));
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { confirmEmail: '  U1@TEST.COM ' },
    });
    expect(res.statusCode).toBe(200);
    expect(deleteAccount).toHaveBeenCalledWith('user-1', { deleteAuthUser: true });
  });

  it('el owner pasado al motor es el del token, JAMAS del body (campos extra se descartan)', async () => {
    deleteAccount.mockResolvedValue(makeResult('deleted'));
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: 'Bearer valid-user-1' },
      // confirmEmail correcto + intento de inyectar otra identidad por el body.
      payload: { confirmEmail: 'u1@test.com', ownerId: 'MALICIOSO', userId: 'MALICIOSO', id: 'MALICIOSO' },
    });
    expect(res.statusCode).toBe(200);
    expect(deleteAccount).toHaveBeenCalledWith('user-1', { deleteAuthUser: true });
  });

  it('semantica cross-sistema: motor devuelve authUser=failed -> 200 lo refleja (no finge exito total)', async () => {
    deleteAccount.mockResolvedValue(makeResult('failed'));
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { confirmEmail: 'u1@test.com' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Los datos se borraron (accountDeleted:true) pero se reporta el residuo de auth honestamente.
    expect(body.accountDeleted).toBe(true);
    expect(body.authUser).toBe('failed');
  });

  it('semantica cross-sistema: motor devuelve authUser=not_configured -> 200 lo refleja', async () => {
    deleteAccount.mockResolvedValue(makeResult('not_configured'));
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { confirmEmail: 'u1@test.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().authUser).toBe('not_configured');
  });

  it('el motor falla a mitad (rollback de datos) -> error 500, no finge exito y la cuenta queda intacta', async () => {
    deleteAccount.mockRejectedValue(new Error('rollback'));
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { confirmEmail: 'u1@test.com' },
    });
    expect(res.statusCode).toBe(500);
    // No hay { accountDeleted: true }: el fallo se propaga honestamente.
    expect(res.json().accountDeleted).toBeUndefined();
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
  });
});
