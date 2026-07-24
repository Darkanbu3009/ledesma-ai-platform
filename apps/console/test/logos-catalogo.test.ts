import { describe, expect, it } from 'vitest';
import { CATALOGO_SITIOS } from '../src/lib/catalogo-sitios';
import {
  FONDO_PANEL_HEX,
  LOGOS_CATALOGO,
  TEXTO_INK_HEX,
  coloresFallback,
  inicialUsaTextoInk,
  ratioDeContraste,
  usaColorDeMarca,
} from '../src/lib/logos-catalogo';

describe('LOGOS_CATALOGO', () => {
  it('todo iconoSlug no nulo del catalogo tiene su logo empaquetado (nada de 404 visuales)', () => {
    for (const sitio of CATALOGO_SITIOS) {
      if (sitio.iconoSlug !== null) {
        expect(LOGOS_CATALOGO[sitio.iconoSlug], `${sitio.id} -> ${sitio.iconoSlug}`).toBeDefined();
      }
    }
  });

  it('cada logo trae un path SVG y un hex de 6 digitos', () => {
    for (const [slug, logo] of Object.entries(LOGOS_CATALOGO)) {
      expect(logo.path.length, slug).toBeGreaterThan(0);
      expect(logo.hex, slug).toMatch(/^[0-9A-F]{6}$/i);
    }
  });
});

describe('coloresFallback', () => {
  it('cada entrada apunta a un id real del catalogo SIN logo empaquetado y trae hex de 6 digitos', () => {
    for (const [id, hex] of Object.entries(coloresFallback)) {
      const sitio = CATALOGO_SITIOS.find((s) => s.id === id);
      expect(sitio, id).toBeDefined();
      // Con logo empaquetado el color jamas se pintaria: seria una entrada muerta.
      expect(sitio?.iconoSlug, id).toBeNull();
      expect(hex, id).toMatch(/^[0-9A-F]{6}$/i);
    }
  });

  it('la inicial elegida (ink o blanco) contrasta al menos 3:1 contra cada fondo', () => {
    for (const [id, hex] of Object.entries(coloresFallback)) {
      const texto = inicialUsaTextoInk(hex) ? TEXTO_INK_HEX : 'FFFFFF';
      expect(ratioDeContraste(hex, texto), id).toBeGreaterThanOrEqual(3);
    }
  });

  it('inicialUsaTextoInk: fondo claro (Mercado Libre) va en ink y oscuro (SAT) en blanco', () => {
    expect(inicialUsaTextoInk('FFE600')).toBe(true);
    expect(inicialUsaTextoInk('691C32')).toBe(false);
  });
});

describe('contraste contra el fondo del panel', () => {
  it('ratioDeContraste: blanco sobre blanco es 1 y negro sobre blanco es 21', () => {
    expect(ratioDeContraste('FFFFFF', FONDO_PANEL_HEX)).toBeCloseTo(1, 5);
    expect(ratioDeContraste('000000', FONDO_PANEL_HEX)).toBeCloseTo(21, 5);
  });

  it('usaColorDeMarca: los hex palidos caen a currentColor (menos de 3:1)', () => {
    expect(usaColorDeMarca('000000')).toBe(true);
    expect(usaColorDeMarca('FFFFFF')).toBe(false);
    // Supabase (3FCF8E) es un verde claro tipico que no llega a 3:1 sobre blanco.
    expect(usaColorDeMarca('3FCF8E')).toBe(false);
  });
});
