-- Registro multi-tenant: tablas organizations, profiles, subscriptions y usage_counters que usa el
-- backend (apps/backend/src/registration/registration-repository.ts).
--
-- Estas tablas se crearon a mano en el SQL Editor de Supabase y son la fuente de verdad en prod; por
-- eso este archivo es IDEMPOTENTE y GUARDADO: re-aplicarlo contra prod es un NO-OP (las tablas y
-- columnas ya existen) y contra una base vacia reproduce exactamente el esquema que el codigo espera.
-- Los ALTER ... ADD COLUMN IF NOT EXISTS capturan columnas que se agregaron a mano y nunca se
-- commitearon (created_at/updated_at en organizations y profiles; id y created_at en usage_counters),
-- para que una base parcialmente migrada tambien converja al esquema real.
--
-- Operacion: en este repo las migraciones se aplican MANUALMENTE en el SQL Editor de Supabase. No hay
-- runner automatico: ni el backend (apps/backend/src/db/client.ts solo abre el pool) ni CI
-- (.github/workflows/ci.yml solo corre build/typecheck/lint/test) las ejecutan.
--
-- El esquema se deriva del codigo (registration-repository.ts + registration/types.ts):
-- subscriptions y usage_counters NO tienen updated_at (el codigo nunca lo lee ni escribe), a
-- diferencia de organizations y profiles; por eso aqui tampoco se incluye.

create extension if not exists pgcrypto;

-- organizations: cuenta empresa. Entra DIRECTO en 'active' (sin muro de aprobacion manual); el
-- super-admin todavia puede marcarla 'approved' (endpoint legado), pero el acceso lo gatea el TIER
-- del perfil, no el status de la org. El registro fija el status explicitamente ('active'); el default
-- solo aplica a un insert que lo omita.
create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  status      text not null default 'active',
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table organizations add column if not exists created_at timestamptz not null default now();
alter table organizations add column if not exists updated_at timestamptz not null default now();

-- profiles: perfil del usuario, 1:1 con el sub del JWT (profiles.id = sub).
create table if not exists profiles (
  id                uuid primary key,
  org_id            uuid references organizations(id),
  account_type      text not null,
  role              text not null,
  full_name         text not null,
  identity_verified boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table profiles add column if not exists created_at timestamptz not null default now();
alter table profiles add column if not exists updated_at timestamptz not null default now();

-- subscriptions: suscripcion del perfil (individuo y empresa arrancan en 'free'). Sin updated_at (ver nota).
create table if not exists subscriptions (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  plan       text not null,
  status     text not null default 'active',
  created_at timestamptz not null default now()
);
alter table subscriptions add column if not exists created_at timestamptz not null default now();

-- usage_counters: contador de uso del perfil (runs consumidas vs limite). id y created_at se
-- agregaron a mano; los ADD COLUMN los capturan para una base parcialmente migrada. Sin updated_at.
create table if not exists usage_counters (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id),
  runs_used   integer not null default 0,
  runs_limit  integer not null default 10,
  period_kind text not null,
  created_at  timestamptz not null default now()
);
alter table usage_counters add column if not exists id uuid not null default gen_random_uuid();
alter table usage_counters add column if not exists created_at timestamptz not null default now();
