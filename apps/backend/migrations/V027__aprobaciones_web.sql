-- CHECKPOINTS DE APROBACION HUMANA para tareas web (Fase 7.1e). 7.1d detecta las acciones
-- irreversibles o financieras y las BLOQUEA reportando 'requiere_aprobacion'; esta migracion agrega
-- el mecanismo para que un humano las apruebe o rechace y la tarea se reanude: es la intervencion
-- humana que exige GDPR Art.22 (decision con efectos significativos -> derecho a intervencion humana),
-- alineada con el andamiaje de privacidad de V014/V015/V016 (LFPDPPP + GDPR + EU AI Act Art.50).
--
-- Tres piezas:
--  1. jobs gana el estado 'pausado': el worker deja el job ahi mientras la aprobacion esta pendiente
--     y el backend lo devuelve a 'pending' cuando el humano decide (el worker lo re-reclama y reanuda).
--  2. aprobaciones_web: una fila por checkpoint (que accion, screenshot de lo que el agente veia,
--     estado de la decision, expiracion corta).
--  3. intervenciones_art22: el REGISTRO de cada intervencion humana (quien decidio, cuando y que vio),
--     encadenado a la aprobacion. V014 no tiene una tabla de intervenciones (solo consents /
--     data_subject_requests / processing_records), asi que se crea aqui siguiendo su mismo patron.
--
-- Tenancy: owner_id = sub del JWT (text), IDENTICO a jobs.owner_id (V008) y consents.owner_id (V014).
-- (La especificacion decia uuid; se usa text por consistencia con TODA la tenancy del repo.)
-- El backend/worker escriben con el rol de servicio (omite RLS); el aislamiento real es el WHERE
-- owner_id de cada query del repositorio. Las policies RLS son la segunda capa (solo SELECT: las
-- decisiones JAMAS se escriben desde el cliente; pasan por los endpoints que validan el CAS de estado).
--
-- Operacion: como el resto de las migraciones, se aplica a mano en el SQL Editor de Supabase.
-- Idempotente: re-aplicarla es un no-op.

create extension if not exists pgcrypto;

-- 1. Estado 'pausado' en la maquina de estados de jobs (pending -> running -> pausado -> pending ...).
--    El CHECK original de V008 es inline sin nombre: Postgres lo llamo jobs_status_check.
alter table jobs drop constraint if exists jobs_status_check;
alter table jobs add constraint jobs_status_check
  check (status in ('pending', 'running', 'completed', 'failed', 'pausado'));

-- 2. Checkpoints de aprobacion.
create table if not exists aprobaciones_web (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            text not null,
  -- Job de tarea web pausado a la espera de esta decision. Sin FK on delete cascade a proposito:
  -- borrar el job (retencion V015) no debe borrar la constancia de la aprobacion en silencio.
  job_id              uuid not null,
  -- Conexion (sitios_conectados.id, V024) dentro de la cual ocurre la accion.
  connection_id       uuid not null,
  -- Sesion de navegador VIVA en el proveedor. Se persiste para reanudar LA MISMA sesion al aprobar:
  -- el estado del checkout se pierde si se reabre otra. (Aditivo sobre la especificacion: sin esta
  -- referencia la reanudacion en la misma sesion es imposible.)
  sesion_externa_id   text not null,
  accion_tipo         text not null check (accion_tipo in ('irreversible', 'financiera')),
  -- La accion propuesta en UNA linea de lenguaje natural (lo que el humano aprueba o rechaza).
  descripcion         text not null,
  -- Path en el bucket privado 'aprobaciones-web' del screenshot de lo que el agente veia al pausar.
  -- null = no se pudo capturar (best-effort); la decision sigue siendo posible con la descripcion.
  screenshot_path     text,
  estado              text not null default 'pendiente'
                        check (estado in ('pendiente', 'aprobada', 'rechazada', 'expirada')),
  -- Instruccion opcional del humano al rechazar: entra como mensaje del usuario y la tarea continua
  -- con ese ajuste (sin ejecutar la accion original).
  instruccion_rechazo text,
  -- Quien decidio (sub del JWT) y cuando. null mientras 'pendiente' o si expiro sin decision.
  decidida_por        text,
  decidida_en         timestamptz,
  creada_en           timestamptz not null default now(),
  -- Expiracion CORTA (default 15 min, configurable en el worker): una aprobacion vieja no debe poder
  -- disparar una accion sobre un estado de pagina que ya no existe.
  expira_en           timestamptz not null
);

create index if not exists aprobaciones_web_owner_idx on aprobaciones_web (owner_id, creada_en desc);
-- Cubre el barrido de vencidas del worker (estado = 'pendiente' and expira_en <= now()).
create index if not exists aprobaciones_web_vencidas_idx on aprobaciones_web (estado, expira_en);
-- Cubre la busqueda por job al reanudar (el worker re-reclama el job y busca su decision).
create index if not exists aprobaciones_web_job_idx on aprobaciones_web (job_id);

alter table aprobaciones_web enable row level security;

drop policy if exists "aprobaciones_web_select_own" on aprobaciones_web;
create policy "aprobaciones_web_select_own"
  on aprobaciones_web for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- 3. Registro de intervenciones humanas (GDPR Art.22): quien decidio, cuando, y QUE VIO (la
--    descripcion y el screenshot que se le mostraron). Una fila por decision (aprobada / rechazada)
--    y una por expiracion (constancia de que NO hubo intervencion a tiempo y la accion NO se ejecuto).
--    Mismo patron que las tablas de V014 (append-only, SELECT-own, escrituras server-side).
create table if not exists intervenciones_art22 (
  id              uuid primary key default gen_random_uuid(),
  owner_id        text not null,
  -- Encadenado a la aprobacion: on delete cascade (la constancia vive y muere con su checkpoint;
  -- el borrado de cuenta / erasure ARCO arrastra ambas).
  aprobacion_id   uuid not null references aprobaciones_web(id) on delete cascade,
  decision        text not null check (decision in ('aprobada', 'rechazada', 'expirada')),
  -- Quien intervino (sub del JWT). null SOLO en 'expirada' (nadie decidio: eso es lo que consta).
  decidida_por    text,
  -- Lo que el humano VIO al decidir: la descripcion de la accion y el path del screenshot.
  descripcion     text not null,
  screenshot_path text,
  instruccion     text,
  creada_en       timestamptz not null default now()
);

create index if not exists intervenciones_art22_owner_idx on intervenciones_art22 (owner_id, creada_en desc);

alter table intervenciones_art22 enable row level security;

drop policy if exists "intervenciones_art22_select_own" on intervenciones_art22;
create policy "intervenciones_art22_select_own"
  on intervenciones_art22 for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- 4. Bucket PRIVADO de Storage para los screenshots de aprobacion, con RLS por usuario (primera
--    carpeta del path = auth.uid()), mismo patron que 'adjuntos-chat'. El worker sube con el rol de
--    servicio (omite RLS); la consola solo LEE su propia carpeta via signed URL de vida corta.
--    La cascada ARCO/erasure borra los objetos junto con las filas (motor de borrado de cuenta).
insert into storage.buckets (id, name, public)
values ('aprobaciones-web', 'aprobaciones-web', false)
on conflict (id) do nothing;

drop policy if exists "aprobaciones_web_screenshots_select_own" on storage.objects;
create policy "aprobaciones_web_screenshots_select_own"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'aprobaciones-web' and (storage.foldername(name))[1] = auth.uid()::text);
