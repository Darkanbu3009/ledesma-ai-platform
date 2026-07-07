import type { DashboardSummary } from './dashboard';

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
 * dos > 0 significa que ya hubo una ejecucion. Pura: solo lee el resumen.
 */
export function hasRunFromSummary(summary: DashboardSummary): boolean {
  return summary.activity.totals.runs > 0 || summary.operations.jobs.total > 0;
}
