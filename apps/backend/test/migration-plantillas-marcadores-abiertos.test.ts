import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MARCADORES_ABIERTOS, MARCADORES_NUCLEO } from '@ledesma-platform/shared';
import { MAX_FILAS_DE_DIAGNOSTICO } from '../src/plantillas-compartidas/plantillas-compartidas-repository.js';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica, igual que
// migration-plantillas-desajustes.test.ts.
const original = readFileSync(
  new URL('../migrations/V045__plantillas_marcadores_abiertos.sql', import.meta.url),
  'utf8',
);

const sql = original.toLowerCase().replace(/\s+/g, ' ');

/**
 * El DDL SIN comentarios: lo unico contra lo que se puede afirmar que algo no existe. Se quitan los
 * de linea (`--`) y tambien el `comment on column`, que es prosa dentro de una cadena y nombra otras
 * columnas para explicarse.
 */
const ddl = original
  .toLowerCase()
  .split('\n')
  .map((linea) => linea.replace(/--.*$/, ''))
  .join('\n')
  .replace(/comment on column[^;]*;/g, '')
  .replace(/\s+/g, ' ');

describe('migracion V045 (los datos abiertos de una plantilla viajan fuera de la clave)', () => {
  it('agrega la columna jsonb NOT NULL con default de lista vacia, idempotente', () => {
    expect(sql).toContain('alter table plantillas_compartidas');
    expect(sql).toContain(
      "add column if not exists marcadores_abiertos jsonb not null default '[]'::jsonb",
    );
  });

  it('documenta la columna: que lleva, de donde sale y que NO es parte de la identidad', () => {
    expect(sql).toContain('comment on column plantillas_compartidas.marcadores_abiertos');
    expect(sql).toContain('no forma parte del indice unico ni de la busqueda por contencion');
  });

  it('NO toca el indice unico de V041 ni sus tres columnas de identidad', () => {
    expect(ddl).not.toContain('create unique index');
    expect(ddl).not.toContain('drop index');
    expect(ddl).not.toContain('plantillas_compartidas_identidad_uniq');
    // La identidad sigue siendo la de V041: la columna nueva no entra en ella.
    expect(ddl).not.toContain('marcadores_clave');
  });

  it('sin backfill retroactivo: ni un update, ni un insert, ni un delete de filas', () => {
    expect(ddl).not.toContain('update ');
    expect(ddl).not.toContain('insert ');
    expect(ddl).not.toContain('delete ');
    expect(ddl).not.toContain('drop table');
    expect(ddl).not.toContain('drop column');
  });

  it('no toca ninguna columna de V041/V042/V043/V044', () => {
    for (const columna of [
      'pasos',
      'estado',
      'origenes_hash',
      'consumidores_hash',
      'desajustes_hash',
      'ejecuciones_exitosas',
      'ejecuciones_fallidas',
      'fallos_consecutivos',
      'ultima_falla_motivo',
    ]) {
      expect(ddl, columna).not.toContain(columna);
    }
  });

  it('el tope del diagnostico ya se deriva del NUCLEO, que es lo que la clave puede llevar', () => {
    expect(MAX_FILAS_DE_DIAGNOSTICO).toBe(2 ** MARCADORES_NUCLEO.length);
    expect(MARCADORES_NUCLEO).toHaveLength(6);
    expect(MARCADORES_ABIERTOS).toHaveLength(3);
  });
});
