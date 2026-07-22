import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Contrato ESTATICO de la migracion V029 (pais declarado en el perfil), mismo enfoque que
// migration-sitios-conectados-pais.test.ts: sin runner ni DB en CI, se verifica que la migracion
// agregue profiles.pais de forma aditiva, idempotente y reversible, con el CHECK de formato ISO-2 y
// null permitido (usuario que aun no declaro pais). El comportamiento runtime (repositorio, PATCH
// /v1/me/profile y el fallback de POST /v1/sitios/conectar) se cubre con mocks aparte.
const sql = readFileSync(
  new URL('../migrations/V029__profile_pais.sql', import.meta.url),
  'utf8',
)
  .toLowerCase()
  .replace(/\s+/g, ' ');

describe('migracion V029 (profiles: pais declarado por el usuario)', () => {
  it('agrega pais de forma ADITIVA e idempotente', () => {
    expect(sql).toContain('alter table profiles add column if not exists pais text');
  });

  it('impone el formato ISO 3166-1 alpha-2 en mayusculas via CHECK, con null permitido', () => {
    expect(sql).toContain('drop constraint if exists profiles_pais_ck');
    expect(sql).toContain("check (pais is null or pais ~ '^[a-z]{2}$')");
  });

  it('la columna es NULLABLE y sin default (sirve a CUALQUIER pais, ninguno hardcodeado)', () => {
    // La sentencia termina en `pais text;`: sin NOT NULL, sin DEFAULT, sin pais precargado.
    expect(sql).toContain('add column if not exists pais text;');
    expect(sql).not.toMatch(/pais text (not null|default)/);
    expect(sql).not.toMatch(/set pais/);
    expect(sql).not.toContain('update profiles');
  });

  it('NO toca ninguna otra tabla ni columna existente', () => {
    expect(sql).not.toMatch(/alter table (?!profiles)/);
    expect(sql).not.toContain('create table');
    expect(sql).not.toMatch(/drop column if exists (?!pais)/);
  });

  it('documenta la reversion limpia', () => {
    expect(sql).toContain('alter table profiles drop constraint if exists profiles_pais_ck');
    expect(sql).toContain('alter table profiles drop column if exists pais');
  });
});
