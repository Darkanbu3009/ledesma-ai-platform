import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica: que cree admin_actions con las
// columnas del audit log, sus indices y el blindaje (RLS habilitado, SIN policies, revoke a
// authenticated/anon), de forma idempotente. El comportamiento runtime (recordAdminAction) se cubre
// con mocks aparte. Mismo enfoque que migration-profile-is-admin.test.ts.
const sql = readFileSync(new URL('../migrations/V022__admin_actions.sql', import.meta.url), 'utf8')
  .toLowerCase()
  .replace(/\s+/g, ' ');

describe('migracion V022 (admin_actions)', () => {
  it('crea la tabla admin_actions de forma idempotente', () => {
    expect(sql).toContain('create table if not exists admin_actions');
  });

  it('define las columnas del audit log: actor/action/target/details/created_at', () => {
    // actor_id nullable (sin NOT NULL) para tolerar el caso x-admin-token sin identidad.
    expect(sql).toContain('actor_id text');
    expect(sql).not.toContain('actor_id text not null');
    expect(sql).toContain('action text not null');
    expect(sql).toContain('target_id text not null');
    expect(sql).toContain('details jsonb not null');
    expect(sql).toContain('created_at timestamptz not null default now()');
    expect(sql).toContain('id uuid primary key default gen_random_uuid()');
  });

  it('crea el indice por created_at (y por target/actor) de forma idempotente', () => {
    expect(sql).toContain('create index if not exists admin_actions_created_at_idx on admin_actions (created_at desc)');
    expect(sql).toContain('create index if not exists admin_actions_target_id_idx on admin_actions (target_id)');
    expect(sql).toContain('create index if not exists admin_actions_actor_id_idx on admin_actions (actor_id)');
  });

  it('habilita RLS y NO crea ninguna policy (default-deny total para authenticated)', () => {
    expect(sql).toContain('alter table admin_actions enable row level security');
    // Blindaje mas estricto que V018: sin policies -> ni lectura ni escritura por authenticated/anon.
    expect(sql).not.toContain('create policy');
  });

  it('revoca todo acceso (select/insert/update/delete) de authenticated y anon', () => {
    expect(sql).toContain('revoke select, insert, update, delete on admin_actions from authenticated, anon');
  });
});
