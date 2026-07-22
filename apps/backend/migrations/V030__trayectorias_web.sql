-- TRAYECTORIAS DE TAREAS WEB (Fase F, paso 1 de 2): registro de QUE hizo el agente de navegacion
-- (Stagehand) en cada tarea web, accion por accion, para poder PROMOVER despues los flujos exitosos a
-- recetas deterministas (paso 2, PR futuro). Este esquema SOLO registra y se muestra en la consola; no
-- hay promocion ni replay todavia.
--
-- Dos tablas:
--  1. trayectorias_web: una fila por EJECUCION del motor de navegacion (una tarea puede tener mas de
--     una si paso por un checkpoint de aprobacion 7.1e: la corrida inicial queda 'pausada' y la
--     reanudacion genera otra trayectoria). Lleva el desenlace, la duracion y los tokens consumidos.
--  2. pasos_trayectoria: una fila por ACCION ejecutada (act, goto, extract, scroll, ...), con el
--     selector que resolvio Stagehand, la URL donde ocurrio y el valor tecleado YA CENSURADO.
--
-- PRIVACIDAD (los pasos pueden contener datos personales del usuario):
--  - El worker construye `accion` por WHITELIST de campos (tipo, instruccion, metodo, argumentos) y
--    TODO valor pasa por la funcion de censura (apps/worker/src/censura.ts) ANTES del insert: valores
--    de campos sensibles (password, tarjetas, tokens) JAMAS llegan a esta tabla.
--  - Retencion ACOTADA: default 30 dias (trayectorias_purge_expired abajo; configurable via
--    RETENTION_TRAYECTORIAS_WEB_DAYS en el backend). Mucho mas corta que jobs (90) porque el contenido
--    es mas sensible.
--  - Borrado ARCO: el motor de borrado de cuenta (account-deletion-repository.ts) borra
--    trayectorias_web por owner_id y la FK on delete cascade arrastra los pasos.
--
-- Tenancy: owner_id = sub del JWT (text), IDENTICO a jobs.owner_id (V008) y aprobaciones_web (V027).
-- El backend/worker escriben con el rol de servicio (omite RLS); el aislamiento real es el WHERE
-- owner_id de cada query del repositorio. Las policies RLS (solo SELECT propio) son la segunda capa.
--
-- Sin FK a jobs ni a sitios_conectados A PROPOSITO (mismo criterio que aprobaciones_web V027): la
-- retencion de jobs (V015, 90 dias) y la desconexion de un sitio no deben borrar la trayectoria en
-- silencio; la trayectoria tiene su PROPIA retencion (mas corta) y su propio borrado ARCO.
--
-- Operacion: como el resto de las migraciones, se aplica A MANO en el SQL Editor de Supabase.
-- IDEMPOTENTE: re-aplicarla es un no-op. REVERSION limpia (en orden):
--   drop function if exists trayectorias_purge_expired(integer);
--   drop table if exists pasos_trayectoria;
--   drop table if exists trayectorias_web;

create extension if not exists pgcrypto;

-- 1. Una ejecucion del motor de navegacion dentro de una tarea web.
create table if not exists trayectorias_web (
  id            uuid primary key default gen_random_uuid(),
  owner_id      text not null,
  -- Job de tarea web (V008) que origino esta ejecucion. Sin FK (ver cabecera).
  job_id        uuid not null,
  -- Conexion (sitios_conectados.id, V024) dentro de la cual corrio la tarea. Sin FK (ver cabecera).
  connection_id uuid not null,
  dominio       text not null,
  -- Objetivo en lenguaje natural del usuario, ya pasado por la censura de texto (numeros de tarjeta).
  objetivo      text not null,
  -- Desenlace de ESTA ejecucion del motor: 'exitosa' (tarea completada), 'fallida' (limite de pasos,
  -- error del motor o sesion caducada; los pasos registrados llegan hasta donde llego) o 'pausada'
  -- (checkpoint de aprobacion 7.1e: la reanudacion genera OTRA trayectoria).
  estado        text not null check (estado in ('exitosa', 'fallida', 'pausada')),
  iniciada_en   timestamptz not null,
  terminada_en  timestamptz not null,
  duracion_ms   integer not null check (duracion_ms >= 0),
  -- Tokens consumidos por el modelo en esta ejecucion (usage del motor). null = no reportados.
  tokens_in     integer,
  tokens_out    integer,
  creada_en     timestamptz not null default now()
);

-- Listado por owner (pagina de actividad) y busqueda por job (la UI abre una tarea concreta).
create index if not exists trayectorias_web_owner_idx on trayectorias_web (owner_id, iniciada_en desc);
create index if not exists trayectorias_web_job_idx on trayectorias_web (job_id);
-- Cubre la purga por retencion (terminada_en < corte) sin table scan.
create index if not exists trayectorias_web_terminada_idx on trayectorias_web (terminada_en);

alter table trayectorias_web enable row level security;

drop policy if exists "trayectorias_web_select_own" on trayectorias_web;
create policy "trayectorias_web_select_own"
  on trayectorias_web for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- 2. Una accion ejecutada dentro de una trayectoria, en orden (idx desde 0).
create table if not exists pasos_trayectoria (
  id              uuid primary key default gen_random_uuid(),
  -- on delete cascade: los pasos viven y mueren con su trayectoria (retencion y ARCO borran la
  -- cabecera y la base arrastra los pasos).
  trayectoria_id  uuid not null references trayectorias_web(id) on delete cascade,
  idx             integer not null check (idx >= 0),
  -- Accion CENSURADA construida por whitelist en el worker: { tipo, instruccion, metodo, argumentos }.
  -- JAMAS el objeto crudo del motor (podria arrastrar contenido de pagina o valores sensibles).
  accion          jsonb not null,
  -- Selector que resolvio Stagehand (xpath/css) sobre el que actuo. null en acciones sin elemento
  -- (goto, scroll, extract, ...). Es el insumo clave para promover a receta (PR futuro).
  selector        text,
  -- Valor tecleado, YA pasado por la funcion de censura del worker: en campos sensibles (password,
  -- tarjeta, token) se guarda el marcador de censura, nunca el valor. null en acciones sin tecleo.
  valor_censurado text,
  -- URL de la pagina donde ocurrio la accion.
  url             text,
  exito           boolean,
  creado_en       timestamptz not null default now()
);

-- Un paso por posicion dentro de su trayectoria; cubre ademas la lectura ordenada de los pasos.
create unique index if not exists pasos_trayectoria_orden_uniq on pasos_trayectoria (trayectoria_id, idx);

alter table pasos_trayectoria enable row level security;

-- Los pasos no llevan owner_id propio: el dueno es el de su trayectoria (subquery sobre la cabecera).
drop policy if exists "pasos_trayectoria_select_own" on pasos_trayectoria;
create policy "pasos_trayectoria_select_own"
  on pasos_trayectoria for select
  to authenticated
  using (
    exists (
      select 1 from trayectorias_web t
      where t.id = pasos_trayectoria.trayectoria_id
        and t.owner_id = (auth.jwt() ->> 'sub')
    )
  );

-- 3. Purga por retencion (default 30 dias), GEMELA SQL de la purga TypeScript del backend
--    (RetentionRepository.purgeTrayectoriasWebOlderThan), mismo patron que retention_purge_expired
--    (V015): SQL puro que NO se programa solo (pg_cron es opt-in, V016). Borra las trayectorias
--    TERMINADAS antes del corte; el cascade arrastra los pasos.
create or replace function trayectorias_purge_expired(
  p_trayectorias_days integer default 30
) returns jsonb
language plpgsql
as $$
declare
  v_trayectorias bigint;
begin
  with deleted as (
    delete from trayectorias_web
    where terminada_en < now() - make_interval(days => p_trayectorias_days)
    returning id
  )
  select count(*) into v_trayectorias from deleted;

  return jsonb_build_object('trayectorias_web', v_trayectorias);
end;
$$;
