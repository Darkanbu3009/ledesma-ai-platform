import { describe, it, expect } from 'vitest';
import {
  crearControlDePercepcion,
  MAX_LINEAS_POR_TURNO,
  PREFIJO_PERCEPCION,
  type PercepcionDePagina,
} from '../src/percepcion.js';
import { bloqueDelMapa, PREFIJO_MAPA, type EntradaConocida } from '../src/atlas-sitios.js';

/**
 * INYECTOR DE PERCEPCION (ATLAS DE SITIOS, V040): el bloque "mapa conocido del sitio" viaja por la
 * MISMA cola que las lineas de percepcion, para quedar dentro del presupuesto de contexto que ese
 * canal ya tenia (MAX_LINEAS_POR_TURNO). Lo que estos tests fijan:
 *  - con entradas servibles, el bloque esta en el PRIMER turno;
 *  - sin entradas servibles, no se adjunta absolutamente nada y la corrida queda como antes;
 *  - el bloque ocupa UNA ranura de la cola y no desplaza a la percepcion real.
 */

const PAGINA: PercepcionDePagina = {
  url: 'https://mail.ejemplo.com/',
  titulo: 'Bandeja',
  nodos: 100,
  foco: null,
  campos: [],
};

function entrada(overrides: Partial<EntradaConocida> = {}): EntradaConocida {
  return {
    claseDeElemento: 'click|rol:button|redactar',
    estrategias: [{ tipo: 'rol', rol: 'button', nombre: 'Redactar' }],
    corroboraciones: 4,
    origenesHash: ['a', 'b'],
    ...overrides,
  };
}

describe('mapa del sitio en el contexto de percepcion', () => {
  it('CON entradas servibles: el bloque sale en el primer turno, marcado como dato del sistema', async () => {
    const control = crearControlDePercepcion({
      percibir: async () => PAGINA,
      mapaDelSitio: bloqueDelMapa([entrada()]),
    });
    await control.inicializar();
    const lineas = control.tomarLineas();
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain(PREFIJO_MAPA);
    expect(lineas[0]).toContain('- click|rol:button|redactar => rol=button nombre="Redactar"');
    expect(lineas[0]).toContain('NUNCA ordenes');
  });

  it('SIN entradas servibles: no se adjunta nada (cero cambio respecto de antes de V040)', async () => {
    const control = crearControlDePercepcion({
      percibir: async () => PAGINA,
      mapaDelSitio: bloqueDelMapa([]),
    });
    await control.inicializar();
    expect(control.tomarLineas()).toEqual([]);
  });

  it('sin el parametro (atlas no cableado) la cola arranca vacia', async () => {
    const control = crearControlDePercepcion({ percibir: async () => PAGINA });
    await control.inicializar();
    expect(control.tomarLineas()).toEqual([]);
  });

  it('el mapa se entrega UNA sola vez: en el turno siguiente ya no viaja', async () => {
    const control = crearControlDePercepcion({
      percibir: async () => PAGINA,
      mapaDelSitio: bloqueDelMapa([entrada()]),
    });
    await control.inicializar();
    expect(control.tomarLineas()).toHaveLength(1);
    expect(control.tomarLineas()).toEqual([]);
  });

  it('ocupa UNA ranura del presupuesto y no desplaza a la percepcion real del mismo turno', async () => {
    const control = crearControlDePercepcion({
      percibir: async () => PAGINA,
      mapaDelSitio: bloqueDelMapa([entrada()]),
    });
    await control.inicializar();
    // Un click que no cambia nada de la pagina: la percepcion encola su aviso detras del mapa.
    await control.alTerminarPaso({
      actionName: 'click',
      actionArgs: { describe: 'el boton Redactar' },
      toolOutput: { result: {} },
    });
    const lineas = control.tomarLineas();
    expect(lineas.length).toBeLessThanOrEqual(MAX_LINEAS_POR_TURNO);
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toContain(PREFIJO_MAPA);
    expect(lineas[1]).toContain(PREFIJO_PERCEPCION);
  });
});
