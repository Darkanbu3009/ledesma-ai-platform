import type { UsageRange } from './usage';
import { formatDayLabel } from './usage';

/**
 * Contrato del resumen agregado que devuelve GET /v1/dashboard (backend: apps/backend/src/routes/
 * dashboard.ts). Un unico endpoint scoped por owner que trae los TRES ejes -- ACTIVIDAD (ejecuciones),
 * OPERACIONES (estado de cola + recursos activos) y GASTO (los 4 cubos de tokens + su equivalente en
 * dinero BYOK por modelo). Estos tipos reflejan el shape EXACTO de la respuesta para tipar el hook y las
 * graficas; la logica de transformacion a lo que consume Recharts vive aqui (pura y testeable).
 */

/** Rango temporal efectivo resuelto por el backend (los ausentes caen al default de 30 dias). */
export interface DashboardRange {
  from: string;
  to: string;
  /** true si el cliente no paso from NI to (respuesta con la ventana por defecto). */
  defaulted: boolean;
  defaultWindowDays: number;
}

/** Ventana maxima de datos disponibles segun la politica de retencion (documenta cuan atras se puede pedir). */
export interface DashboardRetention {
  agentRunsDays: number;
  jobsTerminalDays: number;
}

/** Totales de ejecucion del owner dentro del rango. */
export interface DashboardActivityTotals {
  runs: number;
  completed: number;
  errors: number;
}

/** Un dia de la serie de actividad: corridas + los 4 cubos de tokens de ese dia. */
export interface DashboardDay {
  date: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** EJE 1 -- ACTIVIDAD: totales + serie diaria + ultima ejecucion (null si no hubo en el rango). */
export interface DashboardActivity {
  totals: DashboardActivityTotals;
  byDay: DashboardDay[];
  lastRunAt: string | null;
}

/** Conteo de jobs por estado de cola + total (foto actual, no acotada por fecha). */
export interface DashboardJobs {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}

/** Recursos activos del owner (conteos server-side). */
export interface DashboardResources {
  scheduledTasksActive: number;
  triggersActive: number;
  recipesActive: number;
}

/** EJE 2 -- OPERACIONES: estado de cola + recursos activos. */
export interface DashboardOperations {
  jobs: DashboardJobs;
  resources: DashboardResources;
}

/** Los 4 cubos de tokens agregados del owner en el rango. */
export interface DashboardTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Un dia de la serie de gasto: los 4 cubos de tokens de ese dia (derivada de la actividad). */
export interface DashboardSpendDay {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Gasto de UN modelo: los 4 cubos de tokens + su costo en USD (via calcularCosto en el backend).
 * `costUsd` es null cuando el modelo no tiene tarifa conocida (no se inventa un monto); `priced`
 * es el mismo dato como booleano para filtrar comodo.
 */
export interface DashboardModelSpend {
  model: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  priced: boolean;
}

/**
 * EJE 3 -- GASTO: transparencia BYOK (lo que el cliente consumio sobre SU key, no un cobro de Ledesma).
 * `note` viaja desde el backend con el texto de transparencia; `costComplete` es false cuando algun
 * modelo con consumo no tiene tarifa (el total en dinero es parcial y hay que comunicarlo).
 */
export interface DashboardSpend {
  byok: boolean;
  note: string;
  currency: string;
  tokens: DashboardTokens;
  byDay: DashboardSpendDay[];
  byModel: DashboardModelSpend[];
  totalCostUsd: number;
  untariffedModels: string[];
  costComplete: boolean;
}

/** Respuesta completa de GET /v1/dashboard. */
export interface DashboardSummary {
  range: DashboardRange;
  retention: DashboardRetention;
  activity: DashboardActivity;
  operations: DashboardOperations;
  spend: DashboardSpend;
}

// ---------------------------------------------------------------------------------------------------
// Rango temporal del selector (7d / 30d / 90d). Todos caben dentro de la retencion de agent_runs (365
// dias), asi que ACTIVIDAD y GASTO nunca piden mas alla de lo disponible; OPERACIONES es la foto actual.

export type DashboardRangePreset = '7d' | '30d' | '90d';

const PRESET_DAYS: Record<DashboardRangePreset, number> = { '7d': 7, '30d': 30, '90d': 90 };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Rango ISO hacia atras desde `now` segun el preset. Solo fija `from`: el backend completa `to` con
 * "ahora", igual que GET /v1/agents/:id/usage. `now` se inyecta para tests deterministas.
 */
export function dashboardRangeFromPreset(preset: DashboardRangePreset, now: Date = new Date()): UsageRange {
  return { from: new Date(now.getTime() - PRESET_DAYS[preset] * MS_PER_DAY).toISOString() };
}

/** Querystring `?from=...&to=...` con solo los campos presentes (cadena vacia si no hay ninguno). */
export function dashboardQueryString(range: UsageRange): string {
  const params = new URLSearchParams();
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  const query = params.toString();
  return query ? `?${query}` : '';
}

// ---------------------------------------------------------------------------------------------------
// Transformaciones al shape que consume Recharts (puras y testeables; las graficas solo dibujan).

/** Un punto de la grafica de actividad: la fecha cruda (key estable), su etiqueta legible y las corridas. */
export interface ActivityPoint {
  date: string;
  label: string;
  runs: number;
}

/** Mapea la serie diaria del backend a los puntos de la grafica de ejecuciones por dia. */
export function toActivitySeries(byDay: DashboardDay[]): ActivityPoint[] {
  return byDay.map((day) => ({ date: day.date, label: formatDayLabel(day.date), runs: day.runs }));
}

/** Una barra de la grafica de gasto por modelo: el modelo y su costo en USD (ya tarifado). */
export interface ModelSpendPoint {
  model: string;
  costUsd: number;
}

/**
 * Modelos CON tarifa, ordenados por costo descendente, para la grafica de barras de gasto. Los modelos
 * sin tarifa (costUsd null) se omiten de la grafica -- no tienen monto que graficar -- y se comunican
 * aparte via `spend.untariffedModels`.
 */
export function toModelSpendSeries(byModel: DashboardModelSpend[]): ModelSpendPoint[] {
  return byModel
    .flatMap((m) => (m.costUsd === null ? [] : [{ model: m.model, costUsd: m.costUsd }]))
    .sort((a, b) => b.costUsd - a.costUsd);
}

/** Suma de los 4 cubos de tokens (para el total de tokens del gasto). */
export function totalTokens(tokens: DashboardTokens): number {
  return (
    tokens.inputTokens + tokens.outputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens
  );
}

/**
 * true si hay algo real que mostrar. "Nada ejecutado aun" = ni corridas de agente ni jobs en la cola;
 * en ese caso la pantalla guia con un EmptyState en vez de mostrar puros ceros y una grafica vacia.
 */
export function hasDashboardData(summary: DashboardSummary): boolean {
  return summary.activity.totals.runs > 0 || summary.operations.jobs.total > 0;
}
