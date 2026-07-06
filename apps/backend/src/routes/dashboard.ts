import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { JobsRepository } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { AgentRunRepository } from '../agents/run-repository.js';
import { ScheduledTaskRepository } from '../scheduling/scheduled-tasks-repository.js';
import { TriggersRepository } from '../triggers/triggers-repository.js';
import { RecipeRepository } from '../recipes/recipes-repository.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import {
  DashboardQuerySchema,
  buildDashboardSummary,
  resolveRange,
  type DashboardSummaryRepos,
} from '../dashboard/summary.js';

/**
 * RESUMEN AGREGADO del dashboard (solo lectura): un unico GET /v1/dashboard que devuelve los tres ejes del
 * owner autenticado -- ACTIVIDAD (ejecuciones), OPERACIONES (estado de cola + recursos activos) y GASTO
 * (tokens de los 4 cubos + su equivalente en dinero BYOK via calcularCosto, desglosado por modelo).
 *
 * Scoped por requireUser: el owner_id SIEMPRE sale del token, nunca del cliente (aislamiento estricto,
 * como el resto del backend). SIN gate por tier: ver el PROPIO dashboard es para todos los planes (un
 * owner free/pro sin ejecuciones autonomas recibe una respuesta valida con ceros/vacios, no un error).
 *
 * La LOGICA de agregacion vive en dashboard/summary.ts (buildDashboardSummary), compartida con el panel de
 * admin sin duplicarla; aca solo se resuelve el actor (user.id del token) y el rango, y se delega. El route
 * NO cambia de comportamiento por esa extraccion: sigue devolviendo SOLO los datos del propio llamador.
 *
 * Es ADITIVO y de SOLO LECTURA: lee agent_runs (via AgentRunRepository), jobs (via JobsRepository) y los
 * repos de recursos; no escribe nada. Todas las lecturas son queries AGREGADAS (sin N+1) y corren en
 * paralelo. Permite inyectar el verifier y los repos en tests (sin red ni DB en CI).
 */
export function dashboardRoutes(
  config: Env,
  // Los repos por owner del resumen se toman del contrato compartido (DashboardSummaryRepos) para no
  // repetir aca la lista de Pick que ya define la agregacion; Partial porque en tests se inyectan y en
  // produccion se construyen por defecto.
  deps?: {
    verifier?: JwtVerifier;
    /** Reloj inyectable para el default de rango (tests deterministas). Ausente -> Date real. */
    now?: () => Date;
  } & Partial<DashboardSummaryRepos>,
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const runRepo = deps?.runRepo ?? new AgentRunRepository(getSql(config));
    const jobsRepo = deps?.jobsRepo ?? new JobsRepository(getSql(config));
    const scheduledRepo = deps?.scheduledRepo ?? new ScheduledTaskRepository(getSql(config));
    const triggersRepo = deps?.triggersRepo ?? new TriggersRepository(getSql(config));
    const recipesRepo = deps?.recipesRepo ?? new RecipeRepository(getSql(config));
    const clock = deps?.now ?? (() => new Date());

    app.get('/v1/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = DashboardQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid dashboard range', parsed.error.issues);
      }
      const range = resolveRange(parsed.data, clock());

      // El owner SIEMPRE es el sub del token: aislamiento estricto (el usuario solo ve lo suyo).
      const summary = await buildDashboardSummary(
        { runRepo, jobsRepo, scheduledRepo, triggersRepo, recipesRepo },
        user.id,
        range,
      );
      return reply.send(summary);
    });
  };
}
