import { describe, it, expect } from 'vitest';
import {
  extraerCorreos,
  extraerMontos,
  extraerParametrosDeclarados,
  normalizarMonto,
  normalizarTexto,
} from '../src/parametros-objetivo.js';

/**
 * EXTRACCION DE PARAMETROS DECLARADOS (CAMBIO 2). Todo es regla y expresion regular: estos tests son
 * la especificacion ejecutable de que se considera "declarado" y, sobre todo, de que NO se adivina.
 */

describe('normalizarTexto', () => {
  it('minusculas, sin acentos, sin espacios extremos ni dobles', () => {
    expect(normalizarTexto('  José   PÉREZ  ')).toBe('jose perez');
  });

  it('la enie tambien se descompone (mismo criterio a ambos lados de la comparacion)', () => {
    // Se aplica la MISMA normalizacion al objetivo y al valor leido del sitio, asi que "Compañía"
    // escrito con enie coincide con "Compania" escrito sin ella: tolerar esa diferencia es correcto.
    expect(normalizarTexto('Compañía')).toBe(normalizarTexto('Compania'));
  });
});

describe('extraerCorreos', () => {
  it('saca los correos, en minusculas y sin repetir', () => {
    expect(extraerCorreos('manda a Juan@Ejemplo.com y a ana@ejemplo.com, cc juan@ejemplo.com')).toEqual([
      'juan@ejemplo.com',
      'ana@ejemplo.com',
    ]);
  });

  it('un texto sin correos no inventa ninguno', () => {
    expect(extraerCorreos('envia el resumen al equipo de ventas')).toEqual([]);
  });
});

describe('normalizarMonto', () => {
  it('limpia simbolos y separadores de miles', () => {
    expect(normalizarMonto('$2,400')).toBe(2400);
    expect(normalizarMonto('2.400')).toBe(2400);
    expect(normalizarMonto('1 000')).toBe(1000);
  });

  it('el ultimo separador es decimal solo con 1 o 2 digitos detras', () => {
    expect(normalizarMonto('2.400,50')).toBe(2400.5);
    expect(normalizarMonto('2,400.50')).toBe(2400.5);
    expect(normalizarMonto('1,5')).toBe(1.5);
  });

  it('lo que no queda como numero devuelve null (jamas se adivina)', () => {
    expect(normalizarMonto('mucho dinero')).toBeNull();
    expect(normalizarMonto('')).toBeNull();
  });
});

describe('extraerMontos', () => {
  it('detecta la moneda antes y despues del numero', () => {
    expect(extraerMontos('paga $2,400 hoy')[0]).toMatchObject({ valor: 2400, moneda: 'MXN' });
    expect(extraerMontos('paga 2400 MXN hoy')[0]).toMatchObject({ valor: 2400, moneda: 'MXN' });
    expect(extraerMontos('transfiere USD 30')[0]).toMatchObject({ valor: 30, moneda: 'USD' });
    expect(extraerMontos('cuesta 30 dolares')[0]).toMatchObject({ valor: 30, moneda: 'USD' });
  });

  it('un numero SIN moneda no es un monto (una fecha o un asiento no son dinero)', () => {
    expect(extraerMontos('compra el vuelo del 12 de agosto, asiento 14')).toEqual([]);
  });
});

describe('extraerParametrosDeclarados', () => {
  it('destinatario, monto, producto y cantidad declarados', () => {
    const p = extraerParametrosDeclarados(
      'envia a juan@ejemplo.com el pago de $2,400 MXN por 3 unidades del "Plan Basico"',
    );
    expect(p.destinatarios).toEqual(['juan@ejemplo.com']);
    expect(p.monto).toMatchObject({ valor: 2400, moneda: 'MXN' });
    expect(p.producto).toBe('Plan Basico');
    expect(p.cantidad).toBe(3);
  });

  it('varios destinatarios se conservan todos (un envio puede tener varios)', () => {
    const p = extraerParametrosDeclarados('manda el reporte a ana@x.com y a beto@x.com');
    expect(p.destinatarios).toEqual(['ana@x.com', 'beto@x.com']);
  });

  it('lo NO declarado queda vacio: nunca se adivina un dato que el usuario no dijo', () => {
    const p = extraerParametrosDeclarados('envia el correo de bienvenida al nuevo cliente');
    expect(p.destinatarios).toEqual([]);
    expect(p.monto).toBeNull();
    expect(p.producto).toBeNull();
    expect(p.cantidad).toBeNull();
  });

  it('DOS montos distintos son ambiguos: el monto queda NO declarado', () => {
    const p = extraerParametrosDeclarados('paga los $100 MXN de envio y los $2,400 MXN del producto');
    expect(p.monto).toBeNull();
  });

  it('el mismo monto repetido no es ambiguo', () => {
    const p = extraerParametrosDeclarados('paga $2,400 MXN, son 2400 MXN exactos');
    expect(p.monto).toMatchObject({ valor: 2400 });
  });

  it('DOS productos entrecomillados distintos son ambiguos: producto NO declarado', () => {
    const p = extraerParametrosDeclarados('compra "Plan Basico" o "Plan Pro"');
    expect(p.producto).toBeNull();
  });

  it('la cantidad exige una palabra que la nombre: un numero suelto no cuenta', () => {
    expect(extraerParametrosDeclarados('compra el vuelo del 12 de agosto').cantidad).toBeNull();
    expect(extraerParametrosDeclarados('compra cantidad: 2 del catalogo').cantidad).toBe(2);
  });

  it('los digitos de un monto no se confunden con una cantidad', () => {
    const p = extraerParametrosDeclarados('paga $2,400 MXN por 3 piezas');
    expect(p.cantidad).toBe(3);
    expect(p.monto).toMatchObject({ valor: 2400 });
  });
});
