import { describe, it, expect, vi } from 'vitest';
import { requireAdminRole } from '../src/auth/require-admin-role.js';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { AppError } from '../src/errors/app-error.js';
import type { FastifyRequest } from 'fastify';

function reqWith(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

// El verifier devuelve un sub fijo a partir del Bearer. El rol se lee SIEMPRE de profiles (server-
// side), nunca de un header ni del body; por eso el request solo lleva el Authorization.
const verifier: JwtVerifier = { verify: vi.fn(async () => ({ id: 'admin-sub', email: 'a@b.com' })) };

describe('requireAdminRole', () => {
  it('un sub admin pasa y devuelve su sub, leyendo is_admin server-side', async () => {
    const isAdmin = vi.fn(async () => true);
    const sub = await requireAdminRole(reqWith({ authorization: 'Bearer good' }), verifier, { isAdmin });
    expect(sub).toBe('admin-sub');
    // El rol se consulta con el sub del JWT verificado, no con nada del request.
    expect(isAdmin).toHaveBeenCalledWith('admin-sub');
  });

  it('un sub no-admin -> 403 FORBIDDEN', async () => {
    const isAdmin = vi.fn(async () => false);
    await expect(
      requireAdminRole(reqWith({ authorization: 'Bearer good' }), verifier, { isAdmin }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('sin Bearer valido -> UNAUTHORIZED y ni siquiera lee el rol', async () => {
    const isAdmin = vi.fn(async () => true);
    const promise = requireAdminRole(reqWith({}), verifier, { isAdmin });
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ code: 'UNAUTHORIZED', statusCode: 401 });
    expect(isAdmin).not.toHaveBeenCalled();
  });
});
