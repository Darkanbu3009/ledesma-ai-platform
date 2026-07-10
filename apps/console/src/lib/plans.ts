// Catalogo de planes para /configuracion/paquetes, construido SOBRE el modulo central de planes
// (@ledesma-platform/shared/plans): el id, el tier y las capacidades de cada plan salen de la MISMA
// definicion que consumen los gates del backend y el endpoint de seleccion. Aqui solo se agrega el
// copy de presentacion (nombre, precio, features de la tarjeta). Sin React ni red: puro y testeable.
//
// Se importa el SUBPATH ./plans (no el barrel raiz) a proposito, por dos motivos:
//  - El barrel arrastra modulos de servidor (jobs-repository y demas) que no deben entrar al bundle
//    del browser; por este subpath solo entra el modulo puro de planes.
//  - El export ./plans de shared apunta su condicion "import" a la FUENTE TS (src/plans/plans.ts),
//    que Vite/vitest transforman al vuelo: el build de la consola no depende de que dist/ de shared
//    este compilado (Vercel construye la consola aislada, sin correr el tsc de packages/shared,
//    y con el barrel dist-only Rolldown no resolvia el import). El typecheck usa los tipos de dist.
//
// NOTA DE LANZAMIENTO: todos los precios se muestran como "Gratis" mientras se habilitan los medios de
// pago (ver LAUNCH_NOTICE). Los limites de ejecuciones son placeholders de negocio; la cuota REAL que
// aplica el backend llega en usageCounter (GET /v1/me) y no se toca desde aqui.

import {
  getPlanById,
  isDowngrade,
  lostCapabilities,
  tierAllowsAutonomy,
  type PlanDefinition,
  type PlanId,
} from '@ledesma-platform/shared/plans';
import type { ProfileTier } from './registration';

export type { PlanId };
// Re-export de las capacidades centrales que consumen las paginas (gates y catalogo): un solo import
// de superficie para la consola, sin duplicar la definicion.
export { isDowngrade, tierAllowsAutonomy };

/** Feature de un plan como termino corto + texto, el mismo patron termino+definicion de los gates. */
export interface PlanFeature {
  term: string;
  text: string;
}

/** Definicion central del plan + el copy de presentacion de su tarjeta. */
export interface Plan extends PlanDefinition {
  /**
   * Tier de profiles.tier al que corresponde el plan (viene de la definicion central), para marcar
   * "Tu plan" y deshabilitar su CTA. Business se corresponde con 'autonomous'.
   */
  tier: ProfileTier;
  name: string;
  /** Numero grande de la tarjeta. Durante el lanzamiento, "Gratis" en todos los planes. */
  price: string;
  /** Sufijo gris junto al precio. */
  priceSuffix: string;
  /** Linea mono bajo el precio con el limite de ejecuciones del plan (derivada de runsPerMonth). */
  runsLine: string;
  /** Un solo plan recomendado: lleva borde firme y pill "Recomendado". */
  recommended: boolean;
  features: PlanFeature[];
}

/** Aviso global sobre el catalogo mientras no hay cobros reales. */
export const LAUNCH_NOTICE =
  'Durante el lanzamiento, todos los planes son gratuitos mientras habilitamos los medios de pago.';

/**
 * Linea de ejecuciones de la tarjeta, DERIVADA de runsPerMonth del modulo central (unica fuente del
 * numero): si el limite de un plan cambia alli, el catalogo lo refleja sin tocar copys. null = plan
 * a medida (Business).
 */
function runsLineFor(runsPerMonth: number | null): string {
  if (runsPerMonth === null) return 'Ejecuciones ampliadas para equipos';
  return `${runsPerMonth.toLocaleString('en-US')} ejecuciones al mes`;
}

export const PLANS: Plan[] = [
  {
    ...getPlanById('free'),
    name: 'Free',
    price: 'Gratis',
    priceSuffix: '/mes',
    runsLine: runsLineFor(getPlanById('free').runsPerMonth),
    recommended: false,
    features: [
      { term: 'Agentes', text: '1 agente' },
      { term: 'Modo de uso', text: 'Solo Playground, con tu API key' },
      { term: 'Autonomía', text: 'Sin recetas, tareas ni triggers' },
      { term: 'Soporte', text: 'Comunidad' },
    ],
  },
  {
    ...getPlanById('pro'),
    name: 'Pro',
    price: 'Gratis',
    priceSuffix: '/mes',
    runsLine: runsLineFor(getPlanById('pro').runsPerMonth),
    recommended: true,
    features: [
      { term: 'Agentes', text: 'Agentes ilimitados' },
      { term: 'Modo de uso', text: 'Playground y embebido con tu widget' },
      { term: 'Autonomía', text: 'Recetas, tareas, triggers y alertas de fallo' },
      { term: 'Soporte', text: 'Prioritario por correo' },
    ],
  },
  {
    ...getPlanById('business'),
    name: 'Business',
    price: 'Gratis',
    priceSuffix: '/mes',
    runsLine: runsLineFor(getPlanById('business').runsPerMonth),
    recommended: false,
    features: [
      { term: 'Agentes', text: 'Agentes ilimitados' },
      { term: 'Modo de uso', text: 'Todo lo de Pro' },
      { term: 'Equipo', text: 'Asientos para tu equipo' },
      { term: 'Soporte', text: 'Prioritario con acompañamiento' },
    ],
  },
];

/** Nombre comercial de un plan por id (para copys de confirmacion y avisos). */
export function planName(planId: PlanId): string {
  return PLANS.find((plan) => plan.id === planId)?.name ?? planId;
}

/**
 * Copy en espanol de lo que se PIERDE al bajar al plan destino, derivado de las capacidades del
 * modulo central (nunca hardcodeado por gate). Vacio si el downgrade no pierde capacidades booleanas.
 */
export function downgradeLossSummary(currentTier: ProfileTier, target: PlanId): string[] {
  const labels: Record<'autonomy' | 'embedded', string> = {
    autonomy: 'recetas, tareas programadas y triggers (autonomia)',
    embedded: 'el widget embebido fuera del Playground',
  };
  return lostCapabilities(currentTier, target).map((capability) => labels[capability]);
}

/**
 * Traduce el error de seleccionar un plan (POST /v1/subscription/select) a un mensaje claro y no
 * destructivo para el catalogo. Duck-typed sobre `status` (mismo criterio que
 * updateProfileNameErrorMessage) para no acoplar este modulo puro a ApiError.
 */
export function selectPlanErrorMessage(err: unknown): string {
  const status =
    err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : null;
  switch (status) {
    case 400:
      return 'No reconocimos ese plan. Recarga la pagina e intenta de nuevo.';
    case 401:
      return 'Tu sesión expiró. Vuelve a iniciar sesión.';
    case 404:
      return 'Completa tu registro antes de elegir un plan.';
    default:
      return 'No pudimos cambiar tu plan. Intenta de nuevo.';
  }
}
