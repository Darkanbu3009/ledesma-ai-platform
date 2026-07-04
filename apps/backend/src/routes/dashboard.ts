import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { JobsRepository, calcularCosto, type JobStatusCounts } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import {
  AgentRunRepository,
  type OwnerModelUsage,
  type OwnerRunsByDay,
  type OwnerUsageTotals,
} from '../agents/run-repository.js';
import { ScheduledTaskRepository } from '../scheduling/scheduled-tasks-repository.js';
import { TriggersRepository } from '../triggers/triggers-repository.js';
import { RecipeRepository } from '../recipes/recipes-repository.js';
import { DEFAULT_RETENTION_POLICY } from '../retention/retention-policy.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';

// Ventana por defecto del resumen si el cliente no pasa ?from/?to: los ultimos 30 dias (dato reciente,
// util para la carga inicial del dashboard). El rango efectivo SIEMPRE se refleja en la respuesta.
const DEFAULT_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// El gasto NO es un cobro de Ledesma: la plataforma es BYOK (el cliente ejecuta con SU key y el proveedor
// le factura a EL). El monto en dinero es TRANSPARENCIA ("cuanto consumiste y cuanto equivale"), no COGS.
// Este texto viaja en la respuesta para que la UI lo comunique sin ambiguedad.
const BYOK_SPEND_NOTE =
  'Transparencia BYOK: es el consumo estimado sobre tu propia key del proveedor, no un cobro de Ledesma.';

// Mismo contrato de rango que GET /v1/agents/:id/usage: from/to ISO 8601 opcionales. Ambos ausentes ->
// se aplica la ventana por defecto (30 dias). Se validan antes de tocar ningun repo.
const DashboardQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/** Rango efectivo resuelto: Dates para las queries + marca de si se aplico el default. */
interface ResolvedRange {
  from: Date;
  to: Date;
  /** true si el cliente no paso from NI to (respuesta con la ventana por defecto). */
  defaulted: boolean;
}

/**
 * Resuelve el rango efectivo a partir del querystring ya validado. `to` default = ahora; `from` default =
 * `to` - 30 dias. Asi, si el cliente pasa solo `from`, la ventana llega hasta ahora; si pasa solo `to`,
 * arranca 30 dias antes. `now` se inyecta (testeable, sin leer el reloj adentro).
 */
function resolveRange(query: z.infer<typeof DashboardQuerySchema>, now: Date): ResolvedRange {
  const to = query.to ? new Date(query.to) : now;
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY);
  return { from, to, defaulted: query.from === undefined && query.to === undefined };
}

/** DTO del gasto por modelo: los 4 cubos de tokens + su costo en USD (null si el modelo no esta tarifado). */
interface ModelSpend extends OwnerModelUsage {
  /** USD del modelo via calcularCosto sobre sus 4 cubos. null = modelo sin tarifa (no se inventa monto). */
  costUsd: number | null;
  /** true si el modelo tiene tarifa conocida (costUsd es un monto real, no null). */
  priced: boolean;
}

/**
 * Arma el eje GASTO: por CADA modelo aplica calcularCosto sobre sus 4 cubos (cada modelo tiene tarifa
 * distinta), suma los costos tarifados en `totalCostUsd`, y lista aparte los modelos SIN tarifa. El total
 * NUNCA fabrica dinero para un modelo desconocido: esos quedan con costUsd null y se reportan en
 * `untariffedModels` con `costComplete=false`, para que la UI muestre "+ sin tarifar" en vez de un total
 * enganoso. La serie por dia reusa la de actividad (mismos cubos) sin una query extra.
 */
function buildSpend(totals: OwnerUsageTotals, byDay: OwnerRunsByDay[], byModelUsage: OwnerModelUsage[]) {
  const byModel: ModelSpend[] = byModelUsage.map((m) => {
    const costUsd = calcularCosto(m.model, {
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheReadTokens: m.cacheReadTokens,
      cacheWriteTokens: m.cacheWriteTokens,
    });
    return { ...m, costUsd, priced: costUsd !== null };
  });
  const totalCostUsd = byModel.reduce((acc, m) => (m.costUsd === null ? acc : acc + m.costUsd), 0);
  const untariffedModels = byModel.filter((m) => !m.priced).map((m) => m.model);
  return {
    byok: true,
    note: BYOK_SPEND_NOTE,
    currency: 'USD',
    // Agregado de los 4 cubos (fuente unica: los totales del owner en el rango).
    tokens: {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens,
    },
    // Tokens por dia (los 4 cubos): derivado de la serie de actividad, sin query adicional.
    byDay: byDay.map((d) => ({
      date: d.date,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      cacheReadTokens: d.cacheReadTokens,
      cacheWriteTokens: d.cacheWriteTokens,
    })),
    byModel,
    totalCostUsd,
    untariffedModels,
    // true si TODOS los modelos con consumo estan tarifados (el total es completo). Sin datos -> true.
    costComplete: untariffedModels.length === 0,
  };
}

/**
 * RESUMEN AGREGADO del dashboard (solo lectura): un unico GET /v1/dashboard que devuelve los tres ejes del
 * owner autenticado -- ACTIVIDAD (ejecuciones), OPERACIONES (estado de cola + recursos activos) y GASTO
 * (tokens de los 4 cubos + su equivalente en dinero BYOK via calcularCosto, desglosado por modelo).
 *
 * Scoped por requireUser: el owner_id SIEMPRE sale del token, nunca del cliente (aislamiento estricto,
 * como el resto del backend). SIN gate por tier: ver el PROPIO dashboard es para todos los planes (un
 * owner free/pro sin ejecuciones autonomas recibe una respuesta valida con ceros/vacios, no un error).
 *
 * Es ADITIVO y de SOLO LECTURA: lee agent_runs (via AgentRunRepository), jobs (via JobsRepository) y los
 * repos de recursos; no escribe nada. Todas las lecturas son queries AGREGADAS (sin N+1) y corren en
 * paralelo. Permite inyectar el verifier y los repos en tests (sin red ni DB en CI).
 *
 * Alcance temporal: ACTIVIDAD y GASTO se acotan al rango ?from/?to (default 30 dias); OPERACIONES es la
 * FOTO ACTUAL (estado de cola + recursos activos), no acotada por fecha. `retention` documenta la ventana
 * maxima de datos disponibles (agent_runs 365 dias, jobs terminales 90 dias).
 */
export function dashboardRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    runRepo?: Pick<AgentRunRepository, 'totalsForOwner' | 'runsByDayForOwner' | 'tokensByModelForOwner'>;
    jobsRepo?: Pick<JobsRepository, 'countByStatusForOwner'>;
    scheduledRepo?: Pick<ScheduledTaskRepository, 'countActiveByOwner'>;
    triggersRepo?: Pick<TriggersRepository, 'countActiveByOwner'>;
    recipesRepo?: Pick<RecipeRepository, 'countActiveByOwner'>;
    /** Reloj inyectable para el default de rango (tests deterministas). Ausente -> Date real. */
    now?: () => Date;
  },
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
      const rangeArg = { from: range.from, to: range.to };

      // Todas las agregaciones del owner en paralelo (sin N+1). ACTIVIDAD/GASTO acotan por rango;
      // OPERACIONES (cola + recursos) es la foto actual.
      const [totals, byDay, byModelUsage, jobCounts, scheduledActive, triggersActive, recipesActive] =
        await Promise.all([
          runRepo.totalsForOwner(user.id, rangeArg),
          runRepo.runsByDayForOwner(user.id, rangeArg),
          runRepo.tokensByModelForOwner(user.id, rangeArg),
          jobsRepo.countByStatusForOwner(user.id),
          scheduledRepo.countActiveByOwner(user.id),
          triggersRepo.countActiveByOwner(user.id),
          recipesRepo.countActiveByOwner(user.id),
        ]);

      const jobs: JobStatusCounts & { total: number } = {
        ...jobCounts,
        total: jobCounts.pending + jobCounts.running + jobCounts.completed + jobCounts.failed,
      };

      return reply.send({
        range: {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          defaulted: range.defaulted,
          defaultWindowDays: DEFAULT_WINDOW_DAYS,
        },
        // Ventana maxima de datos disponibles (politica de retencion): documenta cuan atras se puede pedir.
        retention: {
          agentRunsDays: DEFAULT_RETENTION_POLICY.agentRunsDays,
          jobsTerminalDays: DEFAULT_RETENTION_POLICY.terminalJobsDays,
        },
        // EJE 1 -- ACTIVIDAD: totales de ejecuciones + serie por dia (runs y tokens) + ultima ejecucion.
        activity: {
          totals: { runs: totals.runs, completed: totals.completed, errors: totals.errors },
          byDay,
          lastRunAt: totals.lastRunAt,
        },
        // EJE 2 -- OPERACIONES: estado de cola por owner + recursos activos (conteos server-side).
        operations: {
          jobs,
          resources: {
            scheduledTasksActive: scheduledActive,
            triggersActive,
            recipesActive,
          },
        },
        // EJE 3 -- GASTO: tokens de los 4 cubos (agregado y por dia) + dinero BYOK por modelo.
        spend: buildSpend(totals, byDay, byModelUsage),
      });
    });
  };
}
