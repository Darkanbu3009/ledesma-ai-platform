import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica, igual que
// migration-plantillas-falla-motivo.test.ts.
const original = readFileSync(
  new URL('../migrations/V043__plantillas_consumidores.sql', import.meta.url),
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

describe('migracion V043 (evidencia de consumo de una plantilla compartida)', () => {
  it('agrega la columna jsonb NOT NULL con default de lista vacia, idempotente', () => {
    expect(sql).toContain('alter table plantillas_compartidas');
    expect(sql).toContain(
      "add column if not exists consumidores_hash jsonb not null default '[]'::jsonb",
    );
  });

  it('sin backfill retroactivo: ni un update, ni un insert, ni un delete', () => {
    expect(ddl).not.toContain('update ');
    expect(ddl).not.toContain('insert ');
    expect(ddl).not.toContain('delete ');
    expect(ddl).not.toContain('drop');
  });

  it('no toca las columnas de V041/V042: solo agrega la de consumidores', () => {
    for (const columna of [
      'ejecuciones_exitosas',
      'ejecuciones_fallidas',
      'fallos_consecutivos',
      'estado',
      'origenes_hash',
      'ultima_falla_motivo',
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
