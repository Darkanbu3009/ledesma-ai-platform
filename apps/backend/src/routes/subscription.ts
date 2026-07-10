import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PLAN_IDS, getPlanById } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { RegistrationRepository } from '../registration/registration-repository.js';

// Body de POST /v1/subscription/select: SOLO el planId, validado contra la lista CERRADA del modulo
// central de planes (cero confianza en texto libre). Schema ESTRECHO: cualquier otra clave del body
// (ownerId/tier/status/...) se DESCARTA en el parseo y jamas llega a la escritura.
const SelectPlanSchema = z.object({
  planId: z.enum(PLAN_IDS),
});

/**
 * SELECCION SELF-SERVICE DE PLAN (lanzamiento gratuito): POST /v1/subscription/select activa el plan
 * elegido AL INSTANTE para el owner autenticado, SIN autorizacion manual y SIN cobro. Escribe en la
 * MISMA fuente de verdad que leen los gates (profiles.tier + subscriptions.plan/status, via
 * RegistrationRepository.selectPlan, en una transaccion) y devuelve el estado consolidado (misma forma
 * que GET /v1/me) para que la consola refresque su cache ['me'] sin recargar.
 *
 * SEGURIDAD: el owner es SIEMPRE el sub del token (requireUser); no hay :id ni owner en el body, asi
 * que por este camino no se puede cambiar el plan de otro usuario. El desbloqueo ya NO pasa por
 * upgrade_requests (que sigue existiendo solo como canal de leads/contacto con ventas).
 *
 * IDEMPOTENTE: reelegir el plan actual re-escribe los mismos valores y responde 200 con el mismo
 * estado, sin efectos raros.
 *
 * PUNTO DE EXTENSION STRIPE: este endpoint es el "activador gratuito" TEMPORAL del lanzamiento. El PR
 * de medios de pago insertara aqui la confirmacion de pago (checkout antes de activar) y los webhooks
 * de Stripe gobernaran subscriptions.status; escribiran las MISMAS columnas via el MISMO repositorio,
 * asi que ni el gating ni el catalogo necesitan tocarse cuando eso ocurra.
 *
 * Permite inyectar el verifier y el repo en tests (sin red ni DB en CI), mismo patron que recipes.ts.
 */
export function subscriptionRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    registrationRepo?: Pick<RegistrationRepository, 'selectPlan'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const registrationRepo = deps?.registrationRepo ?? new RegistrationRepository(getSql(config));

    app.post('/v1/subscription/select', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);

      const parsed = SelectPlanSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid plan selection', parsed.error.issues);
      }

      // Definicion completa del plan desde el modulo central: el tier que se escribe sale de AQUI
      // (jamas del cliente).
      const plan = getPlanById(parsed.data.planId);
      const state = await registrationRepo.selectPlan(user.id, plan);
      if (!state) {
        throw new AppError('NOT_FOUND', 404, 'Profile not found');
      }
      return reply.send(state);
    });
  };
}
