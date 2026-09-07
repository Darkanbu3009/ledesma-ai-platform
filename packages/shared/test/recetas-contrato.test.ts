import { describe, it, expect } from 'vitest';
import {
  dominiosDePasos,
  esAtributoDeIdentidad,
  esAtributoEstable,
  esNombreDeIdentidad,
  esValorDeIdentidad,
  marcadoresDeParametros,
  MAX_ESPERA_MS,
  MAX_PASOS_RECETA,
  MAX_TEXTO_DE_IDENTIDAD,
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

  it('el parser RESPETA el orden persistido (una promocion de la auto reparacion sobrevive a la lectura)', () => {
    const pasos = parsearPasosDeReceta([
      paso({
        estrategias: [
          { tipo: 'rol', rol: 'button', nombre: 'Enviar' },
          { tipo: 'atributo', atributo: 'id', valor: ':u3' },
          { tipo: 'xpath', xpath: '/html[1]' },
        ],
      }),
    ]);
    expect(pasos?.[0]?.estrategias.map((e) => e.tipo)).toEqual(['rol', 'atributo', 'xpath']);
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

describe('que datos necesita una receta (marcadoresDeParametros)', () => {
  function pasoEscribir(idx: number, valor: unknown): unknown {
    return {
      idx,
      accion: 'escribir',
      estrategias: [{ tipo: 'atributo', atributo: 'name', valor: `campo-${idx}` }],
      valor,
      teclas: null,
      ruta: null,
      esperaMs: null,
    };
  }

  it('lista los marcadores DISTINTOS de sus pasos de escritura, en orden fijo', () => {
    const pasos = parsearPasosDeReceta([
      pasoEscribir(0, { tipo: 'parametro', parametro: 'cuerpo' }),
      pasoEscribir(1, { tipo: 'parametro', parametro: 'destinatario' }),
      pasoEscribir(2, { tipo: 'parametro', parametro: 'destinatario' }),
      pasoEscribir(3, { tipo: 'literal', texto: 'Bandeja de entrada' }),
    ]);
    expect(pasos).not.toBeNull();
    // Orden fijo (el de MARCADORES), no el de aparicion: dos lecturas dan siempre la misma lista.
    expect(marcadoresDeParametros(pasos ?? [])).toEqual(['destinatario', 'cuerpo']);
  });

  it('una receta que solo teclea texto fijo no necesita ningun dato', () => {
    const pasos = parsearPasosDeReceta([pasoEscribir(0, { tipo: 'literal', texto: 'x' })]);
    expect(marcadoresDeParametros(pasos ?? [])).toEqual([]);
  });
});

/**
 * LAS DOS REGLAS DE ADMISION DE IDENTIDAD. Son la unica defensa GENERICA (sin una sola regla por
 * sitio) contra que un DATO DE LA TAREA o el CONTENIDO de una pagina acabe dentro de la clase de un
 * elemento, que es lo que viaja a las dos tablas GLOBALES del aprendizaje colectivo.
 *
 * Los casos de abajo son los MEDIDOS sobre fixtures en la investigacion que motivo el fix: el importe
 * de la factura de un tercero dentro de un texto visible, el numero del dia de un calendario como
 * nombre del control, y el identificador de sesion dentro de un data-*.
 */
describe('esNombreDeIdentidad: lo que se lee de la pagina', () => {
  it('admite el rotulo de un control', () => {
    for (const nombre of [
      'Enviar',
      'Redactar',
      'Eliminar ambiente',
      'Enviar (Ctrl-Intro)',
      'Destinatarios en Para',
      'Cuerpo del mensaje',
    ]) {
      expect(esNombreDeIdentidad(nombre)).toBe(true);
    }
  });

  it('rechaza lo que lleva un dato dentro, aunque el rotulo sea real', () => {
    // El numero del dia de un calendario: el nombre ES el valor que la tarea eligio.
    expect(esNombreDeIdentidad('12')).toBe(false);
    // Un importe de un tercero, suelto o dentro del texto concatenado de una fila.
    expect(esNombreDeIdentidad('$ 12.500,00')).toBe(false);
    expect(esNombreDeIdentidad('Distribuidora Andina SRL $ 12.500,00 Vencida')).toBe(false);
    // Un contador: cambia entre sesiones, asi que no puede sostener una identidad estable (R4).
    expect(esNombreDeIdentidad('Bandeja de entrada (3)')).toBe(false);
    // Sin una sola letra no hay rotulo, hay valor.
    expect(esNombreDeIdentidad('(2)')).toBe(false);
  });

  it('rechaza lo que no cabe: recortarlo guardaria un FRAGMENTO de contenido de pagina', () => {
    expect(esNombreDeIdentidad('a'.repeat(MAX_TEXTO_DE_IDENTIDAD))).toBe(true);
    expect(esNombreDeIdentidad('a'.repeat(MAX_TEXTO_DE_IDENTIDAD + 1))).toBe(false);
  });
});

describe('esValorDeIdentidad: lo que escribio quien programo el sitio', () => {
  it('admite un gancho con forma de nombre, con o sin un numero corto', () => {
    for (const valor of ['eliminar-ambiente-produccion', 'checkout-pay', 'fila-2', 'btn_del_env']) {
      expect(esValorDeIdentidad(valor)).toBe(true);
    }
  });

  it('rechaza por su FORMA todo lo que es un identificador, un importe o una fecha', () => {
    for (const valor of [
      's_01JQ8Z9WQ2K3',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'a3f9c2b18e4d5670',
      '0ahUKEwi1',
      '12500.00',
      '2026-09-12',
      '4471',
    ]) {
      expect(esValorDeIdentidad(valor)).toBe(false);
    }
  });

  it('rechaza la barra: es el separador de la clase y partiria su eje en dos', () => {
    expect(esValorDeIdentidad('a|b')).toBe(false);
  });
});

describe('esAtributoDeIdentidad: cada atributo con la regla de su fuente', () => {
  it('aria-label se juzga como texto de pagina (es el nombre accesible)', () => {
    expect(esAtributoDeIdentidad('aria-label', 'Eliminar ambiente')).toBe(true);
    expect(esAtributoDeIdentidad('aria-label', 'Eliminar factura 4471')).toBe(false);
  });

  it('data-* se juzga como gancho: un numero corto no lo descalifica', () => {
    expect(esAtributoDeIdentidad('data-testid', 'fila-2')).toBe(true);
    expect(esAtributoDeIdentidad('data-testid', 'fila-4471')).toBe(false);
  });
});

describe('desempate: el segundo eje viaja con la estrategia y no se puede degradar', () => {
  it('una estrategia SIN el campo sale exactamente igual que siempre', () => {
    expect(parsearEstrategia({ tipo: 'rol', rol: 'button', nombre: 'Enviar' })).toEqual({
      tipo: 'rol',
      rol: 'button',
      nombre: 'Enviar',
    });
  });

  it('conserva el desempate admisible y el null (homonimo sin nada que lo distinga)', () => {
    expect(
      parsearEstrategia({
        tipo: 'rol',
        rol: 'button',
        nombre: 'Eliminar ambiente',
        desempate: { atributo: 'data-testid', valor: 'eliminar-produccion' },
      }),
    ).toEqual({
      tipo: 'rol',
      rol: 'button',
      nombre: 'Eliminar ambiente',
      desempate: { atributo: 'data-testid', valor: 'eliminar-produccion' },
    });
    expect(
      parsearEstrategia({ tipo: 'rol', rol: 'button', nombre: 'Eliminar', desempate: null }),
    ).toEqual({ tipo: 'rol', rol: 'button', nombre: 'Eliminar', desempate: null });
  });

  it('un desempate mal formado RECHAZA la estrategia y no se degrada a "sin desempate"', () => {
    // Degradarlo volveria a fusionar la identidad de dos controles distintos, que es el defecto.
    for (const desempate of [
      { atributo: 'data-testid' },
      { atributo: 'onclick', valor: 'x' },
      { atributo: 'data-testid', valor: 'fila-4471' },
      'data-testid=x',
    ]) {
      expect(
        parsearEstrategia({ tipo: 'rol', rol: 'button', nombre: 'Eliminar', desempate }),
      ).toBeNull();
    }
  });
});

describe('desempate: solo un data-*, y por que no valen los otros atributos estables', () => {
  it('id y name quedan fuera: llevan identificadores por sesion o por registro', () => {
    for (const atributo of ['id', 'name']) {
      expect(
        parsearEstrategia({
          tipo: 'rol',
          rol: 'button',
          nombre: 'Eliminar',
          desempate: { atributo, valor: 'eliminar-produccion' },
        }),
      ).toBeNull();
    }
  });

  it('aria-label tampoco: de ahi sale el nombre, asi que no puede distinguir dos homonimos', () => {
    expect(
      parsearEstrategia({
        tipo: 'rol',
        rol: 'button',
        nombre: 'Eliminar',
        desempate: { atributo: 'aria-label', valor: 'Eliminar produccion' },
      }),
    ).toBeNull();
  });
});
