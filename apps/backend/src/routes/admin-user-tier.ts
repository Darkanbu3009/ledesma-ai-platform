import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import type { ProfileTier } from '../registration/types.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireAdminRole } from '../auth/require-admin-role.js';
import { TierBodySchema } from './registration.js';

// El :id objetivo es un usuario ARBITRARIO que se usa server-side como target del cambio. Se valida como
// uuid (mismo criterio que la ficha /v1/admin/users/:id y el resto de los :id del backend); un id mal
// formado se rechaza con 400 ANTES de tocar ningun repo. La validacion corre DESPUES del gate admin, asi
// que un no-admin nunca ve el 400 (siempre 403): mutar el tier de cualquiera es poder exclusivo de admins.
const UserIdParamSchema = z.object({ id: z.string().uuid() });

/**
 * CAMBIO DE TIER ATRIBUIBLE (UNICA mutacion del panel de admin): PUT /v1/admin/users/:id/tier, gateado por
 * ROL (requireAdminRole). Es la palanca de monetizacion operada desde el panel: sube/baja el plan de un
 * usuario (p.ej. desbloquear el modo autonomo del Configurador con tier 'autonomous') hasta que exista
 * facturacion.
 *
 * La diferencia CLAVE con el endpoint viejo (POST /v1/admin/profiles/:id/tier, auth/require-admin.ts, bajo
 * x-admin-token = secreto compartido SIN actor -> audita actor_id null) es la ATRIBUCION: aqui el gate por
 * rol verifica el JWT y devuelve el sub REAL del admin, que se registra como actor_id en el audit log. Asi
 * el panel deja rastro de QUIEN cambio el tier. El endpoint viejo queda INTACTO como fallback de
 * bootstrap/emergencia (documentado a deprecar): este NO lo reemplaza, lo complementa.
 *
 * El EFECTO y la RESPUESTA del cambio son identicos al endpoint viejo (updateProfileTier + { profile }); lo
 * unico que cambia es el gate (a rol) y el actor (a real). El gate de LECTURA del tier (modo autonomo del
 * Configurador) queda intacto: aqui solo se ESCRIBE el tier, de forma atribuible.
 *
 * Vive en su propio archivo (no en admin-users.ts) a proposito: admin-users.ts es READ-ONLY puro y no
 * registra audit; esta es la unica mutacion admin de la fase de endpoints, aislada. Permite inyectar el
 * verifier y el repo en tests (sin red ni DB), mismo patron que admin-users.ts / dashboard.ts.
 */
export function adminUserTierRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    // Solo los metodos que este endpoint necesita: isAdmin (gate por rol), getProfileTier (el `from` del
    // audit), updateProfileTier (el efecto) y recordAdminAction (el audit).
    repo?: Pick<
      RegistrationRepository,
      'isAdmin' | 'getProfileTier' | 'updateProfileTier' | 'recordAdminAction'
    >;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const repo = deps?.repo ?? new RegistrationRepository(getSql(config));

    app.put(
      '/v1/admin/users/:id/tier',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        // Gate por ROL PRIMERO (401 sin/invalido JWT, 403 si el sub no es super-admin) y captura del ACTOR
        // REAL: requireAdminRole devuelve el sub del admin del JWT, que sera el actor_id del audit. El gate
        // corre ANTES de validar :id/body, asi que un no-admin siempre recibe 403 (nunca un 400 revelador).
        const actorId = await requireAdminRole(request, verifier, repo);

        const parsedParams = UserIdParamSchema.safeParse(request.params);
        if (!parsedParams.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid user id', parsedParams.error.issues);
        }
        // Reusa EXACTAMENTE el schema del endpoint viejo (enum free/pro/autonomous): una sola fuente de
        // verdad para los tiers validos.
        const parsedBody = TierBodySchema.safeParse(request.body);
        if (!parsedBody.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid tier body', parsedBody.error.issues);
        }
        const targetId = parsedParams.data.id;

        // Captura del tier ACTUAL (el `from` del audit) ANTES del update. Es maquinaria de auditoria y NO
        // tiene rol funcional en el cambio, por eso su lectura es BEST-EFFORT: si falla, el cambio NO debe
        // romperse; el audit registra from=null y se continua. Debe leerse antes del update (despues
        // devolveria el tier NUEVO). Si el perfil no existe devuelve null y el update de abajo hara 404.
        let fromTier: ProfileTier | null = null;
        try {
          fromTier = await repo.getProfileTier(targetId);
        } catch (err) {
          request.log.warn({ err, targetId }, 'audit log: no se pudo leer el tier previo (from)');
        }

        const profile = await repo.updateProfileTier(targetId, parsedBody.data.tier);
        if (!profile) {
          throw new AppError('NOT_FOUND', 404, 'User not found');
        }

        // AUDIT LOG (best-effort) con el ACTOR REAL (el sub del admin del JWT): esa es la diferencia clave
        // con el endpoint viejo (actor null). El cambio de tier YA se aplico; si el insert del audit falla,
        // se loguea y se continua: la respuesta { profile } se conserva. Un cambio exitoso no debe romperse
        // porque el log no se pudo escribir.
        try {
          await repo.recordAdminAction({
            actorId,
            action: 'change_tier',
            targetId,
            details: { from: fromTier, to: parsedBody.data.tier },
          });
        } catch (err) {
          request.log.error(
            { err, targetId, action: 'change_tier' },
            'audit log: no se pudo registrar la accion de admin',
          );
        }

        return reply.send({ profile });
      },
    );
  };
}
