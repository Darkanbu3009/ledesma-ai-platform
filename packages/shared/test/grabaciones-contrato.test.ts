import { describe, it, expect } from 'vitest';
import {
  MAX_PASOS_GRABACION,
  esMotivoDescarte,
  parsearMarcadosDeVariables,
  parsearPasosGrabados,
} from '../src/grabaciones/contrato.js';

/**
 * CONTRATO de las GRABACIONES: entre que una grabacion se captura y que se convierte en receta hay una
 * fila de base de datos, asi que los pasos se validan campo a campo al leerlos. El rechazo es TOTAL a
 * proposito: promover una grabacion a la que se le saltaron pasos ensenaria una tarea distinta.
 */

const NAVEGAR = { idx: 0, accion: 'navegar', estrategias: [], valor: null, teclas: null, ruta: '/inicio' };
const CLICK = {
  idx: 1,
  accion: 'click',
  estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'redactar' }],
  valor: null,
  teclas: null,
  ruta: null,
};
const ESCRIBIR = {
  idx: 2,
  accion: 'escribir',
  estrategias: [{ tipo: 'rol', rol: 'textbox', nombre: 'Para' }],
  valor: 'ana@ejemplo.com',
  teclas: null,
  ruta: null,
};

describe('parsearPasosGrabados', () => {
  it('acepta una grabacion completa y ordena las estrategias por el orden del contrato de recetas', () => {
    const pasos = parsearPasosGrabados([
      NAVEGAR,
      CLICK,
      ESCRIBIR,
      {
        idx: 3,
        accion: 'teclas',
        estrategias: [],
        valor: null,
        teclas: 'Enter',
        ruta: null,
      },
    ]);
    expect(pasos).not.toBeNull();
    expect(pasos?.map((p) => p.accion)).toEqual(['navegar', 'click', 'escribir', 'teclas']);
    expect(pasos?.[2]?.valor).toBe('ana@ejemplo.com');
  });

  it('una lista vacia es valida (una grabacion recien abierta todavia no capturo nada)', () => {
    expect(parsearPasosGrabados([])).toEqual([]);
  });

  it('rechaza la grabacion ENTERA si un solo paso no valida', () => {
    expect(parsearPasosGrabados([NAVEGAR, { ...CLICK, estrategias: [] }])).toBeNull();
    expect(parsearPasosGrabados([NAVEGAR, { ...ESCRIBIR, idx: 1, valor: '' }])).toBeNull();
    expect(parsearPasosGrabados([{ ...NAVEGAR, accion: 'esperar' }])).toBeNull();
  });

  it('un paso de navegacion guarda una RUTA relativa, jamas una URL ni otro origen', () => {
    expect(parsearPasosGrabados([{ ...NAVEGAR, ruta: 'https://otro.com/x' }])).toBeNull();
    expect(parsearPasosGrabados([{ ...NAVEGAR, ruta: '//otro.com/x' }])).toBeNull();
    expect(parsearPasosGrabados([{ ...NAVEGAR, ruta: '/ok' }])?.[0]?.ruta).toBe('/ok');
  });

  it('los indices tienen que ser correlativos y sin huecos', () => {
    expect(parsearPasosGrabados([{ ...NAVEGAR, idx: 1 }])).toBeNull();
    expect(parsearPasosGrabados([NAVEGAR, { ...CLICK, idx: 5 }])).toBeNull();
  });

  it('rechaza una combinacion de teclas que no sea del patron cerrado', () => {
    const teclas = (valor: unknown) => [
      { idx: 0, accion: 'teclas', estrategias: [], valor: null, teclas: valor, ruta: null },
    ];
    expect(parsearPasosGrabados(teclas('Enter'))?.[0]?.teclas).toBe('Enter');
    expect(parsearPasosGrabados(teclas('Enter; alert(1)'))).toBeNull();
    expect(parsearPasosGrabados(teclas(''))).toBeNull();
  });

  it('rechaza una grabacion mas larga que el tope', () => {
    const largo = Array.from({ length: MAX_PASOS_GRABACION + 1 }, (_v, idx) => ({ ...CLICK, idx }));
    expect(parsearPasosGrabados(largo)).toBeNull();
  });

  it('rechaza cualquier cosa que no sea un arreglo', () => {
    expect(parsearPasosGrabados(null)).toBeNull();
    expect(parsearPasosGrabados({ pasos: [] })).toBeNull();
    expect(parsearPasosGrabados('[]')).toBeNull();
  });
});

describe('parsearMarcadosDeVariables', () => {
  it('acepta indices con marcadores del vocabulario de las recetas', () => {
    expect(
      parsearMarcadosDeVariables([
        { idx: 2, marcador: 'destinatario' },
        { idx: 4, marcador: 'asunto' },
      ]),
    ).toEqual([
      { idx: 2, marcador: 'destinatario' },
      { idx: 4, marcador: 'asunto' },
    ]);
  });

  it('rechaza un marcador inventado (si no, la sustitucion buscaria un dato que no existe)', () => {
    expect(parsearMarcadosDeVariables([{ idx: 0, marcador: 'contrasena' }])).toBeNull();
    expect(parsearMarcadosDeVariables([{ idx: 0, marcador: 'password' }])).toBeNull();
  });

  it('rechaza indices repetidos (un paso no puede ser dos datos distintos)', () => {
    expect(
      parsearMarcadosDeVariables([
        { idx: 1, marcador: 'monto' },
        { idx: 1, marcador: 'cantidad' },
      ]),
    ).toBeNull();
  });

  it('rechaza indices que no son enteros no negativos', () => {
    expect(parsearMarcadosDeVariables([{ idx: -1, marcador: 'monto' }])).toBeNull();
    expect(parsearMarcadosDeVariables([{ idx: 1.5, marcador: 'monto' }])).toBeNull();
    expect(parsearMarcadosDeVariables('x')).toBeNull();
  });
});

describe('esMotivoDescarte', () => {
  it('reconoce los cinco motivos y nada mas', () => {
    for (const motivo of [
      'contrasena',
      'vencida',
      'demasiados_pasos',
      'no_repetible',
      'sitio_no_disponible',
    ]) {
      expect(esMotivoDescarte(motivo)).toBe(true);
    }
    expect(esMotivoDescarte('otro')).toBe(false);
    expect(esMotivoDescarte(null)).toBe(false);
  });
});
