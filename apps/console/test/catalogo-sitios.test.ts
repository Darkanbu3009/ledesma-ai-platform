import { describe, expect, it } from 'vitest';
import {
  CATALOGO_SITIOS,
  ORDEN_CATEGORIAS,
  agruparPorCategoria,
  filtrarCatalogo,
} from '../src/lib/catalogo-sitios';

describe('CATALOGO_SITIOS (invariantes de los datos curados)', () => {
  it('ids unicos', () => {
    const ids = CATALOGO_SITIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('dominio = host de urlLogin en minusculas (mismo criterio que dominioDeUrl del backend)', () => {
    for (const sitio of CATALOGO_SITIOS) {
      expect(sitio.dominio, sitio.id).toBe(new URL(sitio.urlLogin).hostname.toLowerCase());
    }
  });

  it('todas las urlLogin son https', () => {
    for (const sitio of CATALOGO_SITIOS) {
      expect(new URL(sitio.urlLogin).protocol, sitio.id).toBe('https:');
    }
  });

  it('gobierno_mx siempre advierte datos_sensibles y social siempre automatizacion_restringida', () => {
    for (const sitio of CATALOGO_SITIOS) {
      if (sitio.categoria === 'gobierno_mx') {
        expect(sitio.advertencia, sitio.id).toBe('datos_sensibles');
      }
      if (sitio.categoria === 'social') {
        expect(sitio.advertencia, sitio.id).toBe('automatizacion_restringida');
      }
    }
  });
});

describe('filtrarCatalogo', () => {
  it('vacio devuelve el catalogo completo', () => {
    expect(filtrarCatalogo('')).toHaveLength(CATALOGO_SITIOS.length);
    expect(filtrarCatalogo('   ')).toHaveLength(CATALOGO_SITIOS.length);
  });

  it('coincide por nombre sin distinguir mayusculas', () => {
    expect(filtrarCatalogo('GMAIL').map((s) => s.id)).toContain('gmail');
    expect(filtrarCatalogo('mercado').map((s) => s.id)).toContain('mercado_libre');
  });

  it('coincide por dominio', () => {
    expect(filtrarCatalogo('notion.so').map((s) => s.id)).toEqual(['notion']);
  });

  it('sin coincidencias devuelve [] (URL libre: el panel se oculta)', () => {
    expect(filtrarCatalogo('https://intranet.miempresa.com/login')).toEqual([]);
  });
});

describe('agruparPorCategoria', () => {
  it('respeta ORDEN_CATEGORIAS y omite grupos vacios', () => {
    const grupos = agruparPorCategoria(CATALOGO_SITIOS);
    expect(grupos.map((g) => g.categoria)).toEqual([...ORDEN_CATEGORIAS]);
    const soloUno = agruparPorCategoria(filtrarCatalogo('notion.so'));
    expect(soloUno.map((g) => g.categoria)).toEqual(['productividad']);
  });
});
