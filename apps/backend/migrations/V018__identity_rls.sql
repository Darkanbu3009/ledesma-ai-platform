-- RLS en las tablas de identidad/registro: organizations, profiles, subscriptions, usage_counters.
-- Aditivo sobre V005__registration.sql (crea las 4 tablas) y V007__profile_tier.sql (agrega
-- profiles.tier). Cierra el hueco documentado en la auditoria 05 (docs/auditorias/05-rls-base-datos.md,
-- hallazgos CRITICA-1 y ALTA-1): estas 4 tablas eran las UNICAS sin RLS ni politicas, mientras las
-- otras 10 tablas de negocio si la tienen. Sin RLS, en el modelo de exposicion por defecto de Supabase
-- (Data API/PostgREST activa + grants a anon/authenticated que el repo nunca revoca), cualquier usuario
-- authenticated podia (a) LEER la identidad/PII de todos los owners (CRITICA-1) y (b) ESCRIBIR su propia
-- fila de profiles para auto-promoverse tier='autonomous', auto-aprobar su empresa o subir su cuota,
-- saltandose el gate de admin (ALTA-1). Un solo cambio cierra ambos.
--
-- Igual que el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de Supabase
-- (no hay runner automatico: ni el backend ni CI las ejecutan) y es IDEMPOTENTE: re-aplicarla contra
-- prod (que ya podria tener RLS puesta a mano) es un NO-OP, y contra una base ya migrada converge sin
-- cambios. Habilitar RLS y re-habilitarla no falla; las policies usan el patron drop-if-exists/create
-- de V002__agents_rls.sql (CREATE POLICY no admite IF NOT EXISTS).
--
-- MODELO DE DOS CAPAS (esta migracion NO cambia el comportamiento del backend): el backend y el worker
-- se conectan con el rol de servicio del pooler (apps/backend/src/db/client.ts:11) que OMITE RLS; toda
-- su lectura/escritura sobre estas tablas (RegistrationRepository: getState, registerIndividual,
-- registerOrganization, approveOrganization, getProfileTier, updateProfileTier) sigue funcionando
-- exactamente igual. RLS solo aplica al rol authenticated/anon cuando un cliente consulta Supabase
-- DIRECTO via PostgREST con el JWT del usuario. Esta migracion cierra ESE camino directo; el backend
-- no cambia.
--
-- MODELO DE PERTENENCIA POR TABLA (cada tabla se aisla por SU columna real, NO todas por la misma):
--   * profiles        -> profiles.id = sub del JWT (relacion 1:1; loadState lee where id = sub).
--   * subscriptions   -> subscriptions.profile_id = sub (la suscripcion cuelga del perfil del sub).
--   * usage_counters  -> usage_counters.profile_id = sub (el contador cuelga del perfil del sub).
--   * organizations   -> NO tiene columna de owner: la pertenencia es via profiles.org_id (una org,
--                        varios miembros). Un usuario ve SOLO la org a la que pertenece su perfil.
-- Las columnas id/profile_id son uuid mientras que el sub del JWT es text, por eso el sub se castea con
-- ::uuid (mismo criterio que la recomendacion de la auditoria 05). Para anon, auth.jwt()->>'sub' es
-- NULL -> ninguna fila coincide (todas las policies son 'to authenticated', fail-closed para anon).
--
-- ESCRITURA (cierra ALTA-1): a proposito NO se crea ninguna policy de INSERT/UPDATE/DELETE. Con RLS
-- habilitado y sin policy de escritura, toda escritura del rol authenticated queda default-deny (mismo
-- patron least-privilege solo-SELECT de jobs/scheduled_tasks/triggers/recipes/consents). En particular
-- profiles.tier (el gate server-side del modo autonomo), profiles.role/account_type/identity_verified,
-- organizations.status (aprobacion) y usage_counters.runs_limit (cuota) NO son escribibles por
-- authenticated: su escritura sigue siendo EXCLUSIVA del backend (rol de servicio, via los endpoints
-- admin con requireAdmin). Hoy NINGUN campo es editable por el usuario via PostgREST (la consola nunca
-- hace .from() a estas tablas; todo pasa por el backend), por eso tampoco se expone UPDATE de columnas
-- "seguras" (p.ej. full_name); si en el futuro se quisiera, deberia limitarse a esas columnas y JAMAS a
-- tier/role/aprobacion/cuota.

-- ============================================================================
-- profiles: el usuario ve SOLO su propio perfil (id = sub). Sin policy de escritura -> tier/role/
-- account_type/identity_verified NO editables por authenticated (cierra la escalada de ALTA-1).
-- ============================================================================
alter table profiles enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own"
  on profiles for select
  to authenticated
  using (id = (auth.jwt() ->> 'sub')::uuid);

-- ============================================================================
-- subscriptions: el usuario ve SOLO las suscripciones de su perfil (profile_id = sub). Solo SELECT.
-- ============================================================================
alter table subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on subscriptions;
create policy "subscriptions_select_own"
  on subscriptions for select
  to authenticated
  using (profile_id = (auth.jwt() ->> 'sub')::uuid);

-- ============================================================================
-- usage_counters: el usuario ve SOLO los contadores de su perfil (profile_id = sub). Solo SELECT ->
-- runs_limit NO editable por authenticated (no puede subirse la cuota directo por PostgREST).
-- ============================================================================
alter table usage_counters enable row level security;

drop policy if exists "usage_counters_select_own" on usage_counters;
create policy "usage_counters_select_own"
  on usage_counters for select
  to authenticated
  using (profile_id = (auth.jwt() ->> 'sub')::uuid);

-- ============================================================================
-- organizations: no tiene columna de owner; la pertenencia es via el profile del sub (profiles.org_id).
-- Un usuario ve SOLO la org a la que pertenece su perfil (los miembros de una misma org la comparten;
-- cero fuga cross-org). La subconsulta a profiles corre bajo la RLS de profiles (policy de arriba): el
-- unico org_id que puede devolver es el del propio perfil del sub, por lo que no expone orgs ajenas.
-- Solo SELECT -> organizations.status NO editable por authenticated (no puede auto-aprobar su empresa).
--
-- ALTERNATIVA mas restrictiva (evaluada): si la org NUNCA debe leerse por el cliente (hoy la consola no
-- la lee via PostgREST; la trae el backend en GET /v1/me con el rol de servicio), puede reemplazarse el
-- USING por 'using (false)' para negar toda lectura a authenticated. Se elige el predicado de
-- pertenencia real para permitir al miembro ver SU propia org (p.ej. su estado de aprobacion) sin
-- exponer las ajenas, que es la lectura minima util y consistente con el resto del esquema.
-- ============================================================================
alter table organizations enable row level security;

drop policy if exists "organizations_select_member" on organizations;
create policy "organizations_select_member"
  on organizations for select
  to authenticated
  using (id in (select p.org_id from profiles p where p.id = (auth.jwt() ->> 'sub')::uuid));

-- ============================================================================
-- Defensa en profundidad (belt and suspenders): ademas de RLS, revocar los grants DIRECTOS de
-- escritura de authenticated/anon sobre estas 4 tablas. Con RLS habilitado + sin policy de escritura ya
-- es default-deny; el REVOKE agrega una SEGUNDA barrera a nivel de privilegio, por si en el futuro se
-- agregara por error una policy de escritura permisiva o se deshabilitara RLS a mano. Se CONSERVA el
-- grant de SELECT (necesario para que las policies de lectura de arriba devuelvan las filas propias).
-- No afecta al backend: se conecta con el rol de servicio (DATABASE_URL), no con authenticated/anon.
--
-- Idempotente: revocar un privilegio que ya no se tiene es un NO-OP (no lanza error). En Supabase los
-- roles anon/authenticated siempre existen. Si se prefiere una postura de RLS pura, esta seccion puede
-- omitirse sin afectar el cierre de CRITICA-1/ALTA-1 (RLS ya los cubre por si sola).
revoke insert, update, delete on profiles from authenticated, anon;
revoke insert, update, delete on organizations from authenticated, anon;
revoke insert, update, delete on subscriptions from authenticated, anon;
revoke insert, update, delete on usage_counters from authenticated, anon;
