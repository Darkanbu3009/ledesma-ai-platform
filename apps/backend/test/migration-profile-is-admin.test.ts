import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica: que agregue profiles.is_admin como
// boolean NOT NULL con default false y de forma idempotente (add column if not exists), analogo a como
// V007 agrega tier. La lectura runtime (RegistrationRepository.isAdmin) se cubre con mocks aparte.
const sql = readFileSync(new URL('../migrations/V021__profile_is_admin.sql', import.meta.url), 'utf8')
  .toLowerCase()
  .replace(/\s+/g, ' ');

describe('migracion V021 (profiles.is_admin)', () => {
  it('agrega is_admin boolean not null default false de forma idempotente', () => {
    expect(sql).toContain('add column if not exists is_admin boolean not null default false');
  });

  it('opera sobre la tabla profiles', () => {
    expect(sql).toContain('alter table profiles add column if not exists is_admin');
  });
});
