import { describe, expect, it } from 'vitest';
import { LAUNCH_NOTICE, PLANS } from '../src/lib/plans';

// El catalogo es la fuente de verdad de copys del frontend: estos tests fijan sus invariantes
// estructurales (los que la UI asume) y las reglas editoriales del producto (sin guiones largos
// ni exclamaciones en ningun texto visible).

describe('PLANS', () => {
  it('define los tres planes comerciales en orden ascendente', () => {
    expect(PLANS.map((plan) => plan.id)).toEqual(['free', 'pro', 'business']);
  });

  it('marca exactamente un plan recomendado (Pro)', () => {
    const recommended = PLANS.filter((plan) => plan.recommended);
    expect(recommended.map((plan) => plan.id)).toEqual(['pro']);
  });

  it('mapea cada plan a un tier de profiles.tier distinto (para marcar "Tu plan")', () => {
    const tiers = PLANS.map((plan) => plan.tier);
    expect(new Set(tiers).size).toBe(PLANS.length);
    for (const tier of tiers) {
      expect(['free', 'pro', 'autonomous']).toContain(tier);
    }
  });

  it('durante el lanzamiento todos los precios se muestran como Gratis', () => {
    for (const plan of PLANS) {
      expect(plan.price).toBe('Gratis');
      expect(plan.priceSuffix).toBe('/mes');
    }
  });

  it('no usa guiones largos ni exclamaciones en ningun copy', () => {
    const allCopy = JSON.stringify(PLANS) + LAUNCH_NOTICE;
    expect(allCopy).not.toMatch(/[–—]/);
    expect(allCopy).not.toMatch(/[!¡]/);
  });
});
