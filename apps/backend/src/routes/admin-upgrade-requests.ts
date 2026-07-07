import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireAdminRole } from '../auth/require-admin-role.js';
import { UpgradeRequestsRepository } from '../upgrade/upgrade-requests-repository.js';

// Paginacion del listado: 50 es el techo duro por pagina y 20 el default, mismos numeros que el resto de
// los listados admin (admin-users). Se acota server-side: el cliente no puede pedir mas de 50.
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// Filtro opcional por estado del lead (mismo enum que el CHECK upgrade_requests_status_check de V023).
const StatusSchema = z.enum(['pending', 'contacted', 'converted', 'declined']);

// Querystring: paginacion + filtro opcional por status. limit/offset llegan como strings, por eso z.coerce;
// ambos con default y acotados (limit 1..50, offset >= 0). status ausente -> sin filtro (todas).
const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
  status: StatusSchema.optional(),
});

/**
 * PANEL DE ADMIN (solo lectura) de las SOLICITUDES DE UPGRADE, gateado por ROL (requireAdminRole): un
 * no-admin recibe 403, sin JWT 401. Lista los leads (todas las solicitudes de la plataforma, con owner +
 * tier + feature + status + fecha) para que el admin los vea y los convierta subiendo el tier con el flujo
 * que ya existe (PUT /v1/admin/users/:id/tier, admin-user-tier.ts). Cierra el circuito lead -> admin ->
 * conversion.
 *
 * Mismo molde que admin-users.ts: gate PRIMERO, luego parseo del querystring, luego el repo (que corre con
 * el rol de servicio y OMITE RLS, por eso ve a TODOS: NO aisla por owner; la proteccion es el gate, no un
 * filtro de pertenencia). READ-ONLY puro: no muta nada y por eso NO registra audit log (el audit es para
 * mutaciones; la unica mutacion del panel sigue siendo el cambio de tier). Vive en su propio archivo,
 * separado de las rutas de usuario (upgrade-requests.ts), igual que admin-users.ts se separa de agents.ts.
 * Permite inyectar el verifier y los repos en tests (sin red ni DB).
 */
export function adminUpgradeRequestsRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    upgradeRepo?: Pick<UpgradeRequestsRepository, 'listAll'>;
    // Solo isAdmin: el gate por rol lee profiles.is_admin server-side (RegistrationRepository).
    repo?: Pick<RegistrationRepository, 'isAdmin'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const upgradeRepo = deps?.upgradeRepo ?? new UpgradeRequestsRepository(getSql(config));
    const repo = deps?.repo ?? new RegistrationRepository(getSql(config));

    app.get('/v1/admin/upgrade-requests', async (request: FastifyRequest, reply: FastifyReply) => {
      // Gate por ROL: 401 sin/invalido JWT, 403 si el sub no es super-admin. Se valida ANTES de tocar el
      // querystring o el repo de datos (un no-admin nunca ve un 400 revelador).
      await requireAdminRole(request, verifier, repo);

      const parsed = ListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid query', parsed.error.issues);
      }
      const { limit, offset, status } = parsed.data;

      const { items, total } = await upgradeRepo.listAll({ limit, offset, status });
      return reply.send({
        upgradeRequests: items,
        pagination: {
          limit,
          offset,
          total,
          // Con el total exacto del count(*) over(), hasMore es preciso: hay mas si aun no llegamos al final.
          hasMore: offset + items.length < total,
        },
      });
    });
  };
}
