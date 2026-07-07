import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock del SDK de Supabase: capturamos createClient y exponemos un deleteUser controlable. vi.hoisted
// define los mocks ANTES del hoisting de vi.mock (que corre al tope del archivo).
const { deleteUserMock, createClientMock } = vi.hoisted(() => {
  const deleteUser = vi.fn();
  return {
    deleteUserMock: deleteUser,
    createClientMock: vi.fn(() => ({ auth: { admin: { deleteUser } } })),
  };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

import { createSupabaseAuthUserDeleter } from '../src/account/supabase-admin.js';
import { parseEnv } from '../src/config/env.js';

const SERVICE_KEY = 'super-secret-service-role-key-NUNCA-loguear';

const baseEnv = {
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'test-admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('createSupabaseAuthUserDeleter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('devuelve null si SUPABASE_SERVICE_ROLE_KEY no esta configurada (feature desactivada)', () => {
    const config = parseEnv(baseEnv);
    expect(createSupabaseAuthUserDeleter(config)).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('con la key: crea el cliente sin sesion y borra el usuario por id', async () => {
    const config = parseEnv({ ...baseEnv, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
    deleteUserMock.mockResolvedValue({ data: {}, error: null });
    const deleter = createSupabaseAuthUserDeleter(config);
    expect(deleter).not.toBeNull();

    await deleter!.deleteUser('user-9');
    expect(deleteUserMock).toHaveBeenCalledWith('user-9');
    // Cliente server-side sin persistir/refrescar sesion.
    expect(createClientMock).toHaveBeenCalledWith('https://x.supabase.co', SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it('si el API devuelve error, lanza con el mensaje de Supabase y SIN la SERVICE_ROLE_KEY', async () => {
    const config = parseEnv({ ...baseEnv, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
    deleteUserMock.mockResolvedValue({ data: null, error: { message: 'user not found' } });
    const deleter = createSupabaseAuthUserDeleter(config);

    await expect(deleter!.deleteUser('user-9')).rejects.toThrow('user not found');
    // La llave JAMAS aparece en el error propagado.
    await expect(deleter!.deleteUser('user-9')).rejects.not.toThrow(SERVICE_KEY);
    try {
      await deleter!.deleteUser('user-9');
      expect.unreachable('deberia lanzar');
    } catch (err) {
      expect(err instanceof Error ? err.message : String(err)).not.toContain(SERVICE_KEY);
    }
  });
});
