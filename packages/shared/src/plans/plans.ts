// MODULO CENTRAL DE PLANES: la UNICA fuente de verdad de los planes comerciales (id, tier al que
// mapean, limite de ejecuciones y capacidades). Lo consumen:
//  - el GATING server-side (backend y worker): los gates de Recetas/Tareas/Triggers/Configurador ya
//    NO comparan un tier string suelto, sino que derivan la capacidad de aqui (tierAllowsAutonomy).
//  - el ENDPOINT de seleccion self-service (POST /v1/subscription/select): valida el planId contra
//    la lista cerrada (isPlanId) y escribe el tier que define el plan elegido.
//  - el CATALOGO de la consola (/configuracion/paquetes): arma sus tarjetas sobre estas definiciones
//    y deriva la confirmacion de downgrade de las capacidades que se pierden.
//
// PUNTO DE EXTENSION STRIPE: el PR de medios de pago NO reemplaza este modulo; lo LEE. Los webhooks
// de Stripe (checkout confirmado, cancelacion, impago) escribiran el MISMO subscriptions.plan/status
// y profiles.tier que hoy escribe el activador gratuito, usando estas mismas definiciones. Cuando eso
// ocurra, aqui solo se agregan los price ids de Stripe por plan; el gating y el catalogo no se tocan.
//
// Sin dependencias: puro y testeable, importable igual desde node (backend/worker) y browser (consola).

/** Identificador comercial del plan: la lista CERRADA que acepta la seleccion self-service. */
export type PlanId = 'free' | 'pro' | 'business';

/**
 * Tier de profiles.tier (CHECK de V007). Es el eje que los gates leen server-side; cada plan mapea a
 * exactamente un tier. Business se corresponde con 'autonomous' (el tope actual de la escala).
 */
export type PlanTier = 'free' | 'pro' | 'autonomous';

/** Capacidades que un plan desbloquea. Los gates derivan el acceso de AQUI, no de literales sueltos. */
export interface PlanCapabilities {
  /** Ejecucion autonoma: recetas, tareas programadas, triggers y el modo autonomo del Configurador. */
  autonomy: boolean;
  /** Uso embebido del widget (fuera del Playground). */
  embedded: boolean;
  /** Asientos incluidos. null = asientos para el equipo, se acuerdan con ventas (Business). */
  seats: number | null;
}

export interface PlanDefinition {
  id: PlanId;
  /** Tier de profiles.tier que este plan escribe al seleccionarse (y del que los gates derivan acceso). */
  tier: PlanTier;
  /**
   * Limite de ejecuciones mensuales del plan. null = ampliado/a medida (Business). DECLARATIVO por
   * ahora: la cuota vigente de un usuario sigue viviendo en usage_counters y su sincronizacion con el
   * plan llega con el PR de cobros (Stripe), que leera este mismo valor.
   */
  runsPerMonth: number | null;
  capabilities: PlanCapabilities;
}

/**
 * Los tres planes, ordenados de MENOR a MAYOR: el indice en este array es el rango del plan (lo usa
 * la deteccion de downgrade). Free sin autonomia; Pro y Business con autonomia y embebido.
 */
export const PLAN_DEFINITIONS: readonly PlanDefinition[] = [
  {
    id: 'free',
    tier: 'free',
    runsPerMonth: 10,
    capabilities: { autonomy: false, embedded: false, seats: 1 },
  },
  {
    id: 'pro',
    tier: 'pro',
    runsPerMonth: 1000,
    capabilities: { autonomy: true, embedded: true, seats: 1 },
  },
  {
    id: 'business',
    tier: 'autonomous',
    runsPerMonth: null,
    capabilities: { autonomy: true, embedded: true, seats: null },
  },
];

/** Lista cerrada de ids, en el mismo orden de rango. Para validar planId (zod enum / isPlanId). */
export const PLAN_IDS = ['free', 'pro', 'business'] as const;

/** True solo si value es uno de los 3 planes. Cero confianza en el planId como texto libre. */
export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

/** Definicion de un plan por id. */
export function getPlanById(id: PlanId): PlanDefinition {
  const plan = PLAN_DEFINITIONS.find((p) => p.id === id);
  if (!plan) {
    // Inalcanzable con un PlanId bien tipado; protege contra un cast forzado en runtime.
    throw new Error(`plan desconocido: ${id}`);
  }
  return plan;
}

/**
 * Definicion del plan que corresponde a un tier de profiles.tier (mapeo 1:1). Acepta string crudo
 * (lo que viene de la base) y devuelve null si el tier no mapea a ningun plan (fail-closed).
 */
export function getPlanByTier(tier: string | null | undefined): PlanDefinition | null {
  return PLAN_DEFINITIONS.find((p) => p.tier === tier) ?? null;
}

/**
 * Deriva del modulo central si un tier tiene ejecucion AUTONOMA (recetas, tareas, triggers, modo
 * autonomo del Configurador). Es lo que consultan los gates en lugar de comparar un tier literal.
 * Fail-closed: false para null/undefined (perfil inexistente) o un tier que no mapea a ningun plan.
 */
export function tierAllowsAutonomy(tier: string | null | undefined): boolean {
  return getPlanByTier(tier)?.capabilities.autonomy === true;
}

/** Rango de un plan (indice en la escala free < pro < business). -1 si el tier no mapea. */
function rankOfTier(tier: string | null | undefined): number {
  return PLAN_DEFINITIONS.findIndex((p) => p.tier === tier);
}

/**
 * True si pasar del tier actual al plan destino es un DOWNGRADE (el catalogo pide confirmacion solo
 * en ese caso). Con un tier actual desconocido devuelve false: sin base de comparacion no se
 * interpone una confirmacion.
 */
export function isDowngrade(currentTier: string | null | undefined, target: PlanId): boolean {
  const currentRank = rankOfTier(currentTier);
  if (currentRank === -1) return false;
  return PLAN_DEFINITIONS.findIndex((p) => p.id === target) < currentRank;
}

/**
 * Capacidades booleanas que se PIERDEN al pasar del tier actual al plan destino (para el copy de la
 * confirmacion de downgrade). Devuelve las claves en orden estable; vacio si no se pierde ninguna.
 */
export function lostCapabilities(
  currentTier: string | null | undefined,
  target: PlanId,
): Array<'autonomy' | 'embedded'> {
  const current = getPlanByTier(currentTier);
  if (!current) return [];
  const next = getPlanById(target);
  const lost: Array<'autonomy' | 'embedded'> = [];
  if (current.capabilities.autonomy && !next.capabilities.autonomy) lost.push('autonomy');
  if (current.capabilities.embedded && !next.capabilities.embedded) lost.push('embedded');
  return lost;
}
