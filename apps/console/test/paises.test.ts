import { describe, expect, it } from 'vitest';
import {
  CODIGOS_PAIS_ISO2,
  esCodigoPaisValido,
  nombreDePais,
  opcionesDePais,
} from '../src/lib/paises';

describe('CODIGOS_PAIS_ISO2 (lista completa ISO 3166-1 alpha-2)', () => {
  it('contiene los 249 codigos oficialmente asignados, todos ISO-2 en mayusculas y sin duplicados', () => {
    expect(CODIGOS_PAIS_ISO2).toHaveLength(249);
    expect(new Set(CODIGOS_PAIS_ISO2).size).toBe(249);
    for (const codigo of CODIGOS_PAIS_ISO2) {
      expect(codigo).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('sirve a CUALQUIER pais: presentes paises de todos los continentes, no solo Mexico', () => {
    for (const codigo of ['MX', 'AR', 'US', 'ES', 'DE', 'NG', 'JP', 'AU', 'BR', 'IN', 'UA', 'FJ']) {
      expect(CODIGOS_PAIS_ISO2).toContain(codigo);
    }
  });
});

describe('esCodigoPaisValido', () => {
  it('acepta codigos asignados en cualquier casing y rechaza lo demas', () => {
    expect(esCodigoPaisValido('AR')).toBe(true);
    expect(esCodigoPaisValido('mx')).toBe(true);
    expect(esCodigoPaisValido('XX')).toBe(false);
    expect(esCodigoPaisValido('ARG')).toBe(false);
    expect(esCodigoPaisValido('')).toBe(false);
  });
});

describe('nombreDePais', () => {
  it('localiza el nombre en el idioma pedido (ES y EN)', () => {
    expect(nombreDePais('DE', 'es')).toBe('Alemania');
    expect(nombreDePais('DE', 'en')).toBe('Germany');
    expect(nombreDePais('MX', 'es')).toBe('México');
    expect(nombreDePais('MX', 'en')).toBe('Mexico');
  });

  it('cae al propio codigo si el runtime no puede resolverlo (jamas rompe el selector)', () => {
    // Un tag de idioma invalido hace lanzar a Intl.DisplayNames: el helper lo captura.
    expect(nombreDePais('AR', 'no un idioma')).toBe('AR');
  });
});

describe('opcionesDePais', () => {
  it('devuelve las 249 opciones { codigo, nombre } ordenadas por nombre localizado', () => {
    const opciones = opcionesDePais('es');
    expect(opciones).toHaveLength(249);
    const nombres = opciones.map((opcion) => opcion.nombre);
    const collator = new Intl.Collator('es');
    expect(nombres).toEqual([...nombres].sort((a, b) => collator.compare(a, b)));
    expect(opciones.find((opcion) => opcion.codigo === 'AR')?.nombre).toBe('Argentina');
  });
});
