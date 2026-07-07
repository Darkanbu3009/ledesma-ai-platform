-- SOLICITUDES DE UPGRADE (captura de DEMANDA calificada, Fase 1 de monetizacion). Cuando un usuario
-- 'free' se topa con una feature PREMIUM (scheduler/triggers/recetas/configurador autonomo) y pide
-- acceso, se registra AQUI quien la pidio (owner_id = sub del JWT) y que feature/plan queria. Es la
-- senal que alimenta la conversion: un admin puede ver estos leads y subir el tier con el flujo que ya
-- existe (PUT /v1/admin/users/:id/tier, admin-user-tier.ts). ESTA pieza es SOLO el backend (tabla +
-- endpoints); el CTA en la UI es aparte. Aditivo: NO cambia el enforcement de tier (solo registra el
-- interes; subir el tier sigue siendo del admin).
--
-- El molde es scheduled_tasks (V009), triggers (V012) y recipes (V013): owner_id text, RLS por owner,
-- lectura/escritura SOLO server-side por el backend con el rol de servicio (que OMITE RLS). A diferencia
-- de esas tablas, crear una solicitud NO exige tier 'autonomous' (el punto es justamente que un usuario
-- 'free' la cree). Pero la escritura sigue siendo server-side (via POST /v1/upgrade-requests con
-- requireUser), NO por PostgREST: asi el backend controla el anti-duplicado/anti-spam (un free no puede
-- generar N solicitudes clickeando el CTA) y el cambio de status (admin).
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de Supabase
-- (no hay runner automatico: ni el backend ni CI las ejecutan) y es IDEMPOTENTE: re-aplicarla contra prod
-- es un NO-OP y reproduce el mismo esquema en una base vacia (create table/index if not exists, enable RLS
-- re-habilitable, drop-if-exists/create de la policy, revoke de un privilegio ausente es NO-OP).

-- gen_random_uuid vive en pgcrypto; lo aseguran V006/V008/V009/V012/V013, se repite aqui por si V023 se aplicara sola.
create extension if not exists pgcrypto;

create table if not exists upgrade_requests (
  id              uuid primary key default gen_random_uuid(),
  -- Quien pide el upgrade (sub del JWT). NOT NULL: una solicitud SIEMPRE tiene dueno. text (no uuid):
  -- misma tenancy que agents (V001), jobs (V008), scheduled_tasks (V009), triggers (V012), recipes (V013);
  -- el sub es text, por eso NO se castea con ::uuid en la RLS de abajo.
  owner_id        text not null,
  -- El plan al que quiere subir. Mismo universo que profiles.tier (V007) MENOS 'free' (el estado actual /
  -- un downgrade, no se 'solicita'). Hoy 'autonomous' es el unico que desbloquea las features premium;
  -- 'pro' se admite para cuando exista un plan intermedio. El CHECK lo respalda.
  requested_tier  text not null,
  -- Que feature DISPARO la solicitud (para saber que demanda captura cada lead). NULLABLE: la solicitud
  -- puede venir de un CTA generico sin feature especifica. El universo son las 4 superficies premium.
  feature_context text,
  -- Estado del lead en el embudo de conversion (lo mueve el admin: contacted/converted/declined). Arranca
  -- 'pending'. El CHECK enumera los estados validos (mismo criterio que jobs.status en V008).
  status          text not null default 'pending',
  -- Nota opcional (ej. el admin anota el resultado del contacto, o el usuario deja contexto). Nullable.
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Los CHECK se declaran inline; son la defensa en profundidad junto a la validacion Zod del backend
  -- (routes/upgrade-requests.ts). Aunque la escritura solo ocurre server-side, la base rechaza valores
  -- fuera del enum (p.ej. un INSERT directo).
  constraint upgrade_requests_tier_check check (requested_tier in ('pro', 'autonomous')),
  constraint upgrade_requests_status_check check (
    status in ('pending', 'contacted', 'converted', 'declined')
  ),
  -- feature_context: null (CTA generico) o una de las 4 superficies premium.
  constraint upgrade_requests_feature_check check (
    feature_context is null
    or feature_context in ('scheduled_tasks', 'triggers', 'recipes', 'configurator')
  )
);

-- Indice por owner: GET /v1/upgrade-requests/me (las solicitudes propias del usuario, para que la UI
-- muestre "solicitud enviada" en vez de re-ofrecer el CTA).
create index if not exists upgrade_requests_owner_id_idx on upgrade_requests (owner_id);

-- Indice del PANEL ADMIN: listar los leads por estado, mas nuevos primero (GET /v1/admin/upgrade-requests).
-- Compuesto (status, created_at desc), mismo criterio que jobs_status_idx (V008) + admin_actions_created_at_idx
-- (V022): cubre tanto el filtro por status como el orden "ultimos primero".
create index if not exists upgrade_requests_status_created_at_idx
  on upgrade_requests (status, created_at desc);

-- ANTI-DUPLICADO a nivel de base (defensa en profundidad del anti-spam del endpoint): un usuario NO puede
-- tener DOS solicitudes 'pending' para el MISMO tier. El indice unico es PARCIAL (solo where status =
-- 'pending'): una vez contactada/convertida/declinada, el usuario puede volver a solicitar ese tier. El
-- backend ya evita el duplicado (select-then-insert en POST /v1/upgrade-requests); este indice cierra la
-- ventana TOCTOU de dos clicks concurrentes -> el segundo INSERT choca con 23505 y el repositorio captura
-- el error y devuelve la solicitud existente (mismo criterio que registerOrganization en registration-repository.ts).
create unique index if not exists upgrade_requests_owner_pending_tier_uidx
  on upgrade_requests (owner_id, requested_tier)
  where status = 'pending';

-- RLS por owner_id. upgrade_requests es una tabla OPERATIVA gestionada por la plataforma: igual que
-- scheduled_tasks (V009), triggers (V012) y recipes (V013), solo exponemos SELECT propio al rol
-- authenticated (para que la consola muestre las solicitudes del usuario leyendolas via el backend). La
-- ESCRITURA (insert/update) NO tiene policy -> con RLS habilitado queda default-deny para authenticated:
-- se crea/gestiona SOLO server-side con el rol de servicio (que OMITE RLS, db/client.ts). Exponer INSERT
-- via RLS permitiria a un usuario saltarse el anti-duplicado insertando directo por PostgREST; exponer
-- UPDATE permitiria auto-marcar su solicitud como 'converted'. Deliberadamente NO se hacen. El ADMIN las
-- lee TODAS via el rol de servicio detras del gate admin (requireAdminRole), NO por una policy de authenticated.
alter table upgrade_requests enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.
-- owner_id es text (como el sub), por eso se compara SIN ::uuid (a diferencia de V018, cuyas columnas son uuid).
drop policy if exists "upgrade_requests_select_own" on upgrade_requests;
create policy "upgrade_requests_select_own"
  on upgrade_requests for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- Defensa en profundidad (mismo criterio que V018__identity_rls / V022__admin_actions): ademas de la RLS,
-- revocar los grants DIRECTOS de escritura de authenticated/anon. Con RLS habilitado + sin policy de
-- escritura ya es default-deny; el REVOKE agrega una SEGUNDA barrera por si en el futuro se agregara por
-- error una policy permisiva o se deshabilitara RLS a mano. Se CONSERVA el grant de SELECT (necesario para
-- que la policy de lectura propia devuelva las filas del owner). No afecta al backend (rol de servicio, no
-- authenticated/anon). Idempotente: revocar un privilegio ausente es NO-OP; los roles anon/authenticated
-- siempre existen en Supabase.
revoke insert, update, delete on upgrade_requests from authenticated, anon;
