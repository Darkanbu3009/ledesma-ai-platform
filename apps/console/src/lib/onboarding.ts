import type { DashboardSummary } from './dashboard';
import type { UsageRange } from './usage';

/**
 * Estado del ONBOARDING guiado (primeros pasos) DERIVADO de datos reales -- nunca de checkboxes
 * manuales ni de estado persistido en el cliente. Los tres pasos espejan el hilo cero-a-primer-agente:
 * poner una credencial -> crear un agente -> ejecutarlo. Cuando los tres estan hechos (`isComplete`) el
 * checklist y la bienvenida desaparecen: no molestan a usuarios establecidos. Sin imports de red, asi la
 * derivacion se testea como funcion pura (igual que registration.ts / dashboard.ts).
 */
export interface OnboardingProgress {
  /** El usuario guardo al menos una credencial de proveedor (GET /v1/credentials). */
  hasCredential: boolean;
  /** El usuario creo al menos un agente (GET /v1/agents). */
  hasAgent: boolean;
  /** El usuario ejecuto al menos una vez (agent_runs, via el resumen owner-scoped del dashboard). */
  hasRun: boolean;
  /** Cuantos de los pasos estan hechos (0..ONBOARDING_STEP_COUNT). */
  completedCount: number;
  /** Los tres pasos hechos: el onboarding termino. */
  isComplete: boolean;
}

/** Total de pasos del hilo guiado. */
export const ONBOARDING_STEP_COUNT = 3;

/**
 * Ventana amplia para la senal de EJECUCION: 365 dias, alineada con la retencion de agent_runs
 * (DashboardRetention.agentRunsDays). El resumen del dashboard acota ACTIVIDAD por rango, asi que si se
 * consultara con la ventana por defecto (30d) `hasRun` NO seria durable: un usuario establecido que ya
 * ejecuto pero estuvo inactivo >30d volveria a ver el paso 3 como pendiente (estado falso). Pedir 365d
 * hace `hasRun` monotono en la practica ("ejecuto en el ultimo ano"), sin tocar el backend.
 */
export const ONBOARDING_RUN_WINDOW_DAYS = 365;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Rango para la senal de ejecucion del onboarding: `from` = hace ONBOARDING_RUN_WINDOW_DAYS dias (el
 * backend completa `to` con "ahora"). `now` se inyecta para tests deterministas, igual que
 * dashboardRangeFromPreset.
 */
export function onboardingRunWindow(now: Date = new Date()): UsageRange {
  return { from: new Date(now.getTime() - ONBOARDING_RUN_WINDOW_DAYS * MS_PER_DAY).toISOString() };
}

/** Las tres senales crudas (booleans ya derivados de cada fuente real). */
export interface OnboardingSignals {
  hasCredential: boolean;
  hasAgent: boolean;
  hasRun: boolean;
}

/**
 * Deriva el progreso a partir de las tres senales. PURA y testeable: `completedCount` es la suma de las
 * senales verdaderas; `isComplete` exige las tres. No inventa estado ni persiste nada -- refleja tal cual
 * lo que dicen los datos (veraz: un paso NO se marca hecho si su senal dice que no).
 */
export function deriveOnboardingProgress(signals: OnboardingSignals): OnboardingProgress {
  const completedCount =
    (signals.hasCredential ? 1 : 0) + (signals.hasAgent ? 1 : 0) + (signals.hasRun ? 1 : 0);
  return {
    hasCredential: signals.hasCredential,
    hasAgent: signals.hasAgent,
    hasRun: signals.hasRun,
    completedCount,
    isComplete: completedCount === ONBOARDING_STEP_COUNT,
  };
}

/**
 * ¿El owner ejecuto al menos una vez? Se deriva del resumen del dashboard (GET /v1/dashboard), la senal
 * owner-scoped de agent_runs: `activity.totals.runs` cuenta las corridas del rango -- una corrida del
 * Playground YA cuenta, porque el backend la registra con el owner_id del agente -- y
 * `operations.jobs.total` cubre las ejecuciones encoladas (recetas/tareas/triggers). Cualquiera de las
 * dos > 0 significa que ya hubo una ejecucion. El hook consulta el resumen con la ventana amplia
 * (onboardingRunWindow) para que la senal sea durable y no reaparezca para un usuario establecido. Pura:
 * solo lee el resumen.
 */
export function hasRunFromSummary(summary: DashboardSummary): boolean {
  return summary.activity.totals.runs > 0 || summary.operations.jobs.total > 0;
}
