import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MOTIVOS_DE_FALLA_DE_PLANTILLA } from '@ledesma-platform/shared';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica, igual que
// migration-plantillas-consumidores.test.ts.
const original = readFileSync(
  new URL('../migrations/V044__plantillas_desajuste_interfaz.sql', import.meta.url),
  'utf8',
);

const sql = original.toLowerCase().replace(/\s+/g, ' ');

/** El DDL SIN comentarios: lo unico contra lo que se puede afirmar que algo no existe. */
const ddl = original
  .toLowerCase()
  .split('\n')
  .map((linea) => linea.replace(/--.*$/, ''))
  .join('\n')
  .replace(/\s+/g, ' ');

describe('migracion V044 (desajuste de interfaz de una plantilla compartida)', () => {
  it('agrega la columna jsonb NOT NULL con default de lista vacia, idempotente', () => {
    expect(sql).toContain('alter table plantillas_compartidas');
    expect(sql).toContain(
      "add column if not exists desajustes_hash jsonb not null default '[]'::jsonb",
    );
  });

  it('extiende el CHECK de ultima_falla_motivo con el motivo del vocabulario cerrado', () => {
    // El reemplazo es idempotente (drop if exists + add), con el patron de V036/V041.
    expect(ddl).toContain(
      'drop constraint if exists plantillas_compartidas_ultima_falla_motivo_check',
    );
    expect(ddl).toContain('add constraint plantillas_compartidas_ultima_falla_motivo_check');
    for (const motivo of MOTIVOS_DE_FALLA_DE_PLANTILLA) {
      expect(ddl).toContain(`'${motivo}'`);
    }
  });

  it('el vocabulario compartido ya contiene el motivo que el CHECK admite', () => {
    expect(MOTIVOS_DE_FALLA_DE_PLANTILLA).toContain('desajuste_de_interfaz');
  });

  it('sin backfill retroactivo: ni un update, ni un insert, ni un delete de filas', () => {
    expect(ddl).not.toContain('update ');
    expect(ddl).not.toContain('insert ');
    expect(ddl).not.toContain('delete ');
    expect(ddl).not.toContain('drop table');
    expect(ddl).not.toContain('drop column');
  });

  it('no toca las columnas de V041/V043: solo agrega la de desajustes y el CHECK del motivo', () => {
    for (const columna of [
      'ejecuciones_exitosas',
      'ejecuciones_fallidas',
      'fallos_consecutivos',
      'origenes_hash',
      'consumidores_hash',
    ]) {
      expect(ddl).not.toContain(`${columna} =`);
      expect(ddl).not.toContain(`add column ${columna}`);
      expect(ddl).not.toContain(`add column if not exists ${columna}`);
    }
  });

  it('la columna no identifica a nadie: ningun owner ni id rastreable en el DDL', () => {
    expect(ddl).not.toContain('owner');
    expect(ddl).not.toContain('firma');
    expect(ddl).not.toContain('descripcion');
  });
});
