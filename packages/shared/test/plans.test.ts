import { describe, it, expect } from 'vitest';
import {
  PLAN_DEFINITIONS,
  PLAN_IDS,
  getPlanById,
  getPlanByTier,
  isDowngrade,
  isPlanId,
  lostCapabilities,
  tierAllowsAutonomy,
} from '../src/plans/plans.js';

describe('modulo central de planes', () => {
  it('define exactamente los 3 planes, en orden de rango y con mapeo 1:1 a tiers', () => {
    expect(PLAN_DEFINITIONS.map((p) => p.id)).toEqual(['free', 'pro', 'business']);
    expect(PLAN_DEFINITIONS.map((p) => p.tier)).toEqual(['free', 'pro', 'autonomous']);
    expect([...PLAN_IDS]).toEqual(['free', 'pro', 'business']);
  });

  it('isPlanId acepta SOLO la lista cerrada (cero confianza en texto libre)', () => {
    expect(isPlanId('free')).toBe(true);
    expect(isPlanId('pro')).toBe(true);
    expect(isPlanId('business')).toBe(true);
    // 'autonomous' es un TIER, no un plan: no debe colarse como planId.
    expect(isPlanId('autonomous')).toBe(false);
    expect(isPlanId('enterprise')).toBe(false);
    expect(isPlanId('')).toBe(false);
    expect(isPlanId(null)).toBe(false);
    expect(isPlanId(42)).toBe(false);
  });

  it('getPlanById y getPlanByTier resuelven la misma definicion', () => {
    expect(getPlanById('business').tier).toBe('autonomous');
    expect(getPlanByTier('autonomous')?.id).toBe('business');
    expect(getPlanByTier('pro')?.id).toBe('pro');
    // Fail-closed: tiers desconocidos o ausentes no mapean a nada.
    expect(getPlanByTier('vip')).toBeNull();
    expect(getPlanByTier(null)).toBeNull();
    expect(getPlanByTier(undefined)).toBeNull();
  });

  it('la autonomia la tienen Pro y Business; Free no (y fail-closed sin tier)', () => {
    expect(tierAllowsAutonomy('free')).toBe(false);
    expect(tierAllowsAutonomy('pro')).toBe(true);
    expect(tierAllowsAutonomy('autonomous')).toBe(true);
    expect(tierAllowsAutonomy(null)).toBe(false);
    expect(tierAllowsAutonomy(undefined)).toBe(false);
    expect(tierAllowsAutonomy('otro')).toBe(false);
  });

  it('detecta downgrades por rango (y nunca con un tier actual desconocido)', () => {
    expect(isDowngrade('autonomous', 'pro')).toBe(true);
    expect(isDowngrade('autonomous', 'free')).toBe(true);
    expect(isDowngrade('pro', 'free')).toBe(true);
    // Upgrades y reeleccion del mismo plan no piden confirmacion.
    expect(isDowngrade('free', 'pro')).toBe(false);
    expect(isDowngrade('pro', 'business')).toBe(false);
    expect(isDowngrade('pro', 'pro')).toBe(false);
    // Sin base de comparacion, no se interpone confirmacion.
    expect(isDowngrade(null, 'free')).toBe(false);
    expect(isDowngrade('vip', 'free')).toBe(false);
  });

  it('lista las capacidades que se pierden en un downgrade (para el copy de confirmacion)', () => {
    expect(lostCapabilities('autonomous', 'free')).toEqual(['autonomy', 'embedded']);
    expect(lostCapabilities('pro', 'free')).toEqual(['autonomy', 'embedded']);
    // Business -> Pro conserva autonomia y embebido: nada que advertir por capacidades booleanas.
    expect(lostCapabilities('autonomous', 'pro')).toEqual([]);
    expect(lostCapabilities('free', 'pro')).toEqual([]);
    expect(lostCapabilities(null, 'free')).toEqual([]);
  });
});
