import { describe, it, expect, vi } from 'vitest';
import type { Sql } from '@ledesma-platform/shared';
import { GrabacionesRepository } from '../src/grabaciones/grabaciones-repository.js';

/**
 * GRABACIONES (V036): acceso a datos. Mismo estilo de mock del tagged template `sql` que
 * recetas-web-repository.test.ts.
 *
 * Lo que estos tests protegen: que los pasos NUNCA vuelvan crudos del jsonb (una grabacion manipulada
 * no puede convertirse en una receta ejecutable), que toda query vaya acotada por owner, y que
 * descartar deje la fila SIN pasos (el camino del invariante de la contrasena).
 */

const PASOS_VALIDOS = [
  {
    idx: 0,
    accion: 'click',
    estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'redactar' }],
    valor: null,
    teclas: null,
    ruta: null,
  },
];

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gra-1',
    owner_id: 'user-1',
    connection_id: 'con-1',
    dominio: 'app.ejemplo.com',
    descripcion: 'enviar el reporte semanal',
    estado: 'terminada',
    motivo: null,
    pasos: PASOS_VALIDOS,
    vista_en_vivo_url: null,
    creada_en: '2026-07-24T00:00:00.000Z',
    actualizada_en: '2026-07-24T00:05:00.000Z',
    ...overrides,
  };
}

function makeSql(result: unknown[]): Sql {
  const fn = vi.fn(async () => result) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

function sqlText(sql: Sql, indice = 0): string {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  return (calls[indice]?.[0] ?? []).join('<param>');
}

function sqlValues(sql: Sql, indice = 0): unknown[] {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  const [, ...values] = (calls[indice] ?? [[]]) as [readonly string[], ...unknown[]];
  return values;
}

describe('obtener', () => {
  it('devuelve la grabacion en camelCase con los pasos ya validados y acotada por owner', async () => {
    const sql = makeSql([makeRow()]);
    const grabacion = await new GrabacionesRepository(sql).obtener('gra-1', 'user-1');
    expect(grabacion).toMatchObject({
      id: 'gra-1',
      connectionId: 'con-1',
      dominio: 'app.ejemplo.com',
      estado: 'terminada',
      motivo: null,
    });
    expect(grabacion?.pasos).toHaveLength(1);
    expect(sqlText(sql)).toContain('owner_id =');
    expect(sqlValues(sql)).toEqual(['gra-1', 'user-1']);
  });

  it('unos pasos que NO validan dejan la lista vacia (nunca los crudos del jsonb)', async () => {
    const sql = makeSql([makeRow({ pasos: [{ idx: 0, accion: 'ejecutar_lo_que_sea' }] })]);
    const grabacion = await new GrabacionesRepository(sql).obtener('gra-1', 'user-1');
    expect(grabacion?.pasos).toEqual([]);
  });

  it('un estado o un motivo desconocidos no se propagan tal cual', async () => {
    const sql = makeSql([makeRow({ estado: 'lo_que_sea', motivo: 'inventado' })]);
    const grabacion = await new GrabacionesRepository(sql).obtener('gra-1', 'user-1');
    expect(grabacion?.estado).toBe('descartada');
    expect(grabacion?.motivo).toBeNull();
  });

  it('una grabacion ajena o inexistente devuelve null', async () => {
    const sql = makeSql([]);
    expect(await new GrabacionesRepository(sql).obtener('gra-1', 'user-2')).toBeNull();
  });
});

describe('terminar', () => {
  it('es una transicion CONDICIONADA a que siga grabando', async () => {
    const sql = makeSql([{ id: 'gra-1' }]);
    expect(await new GrabacionesRepository(sql).terminar('gra-1', 'user-1')).toBe(true);
    const texto = sqlText(sql);
    expect(texto).toContain("estado = 'terminada'");
    expect(texto).toContain("estado = 'grabando'");
    expect(texto).toContain('owner_id =');
  });

  it('devuelve false si la fila ya no estaba grabando (terminar dos veces no hace nada)', async () => {
    const sql = makeSql([]);
    expect(await new GrabacionesRepository(sql).terminar('gra-1', 'user-1')).toBe(false);
  });
});

describe('guardarPasos', () => {
  it('escribe los pasos, limpia la vista en vivo y solo sobre una grabacion terminada', async () => {
    const sql = makeSql([]);
    await new GrabacionesRepository(sql).guardarPasos('gra-1', 'user-1', []);
    const texto = sqlText(sql);
    expect(texto).toContain('vista_en_vivo_url = null');
    expect(texto).toContain("estado = 'terminada'");
    expect(texto).toContain('owner_id =');
  });
});

describe('descartar', () => {
  it('deja la fila sin pasos, sin vista en vivo y con el motivo (el camino de la contrasena)', async () => {
    const sql = makeSql([]);
    await new GrabacionesRepository(sql).descartar('gra-1', 'user-1', 'contrasena');
    const texto = sqlText(sql);
    expect(texto).toContain("estado = 'descartada'");
    expect(texto).toContain("pasos = '[]'::jsonb");
    expect(texto).toContain('vista_en_vivo_url = null');
    expect(sqlValues(sql)).toEqual(['contrasena', 'gra-1', 'user-1']);
  });
});

describe('publicarVistaEnVivo y sigueGrabando', () => {
  it('publicar solo aplica mientras la grabacion sigue en curso', async () => {
    const sql = makeSql([]);
    await new GrabacionesRepository(sql).publicarVistaEnVivo('gra-1', 'user-1', 'https://vista');
    expect(sqlText(sql)).toContain("estado = 'grabando'");
  });

  it('sigueGrabando es true solo con el estado grabando', async () => {
    const repo = new GrabacionesRepository(makeSql([{ estado: 'grabando' }]));
    expect(await repo.sigueGrabando('gra-1', 'user-1')).toBe(true);
    const otro = new GrabacionesRepository(makeSql([{ estado: 'terminada' }]));
    expect(await otro.sigueGrabando('gra-1', 'user-1')).toBe(false);
    const ninguna = new GrabacionesRepository(makeSql([]));
    expect(await ninguna.sigueGrabando('gra-1', 'user-1')).toBe(false);
  });
});
