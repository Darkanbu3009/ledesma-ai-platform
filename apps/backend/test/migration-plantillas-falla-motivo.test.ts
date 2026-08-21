import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MOTIVOS_DE_FALLA_DE_PLANTILLA } from '@ledesma-platform/shared';

/**
 * Los CUATRO motivos originales de V042. El quinto ('desajuste_de_interfaz') lo agrega V044
 * reemplazando el CHECK entero; esta migracion es historica y no se reescribe.
 */
const MOTIVOS_DE_V042 = ['barrera_bloqueada', 'sin_efecto', 'abandonada', 'sesion'] as const;

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
    for (const motivo of MOTIVOS_DE_V042) {
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

  it('el vocabulario del CHECK de V042 esta CONTENIDO en el contrato compartido vigente', () => {
    const dentroDelCheck = ddl.slice(ddl.indexOf('check ('), ddl.indexOf(')', ddl.indexOf('in (')));
    const citados = [...dentroDelCheck.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(citados.sort()).toEqual([...MOTIVOS_DE_V042].sort());
    // Todo motivo de V042 sigue vigente en el contrato; los nuevos los agrega V044 sobre el CHECK.
    for (const motivo of citados) {
      expect(MOTIVOS_DE_FALLA_DE_PLANTILLA).toContain(motivo);
    }
  });
});
