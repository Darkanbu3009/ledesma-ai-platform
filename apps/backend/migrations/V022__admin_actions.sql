-- AUDIT LOG de acciones de ADMINISTRADOR: tabla admin_actions. Registra cada accion admin (por ahora,
-- SOLO el cambio de tier) con actor + objetivo + detalle + timestamp. Es la ultima pieza de la fundacion
-- de admin (PR 1c), deliberadamente pequena y aislada. Aditiva: no toca ninguna tabla existente.
--
-- Igual que el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de Supabase (no
-- hay runner automatico: ni el backend ni CI las ejecutan) y es IDEMPOTENTE: re-aplicarla contra prod es
-- un NO-OP y contra una base ya migrada converge sin cambios (create table/index if not exists, enable
-- RLS re-habilitable, revoke de un privilegio ausente es NO-OP).
--
-- COLUMNAS:
--   * id         -> uuid PK (gen_random_uuid), como el resto de las tablas operativas.
--   * actor_id   -> text NULLABLE: el sub del admin que ejecuta la accion. Nullable A PROPOSITO para
--                   tolerar el caso ACTUAL: el endpoint de cambio de tier se gatea con x-admin-token
--                   (auth/require-admin.ts), un secreto compartido SIN identidad de actor -> se registra
--                   null. El dia que ese endpoint pase a gate por ROL (requireAdminRole, que si expone el
--                   sub del admin) el actor_id se llenara con ese sub SIN necesidad de otra migracion. Es
--                   text (no uuid) para no acoplar el audit al formato del identificador, igual que
--                   owner_id (text) en agents/jobs/triggers/recipes.
--   * action     -> text NOT NULL: el tipo de accion, ej. 'change_tier'. Sin CHECK: el catalogo de
--                   acciones crece con el panel; restringirlo aqui obligaria a una migracion por cada
--                   accion nueva. La validez del valor la garantiza el backend (unico escritor).
--   * target_id  -> text NOT NULL: el objeto afectado (para change_tier, el id del perfil objetivo). text
--                   por el mismo criterio que actor_id: distintas acciones futuras podran apuntar a
--                   entidades con distinto tipo de id.
--   * details    -> jsonb NOT NULL default '{}': el detalle estructurado de la accion, ej. para
--                   change_tier { "from": "free", "to": "autonomous" }. jsonb (no columnas fijas) para que
--                   cada accion lleve su propia forma sin cambiar el esquema. default '{}' es un fallback
--                   seguro; el backend siempre provee el objeto.
--   * created_at -> timestamptz NOT NULL default now(): cuando ocurrio la accion.
--
-- INDICES: por created_at DESC (consulta natural del log: "ultimas acciones"), y por target_id / actor_id
-- (para filtrar el historial de un usuario afectado o de un admin). if not exists -> idempotentes.

-- gen_random_uuid vive en pgcrypto; lo aseguran V006/V008/V009/V012/V013, se repite aqui por si V022 se
-- aplicara sola.
create extension if not exists pgcrypto;

create table if not exists admin_actions (
  id         uuid primary key default gen_random_uuid(),
  actor_id   text,
  action     text not null,
  target_id  text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Consulta natural del log (mas recientes primero) + filtros por objetivo/actor.
create index if not exists admin_actions_created_at_idx on admin_actions (created_at desc);
create index if not exists admin_actions_target_id_idx on admin_actions (target_id);
create index if not exists admin_actions_actor_id_idx on admin_actions (actor_id);

-- BLINDAJE (mismo criterio que V018__identity_rls, aun mas estricto): admin_actions es un registro de
-- auditoria INTERNO. NINGUN usuario authenticated/anon debe leerlo NI escribirlo via PostgREST; su
-- escritura y su (futura) lectura son EXCLUSIVAS del backend, que se conecta con el rol de servicio del
-- pooler (apps/backend/src/db/client.ts) y OMITE RLS. Por eso:
--   1) Se habilita RLS SIN crear NINGUNA policy -> default-deny TOTAL para authenticated/anon (ni SELECT
--      ni escritura). A diferencia de jobs/triggers/recipes (que exponen SELECT propio via RLS), aqui no
--      hay una vista "propia" que exponer: el audit no le pertenece al usuario. Si mas adelante un admin
--      necesita LEER el log desde el panel, se hara por un endpoint admin-gateado con el rol de servicio,
--      NO por una policy de authenticated.
--   2) Defensa en profundidad: se REVOCAN ademas los grants directos (select/insert/update/delete) de
--      authenticated/anon, por si en el futuro se agregara por error una policy permisiva o se
--      deshabilitara RLS a mano. No afecta al backend (rol de servicio, no authenticated/anon).
-- Idempotente: re-habilitar RLS no falla; revocar un privilegio ausente es NO-OP; los roles anon/
-- authenticated siempre existen en Supabase.
alter table admin_actions enable row level security;

revoke select, insert, update, delete on admin_actions from authenticated, anon;
