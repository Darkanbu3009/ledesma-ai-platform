import { describe, it, expect } from 'vitest';
import type { PasoDeReceta } from '@ledesma-platform/shared';
import {
  aplicarPromociones,
  claveDeEstrategia,
  evaluarPromociones,
  ganadorasDeCorrida,
  MAX_REGISTROS_POR_PASO,
  parsearHistorialGanadoras,
  registrarGanadoras,
  type HistorialGanadoras,
} from '../src/promocion-estrategias.js';

/**
 * AUTO REPARACION DE RECETAS (V038), regla PURA de promocion: el caso medido en produccion es Gmail,
 * donde el id es dinamico por sesion (:u3, :q9), la primaria por atributo id falla en CADA corrida y
 * el elemento lo resuelve siempre el rol accesible. Estos tests fijan cuando se promueve ese fallback
 * a primaria y, sobre todo, cuando NO.
 */

function paso(idx: number): PasoDeReceta {
  return {
    idx,
    accion: 'click',
    dominio: null,
    estrategias: [
      { tipo: 'atributo', atributo: 'id', valor: ':u3' },
      { tipo: 'rol', rol: 'button', nombre: 'Redactar' },
      { tipo: 'texto', texto: 'Redactar' },
      { tipo: 'xpath', xpath: '/html[1]/body[1]/div[3]' },
    ],
    valor: null,
    teclas: null,
    ruta: null,
    esperaMs: null,
  };
}

function registro(indice: number, clave: string, jobId = 'job-x') {
  return { indice, clave, jobId, en: '2026-07-27T00:00:00.000Z' };
}

describe('claveDeEstrategia (identidad estable, sin valores del sitio)', () => {
  it('distingue atributos por su nombre y jamas incluye el valor', () => {
    expect(claveDeEstrategia({ tipo: 'atributo', atributo: 'id', valor: ':u3' })).toBe('atributo:id');
    expect(
      claveDeEstrategia({ tipo: 'atributo', atributo: 'aria-label', valor: 'Redactar' }),
    ).toBe('atributo:aria-label');
    expect(claveDeEstrategia({ tipo: 'rol', rol: 'button', nombre: 'Redactar' })).toBe('rol');
    expect(claveDeEstrategia({ tipo: 'xpath', xpath: '/html[1]' })).toBe('xpath');
  });
});

describe('regla de promocion (las 4 decisiones fijadas)', () => {
  it('el MISMO fallback gana las ultimas 2 ejecuciones exitosas: PROMUEVE', () => {
    const historial: HistorialGanadoras = { '0': [registro(1, 'rol'), registro(1, 'rol')] };
    const promociones = evaluarPromociones(historial, [paso(0)]);
    expect(promociones).toHaveLength(1);
    expect(promociones[0]).toMatchObject({ pasoIdx: 0, clave: 'rol', indiceAnterior: 1 });
  });

  it('gana un fallback DISTINTO cada vez: NO promueve (el paso esta inestable)', () => {
    const historial: HistorialGanadoras = { '0': [registro(1, 'rol'), registro(2, 'texto')] };
    expect(evaluarPromociones(historial, [paso(0)])).toHaveLength(0);
  });

  it('la primaria gano en cualquiera de las ultimas 2: NO promueve', () => {
    const conPrimariaAlFinal: HistorialGanadoras = {
      '0': [registro(1, 'rol'), registro(0, 'atributo:id')],
    };
    expect(evaluarPromociones(conPrimariaAlFinal, [paso(0)])).toHaveLength(0);
    const conPrimariaAntes: HistorialGanadoras = {
      '0': [registro(0, 'atributo:id'), registro(1, 'rol')],
    };
    expect(evaluarPromociones(conPrimariaAntes, [paso(0)])).toHaveLength(0);
  });

  it('con UNA sola ejecucion registrada: NO promueve (una racha de 1 no es consistencia)', () => {
    const historial: HistorialGanadoras = { '0': [registro(1, 'rol')] };
    expect(evaluarPromociones(historial, [paso(0)])).toHaveLength(0);
  });

  it('solo cuentan las ULTIMAS 2: dos triunfos viejos del rol con una primaria reciente no promueven', () => {
    const historial: HistorialGanadoras = {
      '0': [registro(1, 'rol'), registro(1, 'rol'), registro(0, 'atributo:id')],
    };
    expect(evaluarPromociones(historial, [paso(0)])).toHaveLength(0);
  });

  it('la clave ganadora ya es la primaria actual (otra corrida la subio): NO duplica la promocion', () => {
    const promovido: PasoDeReceta = {
      ...paso(0),
      estrategias: [
        { tipo: 'rol', rol: 'button', nombre: 'Redactar' },
        { tipo: 'atributo', atributo: 'id', valor: ':q9' },
      ],
    };
    const historial: HistorialGanadoras = { '0': [registro(1, 'rol'), registro(1, 'rol')] };
    expect(evaluarPromociones(historial, [promovido])).toHaveLength(0);
  });

  it('la clave ganadora ya no existe entre las estrategias del paso: NO promueve nada', () => {
    const sinRol: PasoDeReceta = {
      ...paso(0),
      estrategias: [
        { tipo: 'atributo', atributo: 'id', valor: ':q9' },
        { tipo: 'xpath', xpath: '/html[1]' },
      ],
    };
    const historial: HistorialGanadoras = { '0': [registro(1, 'rol'), registro(1, 'rol')] };
    expect(evaluarPromociones(historial, [sinRol])).toHaveLength(0);
  });
});

describe('aplicarPromociones (reordenamiento del shape)', () => {
  it('la ganadora pasa al indice 0, la antigua primaria queda en la posicion siguiente y NADA se borra', () => {
    const original = paso(0);
    const [reordenado] = aplicarPromociones(
      [original],
      evaluarPromociones({ '0': [registro(1, 'rol'), registro(1, 'rol')] }, [original]),
    );
    expect(reordenado?.estrategias.map(claveDeEstrategia)).toEqual([
      'rol',
      'atributo:id',
      'texto',
      'xpath',
    ]);
    expect(reordenado?.estrategias).toHaveLength(original.estrategias.length);
    // El resto del paso no cambia, y el original no se muta.
    expect(reordenado).toMatchObject({ idx: 0, accion: 'click' });
    expect(original.estrategias[0]?.tipo).toBe('atributo');
  });

  it('promover desde el fondo tambien deja a la antigua primaria segunda', () => {
    const original = paso(0);
    const [reordenado] = aplicarPromociones(
      [original],
      evaluarPromociones({ '0': [registro(3, 'xpath'), registro(3, 'xpath')] }, [original]),
    );
    expect(reordenado?.estrategias.map(claveDeEstrategia)).toEqual([
      'xpath',
      'atributo:id',
      'rol',
      'texto',
    ]);
  });

  it('los pasos sin promocion quedan intactos', () => {
    const pasos = [paso(0), paso(1)];
    const resultado = aplicarPromociones(
      pasos,
      evaluarPromociones({ '1': [registro(1, 'rol'), registro(1, 'rol')] }, pasos),
    );
    expect(resultado[0]).toBe(pasos[0]);
    expect(resultado[1]?.estrategias[0]?.tipo).toBe('rol');
  });
});

describe('registro de ganadoras (historial acotado)', () => {
  it('agrega al final y retiene solo las ultimas N por paso', () => {
    let historial: HistorialGanadoras = {};
    for (let corrida = 0; corrida < MAX_REGISTROS_POR_PASO + 3; corrida++) {
      historial = registrarGanadoras(
        historial,
        [{ paso: 0, indice: 1, clave: 'rol' }],
        `job-${corrida}`,
        '2026-07-27T00:00:00.000Z',
      );
    }
    expect(historial['0']).toHaveLength(MAX_REGISTROS_POR_PASO);
    expect(historial['0']?.at(-1)?.jobId).toBe(`job-${MAX_REGISTROS_POR_PASO + 2}`);
  });

  it('no muta el historial de entrada y conserva los pasos que esta corrida no registro', () => {
    const previo: HistorialGanadoras = { '3': [registro(2, 'texto')] };
    const nuevo = registrarGanadoras(
      previo,
      [{ paso: 0, indice: 0, clave: 'atributo:id' }],
      'job-9',
      '2026-07-27T00:00:00.000Z',
    );
    expect(previo['0']).toBeUndefined();
    expect(nuevo['3']).toEqual(previo['3']);
    expect(nuevo['0']?.[0]).toMatchObject({ indice: 0, clave: 'atributo:id' });
  });
});

describe('ganadorasDeCorrida (resolucion de claves contra los pasos ejecutados)', () => {
  it('resuelve la clave por indice y descarta indices que no existen o pasos que no estan', () => {
    const ganadoras = ganadorasDeCorrida(
      [paso(0)],
      [
        { paso: 0, indice: 1 },
        { paso: 0, indice: 9 },
        { paso: 7, indice: 0 },
      ],
    );
    expect(ganadoras).toEqual([{ paso: 0, indice: 1, clave: 'rol' }]);
  });
});

describe('parsearHistorialGanadoras (tolerante: telemetria, no procedimiento)', () => {
  it('lee lo bien formado, descarta la basura sin invalidar el resto y acota por paso', () => {
    const crudo = {
      '0': [registro(1, 'rol'), { indice: -1, clave: 'rol', jobId: 'j', en: 'x' }, 'basura'],
      '1': 'no soy una lista',
      'paso-raro': [registro(0, 'rol')],
      '2': Array.from({ length: 10 }, (_, i) => registro(i, 'texto', `job-${i}`)),
    };
    const historial = parsearHistorialGanadoras(crudo);
    expect(historial['0']).toHaveLength(1);
    expect(historial['1']).toBeUndefined();
    expect(historial['paso-raro']).toBeUndefined();
    expect(historial['2']).toHaveLength(MAX_REGISTROS_POR_PASO);
  });

  it('cualquier cosa que no sea un objeto devuelve historial vacio', () => {
    expect(parsearHistorialGanadoras(null)).toEqual({});
    expect(parsearHistorialGanadoras([registro(0, 'rol')])).toEqual({});
    expect(parsearHistorialGanadoras('{}')).toEqual({});
  });
});
