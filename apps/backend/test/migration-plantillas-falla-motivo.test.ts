import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MOTIVOS_DE_FALLA_DE_PLANTILLA } from '@ledesma-platform/shared';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica, igual que
// migration-plantillas-compartidas.test.ts.
const original = readFileSync(
  new URL('../migrations/V042__plantillas_falla_motivo.sql', import.meta.url),
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

describe('migracion V042 (motivo del ultimo fallo de una plantilla)', () => {
  it('agrega UNA columna de texto con su CHECK de vocabulario cerrado', () => {
    expect(sql).toContain('alter table plantillas_compartidas');
    expect(sql).toContain('add column ultima_falla_motivo text');
    for (const motivo of MOTIVOS_DE_FALLA_DE_PLANTILLA) {
      expect(sql).toContain(`'${motivo}'`);
    }
    // NULL es un valor legitimo: sin fallos, o limpiado por el ultimo exito.
    expect(sql).toContain('ultima_falla_motivo is null');
  });

  it('no toca los contadores de V041 ni el estado: solo dice POR QUE fue el ultimo fallo', () => {
    for (const columna of [
      'ejecuciones_exitosas',
      'ejecuciones_fallidas',
      'fallos_consecutivos',
      'estado',
      'origenes_hash',
    ]) {
      expect(ddl).not.toContain(`${columna} =`);
      expect(ddl).not.toContain(`add column ${columna}`);
    }
    expect(ddl).not.toContain('drop');
    expect(ddl).not.toContain('update ');
  });

  it('el vocabulario del CHECK es EXACTAMENTE el del contrato compartido', () => {
    const dentroDelCheck = ddl.slice(ddl.indexOf('check ('), ddl.indexOf(')', ddl.indexOf('in (')));
    const citados = [...dentroDelCheck.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(citados.sort()).toEqual([...MOTIVOS_DE_FALLA_DE_PLANTILLA].sort());
  });
});
