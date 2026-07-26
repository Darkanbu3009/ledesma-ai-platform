import { describe, expect, it } from 'vitest';
import {
  formatearDuracion,
  sitiosUsados,
  tituloDePaso,
  trayectoriaEstadoLabel,
  type PasoDeTrayectoria,
  type Trayectoria,
} from '../src/lib/trayectorias';

function makePaso(overrides: Partial<PasoDeTrayectoria> = {}): PasoDeTrayectoria {
  return {
    idx: 0,
    accion: { tipo: 'act', instruccion: 'click the search button', metodo: 'click', argumentos: [] },
    selector: 'xpath=//button',
    valorCensurado: null,
    url: 'https://en.wikipedia.org/',
    exito: true,
    ...overrides,
  };
}

describe('trayectoriaEstadoLabel', () => {
  it('traduce los tres estados', () => {
    expect(trayectoriaEstadoLabel('exitosa')).toBe('Exitosa');
    expect(trayectoriaEstadoLabel('fallida')).toBe('Fallida');
    expect(trayectoriaEstadoLabel('pausada')).toBe('Pausada');
  });
});

describe('formatearDuracion', () => {
  it('menos de un segundo: en ms', () => {
    expect(formatearDuracion(0)).toBe('0 ms');
    expect(formatearDuracion(850)).toBe('850 ms');
  });

  it('menos de un minuto: segundos con un decimal', () => {
    expect(formatearDuracion(1500)).toBe('1.5 s');
    expect(formatearDuracion(42_000)).toBe('42.0 s');
  });

  it('un minuto o mas: minutos y segundos', () => {
    expect(formatearDuracion(61_000)).toBe('1 min 1 s');
    expect(formatearDuracion(150_000)).toBe('2 min 30 s');
  });
});

describe('tituloDePaso', () => {
  it('prefiere la instruccion del modelo', () => {
    expect(tituloDePaso(makePaso())).toBe('click the search button');
  });

  it('sin instruccion cae al tipo de la tool', () => {
    const paso = makePaso({
      accion: { tipo: 'extract', instruccion: null, metodo: null, argumentos: [] },
    });
    expect(tituloDePaso(paso)).toBe('extract');
  });
});

describe('sitiosUsados', () => {
  function makeTrayectoria(dominio: string, id: string): Trayectoria {
    return {
      id,
      jobId: 'job-1',
      connectionId: `conn-${id}`,
      dominio,
      objetivo: 'x',
      estado: 'exitosa',
      iniciadaEn: '2026-07-20T00:00:00.000Z',
      terminadaEn: '2026-07-20T00:00:01.000Z',
      duracionMs: 1000,
      tokensIn: null,
      tokensOut: null,
      pasos: [],
    };
  }

  it('lista los sitios en el orden en que se usaron, sin repetir', () => {
    expect(
      sitiosUsados([
        makeTrayectoria('tienda.ejemplo.com', 'a'),
        makeTrayectoria('correo.ejemplo.com', 'b'),
        makeTrayectoria('tienda.ejemplo.com', 'c'),
      ]),
    ).toEqual(['tienda.ejemplo.com', 'correo.ejemplo.com']);
  });

  it('una tarea de un solo sitio devuelve ese sitio', () => {
    expect(sitiosUsados([makeTrayectoria('tienda.ejemplo.com', 'a')])).toEqual(['tienda.ejemplo.com']);
  });

  it('sin ejecuciones registradas no hay sitios que mostrar', () => {
    expect(sitiosUsados([])).toEqual([]);
  });
});
