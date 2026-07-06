import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import type { ProfileTier } from '../registration/types.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { requireAdmin } from '../auth/require-admin.js';

// Validacion de nombre compartida (full_name / org_name / fullName): requerido y de a lo sumo 200
// caracteres tras recortar. UNICA fuente de verdad del criterio de nombre, para que el registro y la
// edicion del propio perfil no diverjan (la consola la espeja en NAME_MAX_LENGTH/validateName).
const FullNameSchema = z.string().trim().min(1).max(200);

// Body del registro individual: identidad minima. identity_verified NO es input (lo fija el repo
// en false; la verificacion es ligera y no bloqueante).
const IndividualBodySchema = z.object({
  full_name: FullNameSchema,
});

// Body del registro de empresa: nombre de la org + nombre del admin que la registra.
const OrganizationBodySchema = z.object({
  org_name: FullNameSchema,
  full_name: FullNameSchema,
});

// Body de la edicion del PROPIO perfil (PATCH /v1/me/profile): SOLO el nombre. Schema ESTRECHO de un
// unico campo whitelisted -> cualquier otra clave del body (tier/role/is_admin/account_type/...) se
// DESCARTA en el parseo (zod no la incluye en data) y por tanto JAMAS puede llegar al UPDATE. Reusa la
// MISMA validacion de nombre del registro (FullNameSchema): una sola fuente de verdad.
const ProfileUpdateBodySchema = z.object({
  fullName: FullNameSchema,
});

// Body del cambio de tier (super-admin): el plan al que se mueve el perfil. Mismo set de valores que
// el CHECK de profiles.tier (V007). Es la palanca manual hasta que exista facturacion. Se EXPORTA para
// que el camino atribuible (PUT /v1/admin/users/:id/tier, gate por rol) reuse EXACTAMENTE la misma
// validacion del enum -> una sola fuente de verdad para los tiers validos, sin duplicar el literal.
export const TierBodySchema = z.object({
  tier: z.enum(['free', 'pro', 'autonomous']),
});

/**
 * Rutas de registro multi-tenant y aprobacion. Aditivo: no toca agents ni el flujo de run.
 * El sub del JWT (ya verificado el email via OTP) es la identidad; el registro lo liga a profiles.
 * Permite inyectar el verifier en tests.
 */
export function registrationRoutes(config: Env, deps?: { verifier?: JwtVerifier }) {
  return async function (app: FastifyInstance): Promise<void> {
    const repo = new RegistrationRepository(getSql(config));
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);

    // INDIVIDUAL: queda activo de inmediato (perfil + suscripcion free + usage_counter).
    app.post('/v1/register/individual', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = IndividualBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid registration body', parsed.error.issues);
      }
      const result = await repo.registerIndividual({ sub: user.id, fullName: parsed.data.full_name });
      // 201 si esta llamada creo el perfil; 200 si ya existia (idempotente).
      return reply.status(result.created ? 201 : 200).send(result);
    });

    // EMPRESA: crea la org en 'pending'; el usuario queda org_admin pero NO opera hasta aprobacion.
    app.post('/v1/register/organization', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = OrganizationBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid registration body', parsed.error.issues);
      }
      const result = await repo.registerOrganization({
        sub: user.id,
        orgName: parsed.data.org_name,
        fullName: parsed.data.full_name,
      });
      return reply.status(result.created ? 201 : 200).send(result);
    });

    // Estado del usuario actual: perfil, org+status, plan/suscripcion y usage_counter. Si entro pero
    // no completo registro, needsRegistration = true y el resto es null.
    app.get('/v1/me', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const state = await repo.getState(user.id);
      return reply.send(state);
    });

    // Edicion del PROPIO perfil por el usuario: SOLO full_name. requireUser -> el OWNER es SIEMPRE el sub
    // del token (user.id), NUNCA un id del body/params (no hay :id aca: es "mi" perfil, no el de otro; el
    // camino para editar el perfil de terceros es el admin). El body se valida con un schema ESTRECHO de
    // un solo campo (misma validacion de nombre que el registro): cualquier campo extra del body
    // (tier/role/is_admin/...) se descarta en el parseo y JAMAS llega al UPDATE -> este endpoint no puede
    // tocar campos sensibles aunque el cliente los mande (no reabre la escalada que cerro V018). Escribe
    // con el rol de servicio (como todo el repo), NO relajando la RLS de V018 (profiles sigue default-deny
    // para authenticated). Devuelve el estado consolidado (misma forma que GET /v1/me) para que la consola
    // refresque su cache ['me']. 404 si el usuario aun no tiene perfil (needsRegistration).
    app.patch('/v1/me/profile', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = ProfileUpdateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid profile body', parsed.error.issues);
      }
      const updated = await repo.updateOwnProfileName(user.id, parsed.data.fullName);
      if (!updated) {
        throw new AppError('NOT_FOUND', 404, 'Profile not found');
      }
      const state = await repo.getState(user.id);
      return reply.send(state);
    });

    // Aprobacion de empresa: SOLO super-admin (x-admin-token), NO requireUser. Aqui solo se aprueba;
    // la asignacion de licencia/seats es Fase 1.
    app.post(
      '/v1/admin/organizations/:id/approve',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        requireAdmin(request, config);
        const organization = await repo.approveOrganization(request.params.id);
        if (!organization) {
          throw new AppError('NOT_FOUND', 404, 'Organization not found');
        }
        return reply.send({ organization });
      },
    );

    // Cambio de tier de un perfil: SOLO super-admin (x-admin-token), MISMO patron que la aprobacion
    // de empresas. Es la palanca manual para subir/bajar el plan de un usuario (p.ej. desbloquear el
    // modo autonomo del Configurador con tier 'autonomous') hasta que exista facturacion. Devuelve
    // el perfil actualizado (sin datos sensibles).
    app.post(
      '/v1/admin/profiles/:id/tier',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        requireAdmin(request, config);
        const parsed = TierBodySchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid tier body', parsed.error.issues);
        }
        const targetId = request.params.id;
        // Captura del tier ACTUAL (el `from` del audit) ANTES de cambiarlo. Es maquinaria de
        // auditoria y NO tiene rol funcional en el cambio de tier, por eso su lectura es BEST-EFFORT:
        // si falla (timeout/hipo transitorio de esa consulta), el cambio de tier NO debe romperse; el
        // audit registra from=null y se continua. Debe leerse antes del update (despues devolveria el
        // tier nuevo). Si el perfil no existe devuelve null y el update de abajo respondera 404.
        let fromTier: ProfileTier | null = null;
        try {
          fromTier = await repo.getProfileTier(targetId);
        } catch (err) {
          request.log.warn({ err, targetId }, 'audit log: no se pudo leer el tier previo (from)');
        }
        const profile = await repo.updateProfileTier(targetId, parsed.data.tier);
        if (!profile) {
          throw new AppError('NOT_FOUND', 404, 'Profile not found');
        }
        // AUDIT LOG (best-effort): registrar el cambio SIN alterar el comportamiento del endpoint. El
        // cambio de tier YA se aplico; si el insert del audit falla, se loguea y se continua (la
        // respuesta { profile } se conserva). Un cambio exitoso no debe romperse porque el log no se
        // pudo escribir. actorId es null: este endpoint corre bajo x-admin-token (sin identidad de
        // actor); la columna es nullable para este caso.
        try {
          await repo.recordAdminAction({
            actorId: null,
            action: 'change_tier',
            targetId,
            details: { from: fromTier, to: parsed.data.tier },
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
