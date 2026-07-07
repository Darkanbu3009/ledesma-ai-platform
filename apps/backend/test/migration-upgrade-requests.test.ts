import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica: que cree upgrade_requests con las
// columnas de la solicitud (owner/tier/feature/status), sus CHECKs, sus indices (owner, status/fecha y el
// unico parcial anti-duplicado) y el blindaje (RLS por owner solo-SELECT + revoke de escritura), de forma
// idempotente. El comportamiento runtime (UpgradeRequestsRepository / las rutas) se cubre con mocks aparte.
// Mismo enfoque que migration-admin-actions.test.ts / migration-profile-is-admin.test.ts.
const sql = readFileSync(new URL('../migrations/V023__upgrade_requests.sql', import.meta.url), 'utf8')
  .toLowerCase()
  .replace(/\s+/g, ' ');

describe('migracion V023 (upgrade_requests)', () => {
  it('crea la tabla upgrade_requests de forma idempotente', () => {
    expect(sql).toContain('create table if not exists upgrade_requests');
    expect(sql).toContain('create extension if not exists pgcrypto');
  });

  it('define las columnas de la solicitud: id/owner/tier/feature/status/note/timestamps', () => {
    expect(sql).toContain('id uuid primary key default gen_random_uuid()');
    // owner_id es TEXT (el sub del JWT), NO uuid: misma tenancy que scheduled_tasks/triggers/recipes.
    expect(sql).toContain('owner_id text not null');
    expect(sql).toContain('requested_tier text not null');
    // feature_context nullable (sin NOT NULL): un CTA generico puede no traer feature.
    expect(sql).toContain('feature_context text');
    expect(sql).not.toContain('feature_context text not null');
    // status arranca en 'pending'.
    expect(sql).toContain("status text not null default 'pending'");
    expect(sql).toContain('created_at timestamptz not null default now()');
    expect(sql).toContain('updated_at timestamptz not null default now()');
  });

  it('restringe tier/status/feature con CHECKs (defensa en profundidad del enum Zod)', () => {
    // requested_tier: solo planes solicitables (nunca 'free').
    expect(sql).toContain("check (requested_tier in ('pro', 'autonomous'))");
    // status: el embudo de conversion.
    expect(sql).toContain("status in ('pending', 'contacted', 'converted', 'declined')");
    // feature_context: null o una de las 4 superficies premium.
    expect(sql).toContain("feature_context in ('scheduled_tasks', 'triggers', 'recipes', 'configurator')");
  });

  it('crea el indice por owner y el compuesto por status/fecha para el admin (idempotentes)', () => {
    expect(sql).toContain('create index if not exists upgrade_requests_owner_id_idx on upgrade_requests (owner_id)');
    expect(sql).toContain(
      'create index if not exists upgrade_requests_status_created_at_idx on upgrade_requests (status, created_at desc)',
    );
  });

  it('crea el indice unico PARCIAL anti-duplicado (una pending por owner+tier)', () => {
    expect(sql).toContain('create unique index if not exists upgrade_requests_owner_pending_tier_uidx');
    expect(sql).toContain('on upgrade_requests (owner_id, requested_tier)');
    expect(sql).toContain("where status = 'pending'");
  });

  it('habilita RLS y expone SOLO SELECT propio por owner (owner_id text, sin ::uuid)', () => {
    expect(sql).toContain('alter table upgrade_requests enable row level security');
    expect(sql).toContain('drop policy if exists "upgrade_requests_select_own" on upgrade_requests');
    expect(sql).toContain('create policy "upgrade_requests_select_own" on upgrade_requests for select');
    expect(sql).toContain("using (owner_id = (auth.jwt() ->> 'sub'))");
    // owner_id es text: la comparacion NO castea a uuid (a diferencia de V018).
    expect(sql).not.toContain("(auth.jwt() ->> 'sub')::uuid");
    // NO se expone ninguna policy de escritura: la creacion/gestion es server-side (rol de servicio).
    expect(sql).not.toContain('for insert');
    expect(sql).not.toContain('for update');
  });

  it('revoca la escritura directa (insert/update/delete) de authenticated y anon (conserva select)', () => {
    expect(sql).toContain('revoke insert, update, delete on upgrade_requests from authenticated, anon');
    // NO revoca SELECT: la policy de lectura propia lo necesita.
    expect(sql).not.toContain('revoke select, insert, update, delete on upgrade_requests');
  });
});
