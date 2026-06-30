-- BOVEDA DE CREDENCIALES por usuario. CAMBIO DELIBERADO del principio historico "la plataforma nunca
-- guarda llaves": aqui SI se guarda la API key del usuario, pero SIEMPRE cifrada en reposo con
-- AES-256-GCM (apps/backend/src/crypto/aes-gcm.ts) bajo el secreto maestro VAULT_SECRET. La columna
-- encrypted_key NUNCA contiene la key en claro, y la key descifrada JAMAS se devuelve por HTTP: solo
-- se usa server-side al ejecutar o configurar agentes.
--
-- Operacion: en este repo las migraciones se aplican MANUALMENTE en el SQL Editor de Supabase (no hay
-- runner automatico: ni el backend ni CI las ejecutan). Este archivo es IDEMPOTENTE: re-aplicarlo es
-- un NO-OP y reproduce el mismo esquema en una base vacia.
--
-- Tenancy: owner_id = sub del JWT, IDENTICO a agents.owner_id (V001/V002) y reusando el mismo
-- tenancy. El backend filtra por owner_id en cada query (aislamiento principal); las policies RLS de
-- abajo son la segunda capa.

create extension if not exists pgcrypto;

create table if not exists provider_credentials (
  id            uuid primary key default gen_random_uuid(),
  owner_id      text not null,
  label         text not null,
  provider_id   text not null check (provider_id in ('anthropic', 'openai', 'openai-compatible')),
  encrypted_key text not null,  -- API key cifrada con AES-256-GCM; NUNCA en claro.
  base_url      text,           -- nullable; solo para openai-compatible.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists provider_credentials_owner_id_idx on provider_credentials (owner_id);

-- Politicas RLS por owner_id, EXACTAMENTE como V002__agents_rls.sql. El backend se conecta con el rol
-- de servicio (pooler) que OMITE RLS; estas politicas son la defensa para cualquier acceso con rol
-- authenticated/anon (p.ej. si la consola llamara a PostgREST directo). El aislamiento principal lo
-- aplica el backend filtrando por owner_id; esto es la segunda capa.
alter table provider_credentials enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.

-- Lectura: un usuario autenticado solo ve sus credenciales.
drop policy if exists "provider_credentials_select_own" on provider_credentials;
create policy "provider_credentials_select_own"
  on provider_credentials for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- Insercion: solo puede crear credenciales a su nombre.
drop policy if exists "provider_credentials_insert_own" on provider_credentials;
create policy "provider_credentials_insert_own"
  on provider_credentials for insert
  to authenticated
  with check (owner_id = (auth.jwt() ->> 'sub'));

-- Actualizacion: solo sus credenciales.
drop policy if exists "provider_credentials_update_own" on provider_credentials;
create policy "provider_credentials_update_own"
  on provider_credentials for update
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'))
  with check (owner_id = (auth.jwt() ->> 'sub'));

-- Borrado: solo sus credenciales.
drop policy if exists "provider_credentials_delete_own" on provider_credentials;
create policy "provider_credentials_delete_own"
  on provider_credentials for delete
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));
