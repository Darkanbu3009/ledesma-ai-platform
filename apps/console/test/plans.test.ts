import { describe, expect, it } from 'vitest';
import { LAUNCH_NOTICE, PLANS } from '../src/lib/plans';
import { TIER_ORDER } from '../src/lib/admin';

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

  it('cubre exactamente la escala de tiers (TIER_ORDER), en orden y sin repetir', () => {
    // Si el backend agrega o renombra un tier, este toEqual truena y obliga a decidir su plan
    // comercial (en vez de dejar usuarios sin marca "Tu plan" en el catalogo).
    expect(PLANS.map((plan) => plan.tier)).toEqual(TIER_ORDER);
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
