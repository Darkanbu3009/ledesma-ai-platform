import { z } from 'zod';
import { calcularCosto, type JobsRepository, type JobStatusCounts } from '@ledesma-platform/shared';
import {
  type AgentRunRepository,
  type OwnerModelUsage,
  type OwnerRunsByDay,
  type OwnerUsageTotals,
} from '../agents/run-repository.js';
import type { ScheduledTaskRepository } from '../scheduling/scheduled-tasks-repository.js';
import type { TriggersRepository } from '../triggers/triggers-repository.js';
import type { RecipeRepository } from '../recipes/recipes-repository.js';
import { DEFAULT_RETENTION_POLICY } from '../retention/retention-policy.js';

// LOGICA DE AGREGACION DEL DASHBOARD, extraida de routes/dashboard.ts para poder reusarla desde MAS de un
// route SIN duplicarla: hoy la usan el dashboard del PROPIO usuario (GET /v1/dashboard, ownerId = user.id
// del token) y la ficha de ACTIVIDAD del panel de admin (GET /v1/admin/users/:id/activity, ownerId = :id
// arbitrario, gateado por rol). Toda la agregacion recibe el ownerId como PARAMETRO: no hardcodea ninguna
// pertenencia, el llamador decide de quien es el resumen. Es de SOLO LECTURA (solo lee repos agregados).

// Ventana por defecto del resumen si el cliente no pasa ?from/?to: los ultimos 30 dias (dato reciente,
// util para la carga inicial). El rango efectivo SIEMPRE se refleja en la respuesta.
export const DEFAULT_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// El gasto NO es un cobro de Ledesma: la plataforma es BYOK (el cliente ejecuta con SU key y el proveedor
// le factura a EL). El monto en dinero es TRANSPARENCIA ("cuanto consumiste y cuanto equivale"), no COGS.
// Este texto viaja en la respuesta para que la UI lo comunique sin ambiguedad.
const BYOK_SPEND_NOTE =
  'Transparencia BYOK: es el consumo estimado sobre tu propia key del proveedor, no un cobro de Ledesma.';

// Mismo contrato de rango que GET /v1/agents/:id/usage: from/to ISO 8601 opcionales. Ambos ausentes ->
// se aplica la ventana por defecto (30 dias). Se validan antes de tocar ningun repo.
export const DashboardQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/** Rango efectivo resuelto: Dates para las queries + marca de si se aplico el default. */
export interface ResolvedRange {
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
export function resolveRange(query: z.infer<typeof DashboardQuerySchema>, now: Date): ResolvedRange {
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
 * Repos AGREGADOS por owner que la agregacion necesita (subset minimo de cada uno). Cada metodo recibe el
 * ownerId, asi que el mismo conjunto sirve para cualquier dueno. Se pasan por inyeccion para testear sin
 * red ni DB, igual que en los routes.
 */
export interface DashboardSummaryRepos {
  runRepo: Pick<AgentRunRepository, 'totalsForOwner' | 'runsByDayForOwner' | 'tokensByModelForOwner'>;
  jobsRepo: Pick<JobsRepository, 'countByStatusForOwner'>;
  scheduledRepo: Pick<ScheduledTaskRepository, 'countActiveByOwner'>;
  triggersRepo: Pick<TriggersRepository, 'countActiveByOwner'>;
  recipesRepo: Pick<RecipeRepository, 'countActiveByOwner'>;
}

/**
 * RESUMEN AGREGADO de UN owner (los tres ejes) para el rango dado. Es el corazon compartido del dashboard:
 * ACTIVIDAD (ejecuciones), OPERACIONES (estado de cola + recursos activos) y GASTO (tokens de los 4 cubos +
 * su equivalente BYOK en dinero via calcularCosto, desglosado por modelo).
 *
 * `ownerId` es un PARAMETRO: el propio usuario lo pasa como su user.id; el panel de admin como el :id
 * objetivo. La funcion NO decide pertenencia ni aplica ningun gate (eso es responsabilidad del route que la
 * llama). Todas las lecturas son queries AGREGADAS (sin N+1) y corren en paralelo.
 *
 * Alcance temporal: ACTIVIDAD y GASTO se acotan al rango; OPERACIONES es la FOTO ACTUAL (estado de cola +
 * recursos activos), no acotada por fecha. `retention` documenta la ventana maxima de datos disponibles
 * (agent_runs 365 dias, jobs terminales 90 dias).
 */
export async function buildDashboardSummary(
  repos: DashboardSummaryRepos,
  ownerId: string,
  range: ResolvedRange,
) {
  const rangeArg = { from: range.from, to: range.to };

  // Todas las agregaciones del owner en paralelo (sin N+1). ACTIVIDAD/GASTO acotan por rango;
  // OPERACIONES (cola + recursos) es la foto actual.
  const [totals, byDay, byModelUsage, jobCounts, scheduledActive, triggersActive, recipesActive] =
    await Promise.all([
      repos.runRepo.totalsForOwner(ownerId, rangeArg),
      repos.runRepo.runsByDayForOwner(ownerId, rangeArg),
      repos.runRepo.tokensByModelForOwner(ownerId, rangeArg),
      repos.jobsRepo.countByStatusForOwner(ownerId),
      repos.scheduledRepo.countActiveByOwner(ownerId),
      repos.triggersRepo.countActiveByOwner(ownerId),
      repos.recipesRepo.countActiveByOwner(ownerId),
    ]);

  const jobs: JobStatusCounts & { total: number } = {
    ...jobCounts,
    total:
      jobCounts.pending +
      jobCounts.running +
      jobCounts.completed +
      jobCounts.failed +
      jobCounts.pausado,
  };

  return {
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
  };
}
