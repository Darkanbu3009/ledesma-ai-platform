-- Tier del perfil: desbloquea features por plan. Aditivo sobre V005__registration.sql (tabla
-- profiles). Igual que el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor
-- de Supabase (no hay runner automatico: ni el backend ni CI las ejecutan) y es IDEMPOTENTE:
-- re-aplicarla contra prod es un NO-OP y contra una base ya migrada converge sin cambios.
--
-- 'autonomous' desbloquea el MODO AUTONOMO del Configurador: crear el agente directo del dialogo,
-- SIN confirmacion humana, cuando la validacion estricta pasa. El gate vive server-side leyendo
-- ESTA columna (nunca se confia en el cliente). 'free' y 'pro' solo ven el modo asistente actual.
--
-- Este flag es TEMPORAL: se administra a mano via POST /v1/admin/profiles/:id/tier (mismo patron de
-- auth admin que la aprobacion de empresas) hasta que exista facturacion, momento en que el tier
-- pasara a derivarse del estado de la suscripcion en vez de setearse a mano.

-- La columna: text NOT NULL default 'free'. ADD COLUMN IF NOT EXISTS captura una base donde la
-- columna ya se haya agregado a mano (mismo criterio que created_at/updated_at en V005).
alter table profiles add column if not exists tier text not null default 'free';

-- El CHECK se agrega aparte para poder re-aplicarlo de forma idempotente: Postgres no soporta
-- ADD CONSTRAINT IF NOT EXISTS, asi que se borra si existe y se vuelve a crear, mismo criterio que
-- el patron drop policy if exists / create policy de V002__agents_rls.sql.
alter table profiles drop constraint if exists profiles_tier_check;
alter table profiles add constraint profiles_tier_check check (tier in ('free', 'pro', 'autonomous'));
