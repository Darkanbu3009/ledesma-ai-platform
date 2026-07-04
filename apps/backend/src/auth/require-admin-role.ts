import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import type { JwtVerifier } from './jwt-verifier.js';
import { requireUser } from './require-user.js';
import type { RegistrationRepository } from '../registration/registration-repository.js';

/**
 * Gate de SUPER-ADMIN DE PLATAFORMA por ROL. Verifica el JWT (requireUser -> sub), lee
 * profiles.is_admin server-side (rol de servicio, patron de getProfileTier; el rol NUNCA se toma de
 * un header ni del body, solo de la base) y:
 *   - si el sub NO es admin -> lanza FORBIDDEN (403).
 *   - si es admin -> devuelve el sub (util para atribucion futura, p.ej. un audit log).
 *
 * Es a prueba de auto-promocion: is_admin solo lo puede escribir el backend (V018 deja profiles en
 * default-deny para authenticated), asi que leerlo aqui es autoritativo.
 *
 * CODIGO NUEVO E INERTE: nadie lo invoca todavia; se cableara en el PR de endpoints admin. NO
 * reemplaza el requireAdmin(x-admin-token) existente (auth/require-admin.ts), que queda intacto.
 */
export async function requireAdminRole(
  request: FastifyRequest,
  verifier: JwtVerifier,
  repo: Pick<RegistrationRepository, 'isAdmin'>,
): Promise<string> {
  const user = await requireUser(request, verifier);
  const admin = await repo.isAdmin(user.id);
  if (!admin) {
    throw new AppError('FORBIDDEN', 403, 'Requiere rol de super-admin de plataforma');
  }
  return user.id;
}
