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
import i18n from '../i18n';
import type { ProfileTier } from './registration';

export type { PlanId };
// Re-export de las capacidades centrales que consumen las paginas (gates y catalogo): un solo import
// de superficie para la consola, sin duplicar la definicion.
export { isDowngrade, tierAllowsAutonomy };

/**
 * Feature de un plan como termino corto + texto, el mismo patron termino+definicion de los gates.
 * `term` y `text` guardan CLAVES de traduccion (i18n); la tarjeta resuelve `t(...)` en el render.
 */
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
  /**
   * Linea mono bajo el precio con el limite de ejecuciones del plan (derivada de runsPerMonth).
   * Guarda la CLAVE de traduccion; la tarjeta la resuelve con t(...) interpolando runsPerMonth.
   */
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
 * a medida (Business). Devuelve la CLAVE i18n; la tarjeta interpola runsPerMonth al renderizar.
 */
function runsLineFor(runsPerMonth: number | null): string {
  if (runsPerMonth === null) return 'planes.tarjeta.runsEquipos';
  return 'planes.tarjeta.runsPorMes';
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
      { term: 'planes.features.termAgentes', text: 'planes.features.unAgente' },
      { term: 'planes.features.termModoUso', text: 'planes.features.soloPlayground' },
      { term: 'planes.features.termAutonomia', text: 'planes.features.sinAutonomia' },
      { term: 'planes.features.termSoporte', text: 'planes.features.soporteComunidad' },
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
      { term: 'planes.features.termAgentes', text: 'planes.features.agentesIlimitados' },
      { term: 'planes.features.termModoUso', text: 'planes.features.playgroundYWidget' },
      { term: 'planes.features.termAutonomia', text: 'planes.features.autonomiaCompleta' },
      { term: 'planes.features.termSoporte', text: 'planes.features.soporteCorreo' },
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
      { term: 'planes.features.termAgentes', text: 'planes.features.agentesIlimitados' },
      { term: 'planes.features.termModoUso', text: 'planes.features.todoLoDePro' },
      { term: 'planes.features.termEquipo', text: 'planes.features.asientosEquipo' },
      { term: 'planes.features.termSoporte', text: 'planes.features.soporteAcompanamiento' },
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
    autonomy: 'planes.perdidas.autonomia',
    embedded: 'planes.perdidas.embebido',
  };
  return lostCapabilities(currentTier, target).map((capability) => i18n.t(labels[capability]));
}

/**
 * Traduce el error de seleccionar un plan (POST /v1/subscription/select) a un mensaje claro y no
 * destructivo para el catalogo. Duck-typed sobre `status` (mismo criterio que
 * updateProfileNameErrorMessage) para no acoplar este modulo puro a ApiError.
 *
 * Los casos no mapeados NO se colapsan en un generico mudo: un 5xx incluye el status real y un fallo
 * sin respuesta (red/CORS) se distingue de un error del servidor. Sin esto, un 500, un 429 y un fetch
 * caido muestran el mismo texto y el incidente queda indiagnosticable desde la UI.
 */
export function selectPlanErrorMessage(err: unknown): string {
  const status =
    err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : null;
  switch (status) {
    case 400:
      return i18n.t('planes.errores.noReconocido');
    case 401:
      return i18n.t('planes.errores.sesionExpirada');
    case 404:
      return i18n.t('planes.errores.completaRegistro');
    case 429:
      return i18n.t('planes.errores.demasiadosIntentos');
    default:
      if (status !== null && status >= 500) {
        return i18n.t('planes.errores.servidor', { status });
      }
      if (status === null) {
        return i18n.t('planes.errores.conexion');
      }
      return i18n.t('planes.errores.generico');
  }
}
