import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../config/env.js';
import { getSql } from '../db/client.js';
import { requireAdmin } from '../auth/require-admin.js';
import { RetentionRepository, type PurgeResult } from '../retention/retention-repository.js';
import { DEFAULT_RETENTION_POLICY } from '../retention/retention-policy.js';

/**
 * Endpoint admin de RETENCION (Fase 5.6). Dispara la purga conservadora a demanda (super-admin, x-admin-
 * token): borra agent_runs viejos y jobs terminales viejos segun la politica por default. Es la palanca
 * EXPLICITA (no automatica): un operador la corre, o un cron externo la invoca. La automatizacion in-DB
 * via pg_cron es OPT-IN (V016). No borra nada reciente ni jobs pending/running.
 *
 * `now` se resuelve en el servidor al momento de la llamada (no es input): el corte siempre es una fecha
 * en el pasado calculada desde ahora.
 */
export function retentionRoutes(
  config: Env,
  deps?: {
    retentionRepo?: Pick<RetentionRepository, 'purgeExpired'>;
    now?: () => Date;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const retentionRepo = deps?.retentionRepo ?? new RetentionRepository(getSql(config));
    const now = deps?.now ?? (() => new Date());

    app.post('/v1/admin/retention/purge', async (request: FastifyRequest, reply: FastifyReply) => {
      requireAdmin(request, config);
      const result: PurgeResult = await retentionRepo.purgeExpired(now(), DEFAULT_RETENTION_POLICY);
      return reply.send({ purged: result, policy: DEFAULT_RETENTION_POLICY });
    });
  };
}
