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
import { parseEnv, type Env } from '../src/config/env.js';

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

  it('LAZY: construir el deleter NO crea el cliente; createClient solo corre al PRIMER deleteUser', async () => {
    const config = parseEnv({ ...baseEnv, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
    deleteUserMock.mockResolvedValue({ data: {}, error: null });

    const deleter = createSupabaseAuthUserDeleter(config);
    expect(deleter).not.toBeNull();
    // Punto CLAVE del hotfix: nada de createClient al construir (ni al registrar la ruta / arrancar). Un
    // problema de config del cliente admin NO puede tumbar el arranque porque aqui no se crea el cliente.
    expect(createClientMock).not.toHaveBeenCalled();

    await deleter!.deleteUser('user-9');
    // Recien al USARLO (borrar) se crea el cliente.
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it('MEMOIZA: dos borrados reusan el mismo cliente (createClient una sola vez)', async () => {
    const config = parseEnv({ ...baseEnv, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
    deleteUserMock.mockResolvedValue({ data: {}, error: null });
    const deleter = createSupabaseAuthUserDeleter(config);

    await deleter!.deleteUser('user-1');
    await deleter!.deleteUser('user-2');
    // El cliente se crea una sola vez y se reusa; no se recrea en cada borrado.
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(deleteUserMock).toHaveBeenCalledTimes(2);
  });

  it('USO robusto: si SUPABASE_URL falta al borrar -> error CLARO en tiempo de uso (no crash de arranque), sin crear cliente ni filtrar la key', async () => {
    // Config con la key presente pero la URL vacia: el deleter se construye (feature activa), pero el
    // cliente falla al CREARSE en el momento del borrado, con un mensaje claro. Esto ocurre en tiempo de
    // USO, jamas en el arranque.
    const brokenConfig = {
      ...parseEnv({ ...baseEnv, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }),
      SUPABASE_URL: '',
    } as Env;
    const deleter = createSupabaseAuthUserDeleter(brokenConfig);
    expect(deleter).not.toBeNull();

    await expect(deleter!.deleteUser('user-9')).rejects.toThrow(/falta SUPABASE_URL/);
    // Nunca se intento crear el cliente Supabase con config invalida.
    expect(createClientMock).not.toHaveBeenCalled();
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
