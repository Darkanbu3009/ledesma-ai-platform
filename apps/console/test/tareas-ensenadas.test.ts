import { describe, it, expect } from 'vitest';
import { agruparPorSitio, formatearFecha, type TareaEnsenada } from '../src/lib/tareas-ensenadas';

/** Derivaciones PURAS de la pantalla de tareas que ya sabe hacer (sin React y sin red). */

function makeTarea(overrides: Partial<TareaEnsenada> = {}): TareaEnsenada {
  return {
    id: 'tar-1',
    dominio: 'correo.ejemplo.com',
    descripcion: 'mandar el reporte',
    ensenadaEn: '2026-07-20T00:00:00.000Z',
    usos: 1,
    ultimoUsoEn: null,
    datosQueNecesita: ['destinatario'],
    ...overrides,
  };
}

describe('agruparPorSitio', () => {
  it('agrupa por sitio conservando el orden en que llegaron', () => {
    const grupos = agruparPorSitio([
      makeTarea({ id: 'a', dominio: 'correo.ejemplo.com' }),
      makeTarea({ id: 'b', dominio: 'tienda.ejemplo.com' }),
      makeTarea({ id: 'c', dominio: 'correo.ejemplo.com' }),
    ]);
    expect(grupos.map((g) => g.dominio)).toEqual(['correo.ejemplo.com', 'tienda.ejemplo.com']);
    expect(grupos[0]?.tareas.map((t) => t.id)).toEqual(['a', 'c']);
    expect(grupos[1]?.tareas.map((t) => t.id)).toEqual(['b']);
  });

  it('sin tareas no hay grupos', () => {
    expect(agruparPorSitio([])).toEqual([]);
  });
});

describe('formatearFecha', () => {
  it('devuelve una fecha corta legible', () => {
    expect(formatearFecha('2026-07-20T00:00:00.000Z')).toMatch(/2026/);
  });

  it('una fecha que no se puede leer se devuelve tal cual (nunca "Invalid Date")', () => {
    expect(formatearFecha('no soy una fecha')).toBe('no soy una fecha');
  });
});
