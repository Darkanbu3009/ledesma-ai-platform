import { describe, expect, it } from 'vitest';
import {
  estadoSitioLabel,
  haySitiosEnTransicion,
  inicialDeDominio,
  normalizarUrlDeSitio,
  sitioEnLoginParaDominio,
  type EstadoSitio,
  type SitioConectado,
} from '../src/lib/sitios';

function makeSitio(overrides: Partial<SitioConectado> = {}): SitioConectado {
  return {
    id: 's1',
    dominio: 'app.ejemplo.com',
    estado: 'activo',
    vistaEnVivoUrl: null,
    creadoEn: '2026-07-01T00:00:00.000Z',
    ultimoUsoEn: null,
    ...overrides,
  };
}

describe('estadoSitioLabel', () => {
  it('traduce los cuatro estados (es)', () => {
    const labels: Record<EstadoSitio, string> = {
      esperando_login: 'Esperando login',
      activo: 'Activo',
      caducado: 'Caducado',
      error: 'Error',
    };
    for (const [estado, label] of Object.entries(labels)) {
      expect(estadoSitioLabel(estado as EstadoSitio)).toBe(label);
    }
  });
});

describe('normalizarUrlDeSitio', () => {
  it('acepta una URL https completa tal cual', () => {
    expect(normalizarUrlDeSitio('https://app.ejemplo.com/login')).toBe('https://app.ejemplo.com/login');
  });

  it('acepta http (el backend y el worker tambien lo admiten)', () => {
    expect(normalizarUrlDeSitio('http://intranet.ejemplo.com')).toBe('http://intranet.ejemplo.com');
  });

  it('antepone https:// si el usuario pego el dominio pelado', () => {
    expect(normalizarUrlDeSitio('app.ejemplo.com/login')).toBe('https://app.ejemplo.com/login');
  });

  it('recorta espacios alrededor', () => {
    expect(normalizarUrlDeSitio('  app.ejemplo.com  ')).toBe('https://app.ejemplo.com');
  });

  it('rechaza vacio, basura y esquemas no http(s)', () => {
    expect(normalizarUrlDeSitio('')).toBeNull();
    expect(normalizarUrlDeSitio('   ')).toBeNull();
    expect(normalizarUrlDeSitio('javascript:alert(1)')).toBeNull();
    expect(normalizarUrlDeSitio('ftp://archivo.ejemplo.com')).toBeNull();
    expect(normalizarUrlDeSitio('no es una url')).toBeNull();
  });

  it('rechaza hosts sin punto (evita conectar "localhost" o palabras sueltas por accidente)', () => {
    expect(normalizarUrlDeSitio('localhost')).toBeNull();
    expect(normalizarUrlDeSitio('https://localhost')).toBeNull();
  });
});

describe('inicialDeDominio', () => {
  it('toma el primer caracter alfanumerico en mayuscula', () => {
    expect(inicialDeDominio('app.ejemplo.com')).toBe('A');
    expect(inicialDeDominio('9gag.com')).toBe('9');
  });

  it('cae a "?" si el dominio no tiene alfanumericos', () => {
    expect(inicialDeDominio('---')).toBe('?');
  });
});

describe('haySitiosEnTransicion', () => {
  it('true si alguna conexion esta esperando_login', () => {
    expect(
      haySitiosEnTransicion([makeSitio(), makeSitio({ id: 's2', estado: 'esperando_login' })]),
    ).toBe(true);
  });

  it('false si todo esta estable (activo/caducado/error) o la lista esta vacia', () => {
    expect(haySitiosEnTransicion([])).toBe(false);
    expect(
      haySitiosEnTransicion([
        makeSitio(),
        makeSitio({ id: 's2', estado: 'caducado' }),
        makeSitio({ id: 's3', estado: 'error' }),
      ]),
    ).toBe(false);
  });
});

describe('sitioEnLoginParaDominio', () => {
  it('encuentra la fila del dominio esperando login CON vista en vivo', () => {
    const enLogin = makeSitio({
      id: 's2',
      estado: 'esperando_login',
      vistaEnVivoUrl: 'https://live.proveedor.example/abc',
    });
    expect(sitioEnLoginParaDominio([makeSitio(), enLogin], 'app.ejemplo.com')).toEqual(enLogin);
  });

  it('null si la fila aun no tiene vista en vivo o esta en otro estado', () => {
    expect(
      sitioEnLoginParaDominio([makeSitio({ estado: 'esperando_login', vistaEnVivoUrl: null })], 'app.ejemplo.com'),
    ).toBeNull();
    expect(
      sitioEnLoginParaDominio([makeSitio({ estado: 'activo', vistaEnVivoUrl: null })], 'app.ejemplo.com'),
    ).toBeNull();
  });

  it('null si el dominio no coincide (otra conexion esperando login no abre este modal)', () => {
    const otra = makeSitio({
      dominio: 'otro.ejemplo.com',
      estado: 'esperando_login',
      vistaEnVivoUrl: 'https://live.proveedor.example/xyz',
    });
    expect(sitioEnLoginParaDominio([otra], 'app.ejemplo.com')).toBeNull();
  });
});
