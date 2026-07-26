import { describe, it, expect } from 'vitest';
import {
  dominiosDePasos,
  esAtributoEstable,
  MAX_ESPERA_MS,
  MAX_PASOS_RECETA,
  ordenarEstrategias,
  parsearEstrategia,
  parsearPasosDeReceta,
  parsearRuta,
  tienePasoDeVerificacion,
  type EstrategiaLocalizacion,
  type PasoDeReceta,
} from '../src/recetas/contrato.js';

/**
 * CONTRATO de los pasos de una RECETA DE TAREA WEB (V035). Entre que una receta se escribe y que se
 * ejecuta hay una fila de base de datos, asi que el parser es una superficie de SEGURIDAD: estos
 * tests son la lista de lo que una receta MANIPULADA no puede conseguir.
 *
 * Ojo con el nombre: nada de esto toca la tabla `recipes` de V013 (cadenas de instrucciones de texto
 * para un agente conversacional). Son dos cosas distintas.
 */

function paso(overrides: Partial<PasoDeReceta> = {}): unknown {
  return {
    idx: 0,
    accion: 'click',
    estrategias: [{ tipo: 'xpath', xpath: '/html[1]/body[1]/button[1]' }],
    valor: null,
    teclas: null,
    ruta: null,
    esperaMs: null,
    ...overrides,
  };
}

describe('parsearPasosDeReceta (rechazo TOTAL ante lo desconocido)', () => {
  it('acepta una receta bien formada', () => {
    expect(parsearPasosDeReceta([paso()])).toHaveLength(1);
  });

  it('rechaza lo que no es un arreglo, lo vacio y lo que excede el tope', () => {
    expect(parsearPasosDeReceta(null)).toBeNull();
    expect(parsearPasosDeReceta({ pasos: [] })).toBeNull();
    expect(parsearPasosDeReceta([])).toBeNull();
    expect(parsearPasosDeReceta(Array.from({ length: MAX_PASOS_RECETA + 1 }, () => paso()))).toBeNull();
  });

  it('UN paso invalido descarta la receta ENTERA (jamas se ejecuta a medias)', () => {
    expect(parsearPasosDeReceta([paso(), { idx: 1, accion: 'lo_que_sea' }])).toBeNull();
  });

  it('rechaza los indices con huecos o desordenados (el orden es el flujo)', () => {
    expect(parsearPasosDeReceta([paso({ idx: 0 }), paso({ idx: 5 })])).toBeNull();
    expect(parsearPasosDeReceta([paso({ idx: 1 }), paso({ idx: 0 })])).toBeNull();
  });

  it('un click o una escritura SIN estrategias no es re-ejecutable: se rechaza', () => {
    expect(parsearPasosDeReceta([paso({ estrategias: [] })])).toBeNull();
    expect(
      parsearPasosDeReceta([
        paso({ accion: 'escribir', estrategias: [], valor: { tipo: 'literal', texto: 'x' } }),
      ]),
    ).toBeNull();
  });

  it('una escritura sin valor se rechaza (no se teclea algo indefinido)', () => {
    expect(parsearPasosDeReceta([paso({ accion: 'escribir', valor: null })])).toBeNull();
  });

  it('acepta un marcador de parametro y rechaza uno inventado', () => {
    expect(
      parsearPasosDeReceta([paso({ accion: 'escribir', valor: { tipo: 'parametro', parametro: 'monto' } })]),
    ).toHaveLength(1);
    expect(
      parsearPasosDeReceta([
        paso({ accion: 'escribir', valor: { tipo: 'parametro', parametro: 'contrasena' as never } }),
      ]),
    ).toBeNull();
  });

  it('una espera fuera de rango se rechaza (una receta no cuelga la tarea)', () => {
    expect(parsearPasosDeReceta([paso({ accion: 'esperar', estrategias: [], esperaMs: 500 })])).toHaveLength(1);
    expect(
      parsearPasosDeReceta([paso({ accion: 'esperar', estrategias: [], esperaMs: MAX_ESPERA_MS + 1 })]),
    ).toBeNull();
    expect(parsearPasosDeReceta([paso({ accion: 'esperar', estrategias: [], esperaMs: 0 })])).toBeNull();
  });

  it('solo admite combinaciones de teclas reconocibles', () => {
    expect(parsearPasosDeReceta([paso({ accion: 'teclas', teclas: 'Control+a' })])).toHaveLength(1);
    expect(parsearPasosDeReceta([paso({ accion: 'teclas', teclas: 'rm -rf /' })])).toBeNull();
  });

  it('el paso `verificar` no admite datos: llega sin estrategias y sin valor', () => {
    const pasos = parsearPasosDeReceta([
      paso({ accion: 'verificar', estrategias: [{ tipo: 'texto', texto: 'ignorame' }] }),
    ]);
    expect(pasos?.[0]).toMatchObject({ accion: 'verificar', estrategias: [], valor: null });
    expect(tienePasoDeVerificacion(pasos ?? [])).toBe(true);
  });
});

describe('navegacion: una receta no puede sacar la sesion de su sitio', () => {
  it('acepta una ruta relativa y descarta las estrategias que trajera', () => {
    const pasos = parsearPasosDeReceta([paso({ accion: 'navegar', ruta: '/mail/compose' })]);
    expect(pasos?.[0]).toMatchObject({ accion: 'navegar', ruta: '/mail/compose', estrategias: [] });
  });

  it.each([
    ['https://otro-sitio.com/pago', 'una URL absoluta'],
    ['//otro-sitio.com/pago', 'un origen protocol-relative'],
    ['javascript:alert(1)', 'un esquema javascript'],
    ['data:text/html,<script>', 'un data URI'],
    ['mail/compose', 'una ruta sin barra inicial'],
    ['/mail /compose', 'una ruta con espacio'],
    ['/mail\ncompose', 'una ruta con salto de linea'],
  ])('rechaza %s (%s)', (ruta) => {
    expect(parsearRuta(ruta)).toBeNull();
    expect(parsearPasosDeReceta([paso({ accion: 'navegar', ruta })])).toBeNull();
  });

  it('acepta rutas normales con guiones, puntos y percent-encoding', () => {
    expect(parsearRuta('/mi-cuenta/facturas.html')).toBe('/mi-cuenta/facturas.html');
    expect(parsearRuta('/buscar%20algo')).toBe('/buscar%20algo');
  });
});

describe('estrategias de localizacion', () => {
  it('acepta las cuatro formas completas', () => {
    expect(parsearEstrategia({ tipo: 'atributo', atributo: 'id', valor: 'para' })).not.toBeNull();
    expect(parsearEstrategia({ tipo: 'rol', rol: 'button', nombre: 'Enviar' })).not.toBeNull();
    expect(parsearEstrategia({ tipo: 'texto', texto: 'Enviar' })).not.toBeNull();
    expect(parsearEstrategia({ tipo: 'xpath', xpath: '/html[1]/body[1]' })).not.toBeNull();
  });

  it('rechaza una forma incompleta o de tipo desconocido', () => {
    expect(parsearEstrategia({ tipo: 'rol', rol: 'button' })).toBeNull();
    expect(parsearEstrategia({ tipo: 'css', selector: 'div' })).toBeNull();
    expect(parsearEstrategia({ tipo: 'texto', texto: '   ' })).toBeNull();
  });

  it('solo admite ATRIBUTOS de la lista cerrada (o data-*)', () => {
    expect(esAtributoEstable('data-testid')).toBe(true);
    expect(esAtributoEstable('data-lo-que-sea')).toBe(true);
    expect(esAtributoEstable('id')).toBe(true);
    // Un atributo arbitrario podria ser un gancho de ejecucion o un dato personal.
    expect(esAtributoEstable('onclick')).toBe(false);
    expect(esAtributoEstable('value')).toBe(false);
    expect(parsearEstrategia({ tipo: 'atributo', atributo: 'onclick', valor: 'alert(1)' })).toBeNull();
  });

  it('un xpath que no es una ruta se rechaza (no es una expresion libre)', () => {
    expect(parsearEstrategia({ tipo: 'xpath', xpath: 'document.body' })).toBeNull();
    expect(parsearEstrategia({ tipo: 'xpath', xpath: '/html[1]/body[1]' })).not.toBeNull();
  });

  it('ordenarEstrategias respeta el orden de intento de D1', () => {
    const desordenadas: EstrategiaLocalizacion[] = [
      { tipo: 'xpath', xpath: '/html[1]' },
      { tipo: 'texto', texto: 'Enviar' },
      { tipo: 'atributo', atributo: 'id', valor: 'para' },
      { tipo: 'rol', rol: 'button', nombre: 'Enviar' },
    ];
    expect(ordenarEstrategias(desordenadas).map((e) => e.tipo)).toEqual([
      'atributo',
      'rol',
      'texto',
      'xpath',
    ]);
  });

  it('el parser DEVUELVE las estrategias ya ordenadas, sea cual sea el orden persistido', () => {
    const pasos = parsearPasosDeReceta([
      paso({
        estrategias: [
          { tipo: 'xpath', xpath: '/html[1]' },
          { tipo: 'atributo', atributo: 'id', valor: 'para' },
        ],
      }),
    ]);
    expect(pasos?.[0]?.estrategias.map((e) => e.tipo)).toEqual(['atributo', 'xpath']);
  });
});

/**
 * RECETAS QUE CRUZAN SITIOS: cada paso puede declarar a que sitio pertenece. Como el ejecutor
 * resuelve rutas y sesiones sobre ese valor, tiene que ser un DOMINIO y nada mas; cualquier otra
 * cosa invalida la receta entera (mismo criterio de rechazo total que el resto del contrato).
 */
describe('parsearPasosDeReceta y el sitio de cada paso', () => {
  function pasoCon(dominio: unknown): unknown {
    return {
      idx: 0,
      accion: 'click',
      dominio,
      estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'enviar' }],
      valor: null,
      teclas: null,
      ruta: null,
      esperaMs: null,
    };
  }

  it('un paso sin dominio (receta de un solo sitio) queda con null', () => {
    const pasos = parsearPasosDeReceta([pasoCon(undefined)]);
    expect(pasos?.[0]?.dominio).toBeNull();
    expect(parsearPasosDeReceta([pasoCon(null)])?.[0]?.dominio).toBeNull();
  });

  it('un dominio valido se normaliza a minusculas', () => {
    expect(parsearPasosDeReceta([pasoCon('Correo.Ejemplo.COM')])?.[0]?.dominio).toBe(
      'correo.ejemplo.com',
    );
  });

  it('cualquier cosa que no sea un hostname INVALIDA la receta entera', () => {
    for (const invalido of [
      'https://correo.ejemplo.com',
      'correo.ejemplo.com/inbox',
      'correo.ejemplo.com:8443',
      'javascript:alert(1)',
      '//correo.ejemplo.com',
      'localhost',
      'correo ejemplo com',
      42,
    ]) {
      expect(parsearPasosDeReceta([pasoCon(invalido)])).toBeNull();
    }
  });

  it('dominiosDePasos lista los sitios distintos que la receta nombra', () => {
    const pasos = parsearPasosDeReceta([
      pasoCon(null),
      { ...(pasoCon('correo.ejemplo.com') as Record<string, unknown>), idx: 1 },
      { ...(pasoCon('correo.ejemplo.com') as Record<string, unknown>), idx: 2 },
    ]);
    expect(pasos).not.toBeNull();
    expect(dominiosDePasos(pasos ?? [])).toEqual(['correo.ejemplo.com']);
  });
});
