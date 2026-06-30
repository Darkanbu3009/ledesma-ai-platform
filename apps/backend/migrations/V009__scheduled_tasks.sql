-- TAREAS PROGRAMADAS de la EJECUCION AUTONOMA (Fase 5.3). Esta tabla DEFINE LOS HORARIOS de ejecucion
-- autonoma: cada fila dice QUE agente correr, CON QUE credencial de la boveda, CON QUE mensaje fijo y
-- EN QUE horario (cron). NO ejecuta nada por si misma: el disparo por horario (pg_cron, V010) la
-- CONSUME cada minuto, y por cada tarea cuyo horario llego ENCOLA un job en la cola `jobs` (V008) que
-- el worker (5.2) ya sabe ejecutar. Asi el scheduler solo PRODUCE jobs; no toca el motor ni el worker.
--
-- Relacion con `jobs`: una tarea programada es la PLANTILLA recurrente; cada disparo materializa UNA
-- corrida como un job 'pending' (copia agent_id, owner_id, credential_id, payload). Borrar la tarea NO
-- borra los jobs ya encolados (son corridas independientes ya en vuelo).
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico: ni el backend ni CI las ejecutan). Este archivo es IDEMPOTENTE:
-- re-aplicarlo es un NO-OP y reproduce el mismo esquema en una base vacia.
--
-- Tenancy: owner_id = sub del JWT, IDENTICO a agents.owner_id (V001/V002), provider_credentials (V006)
-- y jobs (V008). El backend se conecta con el rol de servicio (pooler) que OMITE RLS; el aislamiento
-- real es el WHERE owner_id de cada query del repositorio. Las policies RLS de abajo son la segunda capa.

-- gen_random_uuid vive en pgcrypto; lo aseguran V006/V008, se repite aqui por si V009 se aplicara sola.
create extension if not exists pgcrypto;

create table if not exists scheduled_tasks (
  id              uuid primary key default gen_random_uuid(),
  -- Dueno de la tarea (sub del JWT). NOT NULL: una tarea autonoma SIEMPRE tiene dueno.
  owner_id        text not null,
  -- Agente a ejecutar. on delete cascade (igual que jobs): borrar el agente limpia sus tareas
  -- programadas, y asi el disparo nunca intenta encolar un job para un agente inexistente.
  agent_id        uuid not null references agents(id) on delete cascade,
  -- QUE credencial de la boveda usar al ejecutar. Sin FK on delete (mismo criterio que jobs): si se
  -- borra la credencial, la tarea queda y los jobs que encole fallaran limpio al resolverla (PR 5.2),
  -- en vez de desaparecer en silencio.
  credential_id   uuid not null,
  -- Horario en formato cron estandar de 5 campos (minuto hora dia-mes mes dia-semana), interpretado en
  -- UTC. El backend VALIDA el formato antes de insertar (apps/backend/src/scheduling/cron.ts); como la
  -- insercion solo ocurre server-side (RLS no expone INSERT), cron_expression aqui siempre es valido.
  cron_expression text not null,
  -- Mensajes/input fijos que se ejecutan cada vez (mismo shape que el payload de un job: { messages }).
  payload         jsonb not null default '{}'::jsonb,
  -- Pausar/activar sin borrar: el disparo solo considera las activas.
  is_active       boolean not null default true,
  -- Cuando corrio por ultima vez (el disparo lo setea a now() al encolar). null = nunca corrio.
  last_run_at     timestamptz,
  -- Cuando toca correr la proxima vez. Lo calcula el backend desde el cron al crear/editar, y el
  -- disparo lo AVANZA al siguiente match tras encolar (V010). null = sin proximo run (cron imposible o
  -- en pausa permanente): el disparo nunca selecciona una tarea con next_run_at null.
  next_run_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Indice por owner para el CRUD del usuario (listar sus tareas).
create index if not exists scheduled_tasks_owner_id_idx on scheduled_tasks (owner_id);
-- Indice del DISPARO: cubre exactamente su consulta caliente
-- (where is_active = true and next_run_at is not null and next_run_at <= now()): Postgres resuelve el
-- filtro por is_active + el orden/comparacion por next_run_at con un solo indice compuesto.
create index if not exists scheduled_tasks_due_idx on scheduled_tasks (is_active, next_run_at);

-- RLS por owner_id. scheduled_tasks es una tabla OPERATIVA gestionada por la plataforma: la creacion y
-- la edicion JAMAS pasan por el cliente (ocurren server-side via el repositorio con el rol de servicio
-- que omite RLS), porque la CREACION debe pasar por el GATE POR TIER y la validacion de pertenencia del
-- backend. Por eso, igual que jobs (V008), solo exponemos SELECT al rol authenticated (un usuario podra
-- ver SUS tareas; p.ej. una vista "mis tareas programadas" en 5.3b). Exponer INSERT/UPDATE via RLS
-- permitiria saltarse el gate por tier insertando directo por PostgREST: deliberadamente NO se hace.
alter table scheduled_tasks enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.
drop policy if exists "scheduled_tasks_select_own" on scheduled_tasks;
create policy "scheduled_tasks_select_own"
  on scheduled_tasks for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));
