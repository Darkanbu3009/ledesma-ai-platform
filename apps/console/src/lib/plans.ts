// Catalogo ESTATICO de planes para /configuracion/paquetes. UNICA fuente de verdad en el frontend de
// nombres, precios y copys de features: el PR de medios de pago (Stripe) reemplaza aqui los precios y
// limites reales sin tocar la UI del catalogo. Sin React ni red: puro y testeable, igual que admin.ts.
//
// NOTA DE LANZAMIENTO: todos los precios se muestran como "Gratis" mientras se habilitan los medios de
// pago (ver LAUNCH_NOTICE). Los limites de ejecuciones son placeholders de negocio; la cuota REAL que
// aplica el backend llega en usageCounter (GET /v1/me) y no se toca desde aqui.

import type { ProfileTier } from './registration';

/** Identificador comercial del plan (lo que recibe onSelectPlan en el PR de contratacion). */
export type PlanId = 'free' | 'pro' | 'business';

/** Feature de un plan como termino corto + texto, el mismo patron termino+definicion de los gates. */
export interface PlanFeature {
  term: string;
  text: string;
}

export interface Plan {
  id: PlanId;
  /**
   * Tier de profiles.tier al que corresponde el plan, para marcar "Tu plan" y deshabilitar su CTA.
   * Business se corresponde con 'autonomous' (el tope actual de la escala); si el backend renombra
   * tiers, este mapeo se ajusta en un solo lugar.
   */
  tier: ProfileTier;
  name: string;
  /** Numero grande de la tarjeta. Durante el lanzamiento, "Gratis" en todos los planes. */
  price: string;
  /** Sufijo gris junto al precio. */
  priceSuffix: string;
  /** Linea mono bajo el precio con el limite de ejecuciones del plan. */
  runsLine: string;
  /** Un solo plan recomendado: lleva borde firme y pill "Recomendado". */
  recommended: boolean;
  features: PlanFeature[];
}

/** Aviso global sobre el catalogo mientras no hay cobros reales. */
export const LAUNCH_NOTICE =
  'Durante el lanzamiento, todos los planes son gratuitos mientras habilitamos los medios de pago.';

export const PLANS: Plan[] = [
  {
    id: 'free',
    tier: 'free',
    name: 'Free',
    price: 'Gratis',
    priceSuffix: '/mes',
    runsLine: '10 ejecuciones al mes',
    recommended: false,
    features: [
      { term: 'Agentes', text: '1 agente' },
      { term: 'Modo de uso', text: 'Solo Playground, con tu API key' },
      { term: 'Autonomía', text: 'Sin recetas, tareas ni triggers' },
      { term: 'Soporte', text: 'Comunidad' },
    ],
  },
  {
    id: 'pro',
    tier: 'pro',
    name: 'Pro',
    price: 'Gratis',
    priceSuffix: '/mes',
    runsLine: '1,000 ejecuciones al mes',
    recommended: true,
    features: [
      { term: 'Agentes', text: 'Agentes ilimitados' },
      { term: 'Modo de uso', text: 'Playground y embebido con tu widget' },
      { term: 'Autonomía', text: 'Recetas, tareas, triggers y alertas de fallo' },
      { term: 'Soporte', text: 'Prioritario por correo' },
    ],
  },
  {
    id: 'business',
    tier: 'autonomous',
    name: 'Business',
    price: 'Gratis',
    priceSuffix: '/mes',
    runsLine: 'Ejecuciones ampliadas para equipos',
    recommended: false,
    features: [
      { term: 'Agentes', text: 'Agentes ilimitados' },
      { term: 'Modo de uso', text: 'Todo lo de Pro' },
      { term: 'Equipo', text: 'Asientos para tu equipo' },
      { term: 'Soporte', text: 'Prioritario con acompañamiento' },
    ],
  },
];
