import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Las migraciones se aplican A MANO en el SQL Editor de Supabase (no hay runner ni DB en CI), asi que
// aqui se verifica el CONTRATO de la migracion de forma estatica: que cree sitios_conectados con las
// columnas de la sesion heredada (dominio, contexto cifrado, identidad de red pineada, estado), sus
// CHECKs, el unique (owner_id, dominio), el indice (owner_id, estado) y el blindaje (RLS por owner
// solo-SELECT + revoke de escritura), de forma idempotente y reversible. El comportamiento runtime
// (SitiosConectadosRepository) se cubre con mocks aparte. Mismo enfoque que
// migration-upgrade-requests.test.ts / migration-admin-actions.test.ts.
const sql = readFileSync(new URL('../migrations/V024__sitios_conectados.sql', import.meta.url), 'utf8')
  .toLowerCase()
  .replace(/\s+/g, ' ');

describe('migracion V024 (sitios_conectados)', () => {
  it('crea la tabla sitios_conectados de forma idempotente', () => {
    expect(sql).toContain('create table if not exists sitios_conectados');
    expect(sql).toContain('create extension if not exists pgcrypto');
  });

  it('define las columnas de identidad y dominio: id/owner/dominio/url_login', () => {
    expect(sql).toContain('id uuid primary key default gen_random_uuid()');
    // owner_id es TEXT (el sub del JWT), NO uuid: misma tenancy que agents/recipes/upgrade_requests.
    expect(sql).toContain('owner_id text not null');
    expect(sql).not.toContain('owner_id uuid');
    expect(sql).toContain('dominio text not null');
    // url_login nullable (sin NOT NULL): es informativa.
    expect(sql).toContain('url_login text');
    expect(sql).not.toContain('url_login text not null');
  });

  it('define el contexto de sesion: id externo + blob CIFRADO en bytea (jamas texto en claro)', () => {
    expect(sql).toContain('contexto_externo_id text');
    // bytea: los bytes iv | tag | ciphertext de aes-gcm.ts. Nunca una columna de texto plano.
    expect(sql).toContain('contexto_cifrado bytea');
    expect(sql).not.toContain('contexto_cifrado text');
    expect(sql).not.toContain('contexto_plano');
  });

  it('define la identidad de red pineada: proxy_ref, egress_ip (inet) y fingerprint_ref', () => {
    expect(sql).toContain('proxy_ref text');
    expect(sql).toContain('egress_ip inet');
    expect(sql).toContain('fingerprint_ref text');
  });

  it('restringe estado al ciclo de vida con CHECK y default esperando_login', () => {
    expect(sql).toContain("estado text not null default 'esperando_login'");
    expect(sql).toContain("estado in ('esperando_login', 'activo', 'caducado', 'error')");
  });

  it('define los timestamps del ciclo de vida', () => {
    expect(sql).toContain('creado_en timestamptz not null default now()');
    expect(sql).toContain('ultimo_uso_en timestamptz');
    expect(sql).toContain('expira_en timestamptz');
  });

  it('impone UNA conexion por owner y dominio (unique) y el indice por owner/estado', () => {
    expect(sql).toContain('unique (owner_id, dominio)');
    expect(sql).toContain(
      'create index if not exists sitios_conectados_owner_estado_idx on sitios_conectados (owner_id, estado)',
    );
  });

  it('NO tiene ninguna columna de contrasena (el login jamas se automatiza ni se almacena)', () => {
    // Ni password ni ninguna declaracion de columna de contrasena/credencial en claro. La palabra
    // "contrasena" solo puede aparecer en comentarios (explicando que NO se guarda), nunca como columna.
    expect(sql).not.toContain('password');
    expect(sql).not.toMatch(/contrasena\s+(text|bytea|varchar)/);
  });

  it('habilita RLS y expone SOLO SELECT propio por owner (owner_id text, sin ::uuid)', () => {
    expect(sql).toContain('alter table sitios_conectados enable row level security');
    expect(sql).toContain('drop policy if exists "sitios_conectados_select_own" on sitios_conectados');
    expect(sql).toContain('create policy "sitios_conectados_select_own" on sitios_conectados for select');
    expect(sql).toContain("using (owner_id = (auth.jwt() ->> 'sub'))");
    // owner_id es text: la comparacion NO castea a uuid, identico a agents (V002) y V023.
    expect(sql).not.toContain("(auth.jwt() ->> 'sub')::uuid");
    // NO se expone ninguna policy de escritura: crear/editar es server-side (ahi vive el cifrado).
    expect(sql).not.toContain('for insert');
    expect(sql).not.toContain('for update');
    expect(sql).not.toContain('for delete');
  });

  it('revoca la escritura directa (insert/update/delete) de authenticated y anon (conserva select)', () => {
    expect(sql).toContain('revoke insert, update, delete on sitios_conectados from authenticated, anon');
    // NO revoca SELECT: la policy de lectura propia lo necesita.
    expect(sql).not.toContain('revoke select, insert, update, delete on sitios_conectados');
  });

  it('revierte limpio: tabla nueva sin FKs (ni entrantes ni salientes) y sin tocar otras tablas', () => {
    // Sin `references`: no depende de otras tablas ni otras dependen de ella; el drop es limpio.
    expect(sql).not.toContain('references');
    // La unica sentencia alter/create table apunta a sitios_conectados: la migracion es puramente aditiva.
    expect(sql).not.toMatch(/alter table (?!sitios_conectados)/);
    expect(sql).not.toMatch(/create table if not exists (?!sitios_conectados)/);
    // Documenta la reversion.
    expect(sql).toContain('drop table if exists sitios_conectados');
  });
});
