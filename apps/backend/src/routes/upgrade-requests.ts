import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { UpgradeRequestsRepository } from '../upgrade/upgrade-requests-repository.js';

// Planes SOLICITABLES: el universo de profiles.tier (V007) MENOS 'free' (el estado actual / un downgrade,
// no se 'solicita'). Hoy 'autonomous' es el unico que desbloquea las features premium; 'pro' se admite
// para cuando exista un plan intermedio. Coincide con el CHECK upgrade_requests_tier_check de V023. Se
// mantiene como enum propio (y no se reusa TierBodySchema de registration.ts, que incluye 'free') porque
// aqui 'free' NO es un valor valido de solicitud.
const RequestedTierSchema = z.enum(['pro', 'autonomous']);

// Las 4 superficies premium que pueden disparar la solicitud (scheduled_tasks/triggers/recipes son las
// tablas V009/V012/V013; configurator es el modo autonomo del Configurador). OPCIONAL: un CTA generico
// puede omitirlo. Coincide con el CHECK upgrade_requests_feature_check de V023.
const FeatureContextSchema = z.enum(['scheduled_tasks', 'triggers', 'recipes', 'configurator']);

// Body de POST /v1/upgrade-requests: el tier deseado (requerido) y, opcional, la feature que disparo la
// solicitud. Schema ESTRECHO: cualquier otra clave del body (owner_id/status/note/...) se DESCARTA en el
// parseo -> jamas llega al INSERT. En particular el owner NUNCA sale del body: lo fija el token (ver abajo).
const CreateUpgradeRequestSchema = z.object({
  requestedTier: RequestedTierSchema,
  featureContext: FeatureContextSchema.optional(),
});

/**
 * SOLICITUDES DE UPGRADE del usuario (self-service), scoped por el usuario autenticado (requireUser, mismo
 * auth JWT que /v1/recipes). Captura la DEMANDA de un 'free' por una feature premium para alimentar la
 * conversion (Fase 1 de monetizacion). El owner_id SIEMPRE sale del token.
 *
 * A diferencia de recipes/scheduled_tasks/triggers, crear una solicitud NO exige tier 'autonomous': el
 * punto es justamente que un 'free' la cree. Y NO sube el tier (solo registra el interes; subir el tier
 * sigue siendo exclusivo del admin, admin-user-tier.ts): el enforcement de tier queda intacto.
 *
 * ANTI-DUPLICADO / anti-spam: si el usuario ya tiene una solicitud 'pending' para el mismo tier, NO se crea
 * un duplicado (se devuelve la existente con 200). Asi un free no genera N solicitudes clickeando el CTA.
 * El indice unico parcial de V023 respalda esto ante clicks concurrentes.
 *
 * Permite inyectar el verifier y el repo en tests (sin red ni DB en CI), mismo patron que recipes.ts.
 */
export function upgradeRequestRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    upgradeRepo?: Pick<
      UpgradeRequestsRepository,
      'findPendingByOwnerAndTier' | 'createRequest' | 'listByOwner'
    >;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const upgradeRepo = deps?.upgradeRepo ?? new UpgradeRequestsRepository(getSql(config));

    // Registra la DEMANDA. owner = sub del token, NUNCA del body. NO sube el tier (solo registra interes).
    app.post('/v1/upgrade-requests', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);

      const parsed = CreateUpgradeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid upgrade request', parsed.error.issues);
      }

      // ANTI-DUPLICADO (select-then-insert): una 'pending' existente del mismo tier se devuelve tal cual
      // (created:false, 200), sin crear un duplicado. Como el sistema de errores no tiene CONFLICT/409
      // (app-error.ts), se modela como IDEMPOTENCIA (200 vs 201), mismo criterio que el registro. El indice
      // unico parcial de V023 respalda el caso concurrente (el repo captura el 23505 y devuelve la existente).
      const existing = await upgradeRepo.findPendingByOwnerAndTier(user.id, parsed.data.requestedTier);
      if (existing) {
        return reply.status(200).send({ upgradeRequest: existing, created: false });
      }

      const result = await upgradeRepo.createRequest({
        // owner del TOKEN (jamas del body): no se puede crear una solicitud a nombre de otro.
        ownerId: user.id,
        requestedTier: parsed.data.requestedTier,
        featureContext: parsed.data.featureContext ?? null,
      });
      // created del repo: 201 si esta llamada inserto la fila, 200 si recupero una existente (carrera
      // concurrente perdida contra el indice unico parcial) -> la respuesta nunca miente sobre el created.
      return reply
        .status(result.created ? 201 : 200)
        .send({ upgradeRequest: result.upgradeRequest, created: result.created });
    });

    // Las solicitudes del propio usuario (mas nuevas primero), para que la UI muestre "solicitud enviada"
    // en vez de re-ofrecer el CTA. Solo las del owner del token.
    app.get('/v1/upgrade-requests/me', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const upgradeRequests = await upgradeRepo.listByOwner(user.id);
      return reply.send({ upgradeRequests });
    });
  };
}
