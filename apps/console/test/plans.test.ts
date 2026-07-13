import { describe, expect, it } from 'vitest';
import {
  LAUNCH_NOTICE,
  PLANS,
  downgradeLossSummary,
  planName,
  selectPlanErrorMessage,
  tierAllowsAutonomy,
} from '../src/lib/plans';
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

  it('deriva las capacidades del modulo central: autonomia en Pro y Business, no en Free', () => {
    // La misma funcion que consumen los gates de Recetas/Tareas/Triggers/Configurador.
    expect(tierAllowsAutonomy('free')).toBe(false);
    expect(tierAllowsAutonomy('pro')).toBe(true);
    expect(tierAllowsAutonomy('autonomous')).toBe(true);
    expect(tierAllowsAutonomy(undefined)).toBe(false);
  });
});

describe('downgradeLossSummary', () => {
  it('bajar de un plan con autonomia a Free advierte autonomia y embebido', () => {
    for (const from of ['pro', 'autonomous'] as const) {
      const losses = downgradeLossSummary(from, 'free');
      expect(losses.join(' ')).toContain('autonomia');
      expect(losses.join(' ')).toContain('embebido');
    }
  });

  it('bajar de Business a Pro no pierde capacidades booleanas', () => {
    expect(downgradeLossSummary('autonomous', 'pro')).toEqual([]);
  });

  it('los copys de perdida cumplen las reglas editoriales (sin guiones largos ni exclamaciones)', () => {
    const copy = downgradeLossSummary('autonomous', 'free').join(' ');
    expect(copy).not.toMatch(/[–—]/);
    expect(copy).not.toMatch(/[!¡]/);
  });
});

describe('planName y selectPlanErrorMessage', () => {
  it('planName devuelve el nombre comercial', () => {
    expect(planName('free')).toBe('Free');
    expect(planName('pro')).toBe('Pro');
    expect(planName('business')).toBe('Business');
  });

  it('mapea los errores del endpoint a mensajes claros y reintenta en el resto', () => {
    expect(selectPlanErrorMessage({ status: 400 })).toContain('No reconocimos ese plan');
    expect(selectPlanErrorMessage({ status: 401 })).toContain('sesión');
    expect(selectPlanErrorMessage({ status: 404 })).toContain('registro');
    expect(selectPlanErrorMessage({ status: 429 })).toContain('Demasiados intentos');
    // Otros 4xx no mapeados conservan el generico reintenable.
    expect(selectPlanErrorMessage({ status: 409 })).toBe('No pudimos cambiar tu plan. Intenta de nuevo.');
  });

  it('un 5xx expone el status real (diagnostico desde la UI) y un fallo de red se distingue del servidor', () => {
    expect(selectPlanErrorMessage({ status: 500 })).toContain('error 500 del servidor');
    expect(selectPlanErrorMessage({ status: 503 })).toContain('error 503 del servidor');
    // Sin respuesta HTTP (fetch caido, CORS): no es un error del servidor, se pide revisar la conexion.
    expect(selectPlanErrorMessage(new Error('x'))).toContain('conexión');
  });
});
