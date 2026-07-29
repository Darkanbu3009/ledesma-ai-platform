import { describe, it, expect, vi } from 'vitest';
import type { Sql } from '@ledesma-platform/shared';
import {
  AprendizajeSitiosRepository,
  MAX_ENTRADAS_POR_DOMINIO,
} from '../src/aprendizaje-sitios/aprendizaje-sitios-repository.js';

/**
 * ATLAS DE SITIOS (V040): acceso a datos. Mismo estilo de mock del tagged template `sql` que
 * recetas-web-repository.test.ts.
 *
 * El punto CENTRAL de estos tests es doble:
 *  - ninguna query nombra owner_id ni ningun otro identificador rastreable: la unica dimension es el
 *    dominio, porque una entrada del atlas no tiene dueno;
 *  - el upsert cuenta ORIGENES DISTINTOS, no corridas: `corroboraciones` sube siempre y el hash de
 *    origen se agrega SOLO si es nuevo, dentro del mismo statement (sin leer antes, para que dos
 *    corridas simultaneas no puedan duplicar un origen).
 */

function makeSql(result: unknown[] = []): Sql {
  const fn = vi.fn(async () => result) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

function sqlText(sql: Sql, indice = 0): string {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock
    .calls;
  return (calls[indice]?.[0] ?? []).join('<param>').replace(/\s+/g, ' ');
}

function sqlValues(sql: Sql, indice = 0): unknown[] {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock
    .calls;
  const [, ...values] = (calls[indice] ?? [[]]) as [readonly string[], ...unknown[]];
  return values;
}

const FILA = {
  clase_de_elemento: 'click|rol:button|enviar',
  estrategias: [{ tipo: 'rol', rol: 'button', nombre: 'Enviar' }],
  corroboraciones: 4,
  origenes_hash: ['h1', 'h2'],
};

describe('listarPorDominio', () => {
  it('devuelve las entradas en camelCase, las mas corroboradas primero', async () => {
    const sql = makeSql([FILA]);
    const entradas = await new AprendizajeSitiosRepository(sql).listarPorDominio('mail.ejemplo.com');
    expect(entradas).toEqual([
      {
        claseDeElemento: 'click|rol:button|enviar',
        estrategias: [{ tipo: 'rol', rol: 'button', nombre: 'Enviar' }],
        corroboraciones: 4,
        origenesHash: ['h1', 'h2'],
      },
    ]);
    expect(sqlText(sql)).toContain('order by corroboraciones desc, actualizada_en desc');
  });

  it('acota SOLO por dominio y con tope: no existe la nocion de dueno en esta tabla', async () => {
    const sql = makeSql([FILA]);
    await new AprendizajeSitiosRepository(sql).listarPorDominio('mail.ejemplo.com');
    const texto = sqlText(sql);
    expect(texto).toContain('where dominio =');
    expect(texto).not.toContain('owner_id');
    expect(sqlValues(sql)).toEqual(['mail.ejemplo.com', MAX_ENTRADAS_POR_DOMINIO]);
  });

  it('NO devuelve la interpretacion: el umbral lo aplica el worker sobre origenes_hash', async () => {
    const sql = makeSql([FILA]);
    await new AprendizajeSitiosRepository(sql).listarPorDominio('mail.ejemplo.com');
    expect(sqlText(sql)).toContain('select clase_de_elemento, estrategias, corroboraciones, origenes_hash');
  });

  it('un dominio vacio no consulta nada', async () => {
    const sql = makeSql([FILA]);
    expect(await new AprendizajeSitiosRepository(sql).listarPorDominio('')).toEqual([]);
    expect(sql).not.toHaveBeenCalled();
  });
});

describe('registrarObservacion (upsert que cuenta origenes distintos)', () => {
  it('escribe SOLO dominio, clase, estrategias y el hash de origen', async () => {
    const sql = makeSql([]);
    await new AprendizajeSitiosRepository(sql).registrarObservacion({
      dominio: 'mail.ejemplo.com',
      claseDeElemento: 'click|rol:button|enviar',
      estrategias: [{ tipo: 'rol', rol: 'button', nombre: 'Enviar' }],
      origenHash: 'h1',
    });
    const texto = sqlText(sql);
    expect(texto).toContain(
      'insert into aprendizaje_sitios (dominio, clase_de_elemento, estrategias, corroboraciones, origenes_hash)',
    );
    expect(texto).not.toContain('owner_id');
    expect(sqlValues(sql)).toEqual([
      'mail.ejemplo.com',
      'click|rol:button|enviar',
      [{ tipo: 'rol', rol: 'button', nombre: 'Enviar' }],
      ['h1'],
    ]);
  });

  it('la estructura ya conocida sube corroboraciones y agrega el origen SOLO si es nuevo', async () => {
    const sql = makeSql([]);
    await new AprendizajeSitiosRepository(sql).registrarObservacion({
      dominio: 'mail.ejemplo.com',
      claseDeElemento: 'click|rol:button|enviar',
      estrategias: [],
      origenHash: 'h1',
    });
    const texto = sqlText(sql);
    expect(texto).toContain('on conflict (dominio, clase_de_elemento) do update set');
    expect(texto).toContain('corroboraciones = aprendizaje_sitios.corroboraciones + 1');
    // La pertenencia se decide DENTRO del statement: sin leer antes, no hay carrera posible.
    expect(texto).toContain('when aprendizaje_sitios.origenes_hash @> excluded.origenes_hash');
    expect(texto).toContain('then aprendizaje_sitios.origenes_hash');
    expect(texto).toContain('else aprendizaje_sitios.origenes_hash || excluded.origenes_hash');
  });

  it('primera_vez_en no se toca al actualizar: es cuando el dominio revelo esa estructura', async () => {
    const sql = makeSql([]);
    await new AprendizajeSitiosRepository(sql).registrarObservacion({
      dominio: 'mail.ejemplo.com',
      claseDeElemento: 'c',
      estrategias: [],
      origenHash: 'h1',
    });
    const texto = sqlText(sql);
    const actualizacion = texto.slice(texto.indexOf('do update set'));
    expect(actualizacion).not.toContain('primera_vez_en');
    expect(actualizacion).toContain('actualizada_en = now()');
  });
});

describe('purgarDominio (administracion)', () => {
  it('borra por dominio y devuelve cuantas entradas se fueron', async () => {
    const sql = makeSql([{ id: 'a' }, { id: 'b' }]);
    const purgadas = await new AprendizajeSitiosRepository(sql).purgarDominio('mail.ejemplo.com');
    expect(purgadas).toBe(2);
    expect(sqlText(sql)).toContain('delete from aprendizaje_sitios where dominio =');
    expect(sqlValues(sql)).toEqual(['mail.ejemplo.com']);
  });

  it('un dominio vacio no borra nada y no consulta', async () => {
    const sql = makeSql([]);
    expect(await new AprendizajeSitiosRepository(sql).purgarDominio('')).toBe(0);
    expect(sql).not.toHaveBeenCalled();
  });
});
