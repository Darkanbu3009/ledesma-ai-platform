import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { requireAdmin } from '../auth/require-admin.js';

// Body del registro individual: identidad minima. identity_verified NO es input (lo fija el repo
// en false; la verificacion es ligera y no bloqueante).
const IndividualBodySchema = z.object({
  full_name: z.string().trim().min(1).max(200),
});

// Body del registro de empresa: nombre de la org + nombre del admin que la registra.
const OrganizationBodySchema = z.object({
  org_name: z.string().trim().min(1).max(200),
  full_name: z.string().trim().min(1).max(200),
});

// Body del cambio de tier (super-admin): el plan al que se mueve el perfil. Mismo set de valores que
// el CHECK de profiles.tier (V007). Es la palanca manual hasta que exista facturacion.
const TierBodySchema = z.object({
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
        const profile = await repo.updateProfileTier(request.params.id, parsed.data.tier);
        if (!profile) {
          throw new AppError('NOT_FOUND', 404, 'Profile not found');
        }
        return reply.send({ profile });
      },
    );
  };
}
