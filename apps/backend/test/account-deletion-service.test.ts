import { describe, it, expect, vi } from 'vitest';
import { deleteAccount } from '../src/account/account-deletion-service.js';
import type { AccountDataDeletionResult } from '../src/account/account-deletion-repository.js';
import type { AuthUserDeleter } from '../src/account/supabase-admin.js';

const DATA: AccountDataDeletionResult = {
  agents: 1, agentRuns: 1, jobs: 1, scheduledTasks: 1, triggers: 1, recipes: 1, processingRecords: 1,
  providerCredentials: 1, consents: 1, dataSubjectRequests: 1, upgradeRequests: 1, adminActionsAnonymized: 1,
  subscriptions: 1, usageCounters: 1, profiles: 1, organization: 'none',
};

function makeRepo(impl?: () => Promise<AccountDataDeletionResult>) {
  return { deleteAccountData: vi.fn(impl ?? (async () => DATA)) };
}
function makeLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

describe('deleteAccount (orquestacion cross-sistema)', () => {
  it('deleteAuthUser=false: borra datos y OMITE auth.users (skipped)', async () => {
    const repo = makeRepo();
    const authDeleter: AuthUserDeleter = { deleteUser: vi.fn() };
    const result = await deleteAccount({ ownerId: 'user-1', deleteAuthUser: false, repo, authDeleter });
    expect(result.authUser).toBe('skipped');
    expect(result.data).toEqual(DATA);
    expect(repo.deleteAccountData).toHaveBeenCalledWith('user-1');
    expect(authDeleter.deleteUser).not.toHaveBeenCalled();
  });

  it('deleteAuthUser=true + exito: borra datos y LUEGO auth.users (deleted)', async () => {
    const repo = makeRepo();
    const order: string[] = [];
    repo.deleteAccountData.mockImplementation(async () => { order.push('data'); return DATA; });
    const authDeleter: AuthUserDeleter = { deleteUser: vi.fn(async () => { order.push('auth'); }) };
    const result = await deleteAccount({ ownerId: 'user-1', deleteAuthUser: true, repo, authDeleter });
    expect(result.authUser).toBe('deleted');
    expect(authDeleter.deleteUser).toHaveBeenCalledWith('user-1');
    // Datos PRIMERO, auth despues (nunca al reves).
    expect(order).toEqual(['data', 'auth']);
  });

  it('deleteAuthUser=true sin authDeleter (SERVICE_ROLE_KEY ausente): not_configured + log', async () => {
    const repo = makeRepo();
    const logger = makeLogger();
    const result = await deleteAccount({ ownerId: 'user-1', deleteAuthUser: true, repo, authDeleter: null, logger });
    expect(result.authUser).toBe('not_configured');
    // Los datos SI se borraron.
    expect(result.data).toEqual(DATA);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('deleteAuthUser=true + fallo de auth: datos YA borrados, authUser=failed, NO revierte, loguea reintento', async () => {
    const repo = makeRepo();
    const logger = makeLogger();
    const authDeleter: AuthUserDeleter = {
      deleteUser: vi.fn(async () => { throw new Error('supabase 500'); }),
    };
    const result = await deleteAccount({ ownerId: 'user-1', deleteAuthUser: true, repo, authDeleter, logger });
    expect(result.authUser).toBe('failed');
    // Los datos personales ya se borraron (cumplimiento satisfecho): NO se revierte.
    expect(result.data).toEqual(DATA);
    expect(repo.deleteAccountData).toHaveBeenCalledTimes(1);
    // Se logueo para reintento manual, con ownerId + mensaje de error (nunca un secreto).
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [obj, msg] = logger.error.mock.calls[0] as [Record<string, unknown>, string];
    expect(obj.ownerId).toBe('user-1');
    expect(obj.err).toBe('supabase 500');
    expect(msg).toContain('reintentar manualmente');
  });

  it('si el borrado de DATOS falla: propaga y NO intenta borrar auth.users (nada que revertir)', async () => {
    const repo = makeRepo(async () => { throw new Error('rollback'); });
    const authDeleter: AuthUserDeleter = { deleteUser: vi.fn() };
    await expect(
      deleteAccount({ ownerId: 'user-1', deleteAuthUser: true, repo, authDeleter }),
    ).rejects.toThrow('rollback');
    expect(authDeleter.deleteUser).not.toHaveBeenCalled();
  });

  it('ningun log incluye un campo con la SERVICE_ROLE_KEY (solo ownerId + err)', async () => {
    const repo = makeRepo();
    const logger = makeLogger();
    const authDeleter: AuthUserDeleter = { deleteUser: vi.fn(async () => { throw new Error('boom'); }) };
    await deleteAccount({ ownerId: 'user-1', deleteAuthUser: true, repo, authDeleter, logger });
    for (const call of logger.error.mock.calls) {
      const obj = call[0] as Record<string, unknown>;
      expect(Object.keys(obj).sort()).toEqual(['err', 'ownerId']);
    }
  });
});
