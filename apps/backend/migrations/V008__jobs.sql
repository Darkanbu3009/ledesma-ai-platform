-- COLA DE TAREAS de la EJECUCION AUTONOMA (Fase 5). A diferencia de agent_runs (V003), que es
-- AUDITORIA de solo lectura con estados terminales (completed/error/aborted), esta tabla SI es una
-- COLA de trabajo: una fila nace en 'pending', un worker la toma a 'running' y la cierra en
-- 'completed' o 'failed'. Es el vinculo PERSISTIDO tarea -> agente -> credencial que hoy falta: el
-- run sincronico (/v1/run/:agentId) resuelve la credencial de un header en el momento; un job, en
-- cambio, debe recordar QUE credencial de la boveda usar para ejecutar sin un humano presente.
--
-- ALCANCE DE ESTE PR (5.1): solo la tabla y su repositorio. El SCHEDULER que dispara por horario
-- (pg_cron / scheduled_for) es PR 5.3; los TRIGGERS entrantes que encolan jobs son PR 5.4; el WORKER
-- que CONSUME la cola y ejecuta el agente de verdad es PR 5.2. scheduled_for ya existe aqui para
-- preparar el terreno del scheduler, pero nada lo dispara todavia.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico: ni el backend ni CI las ejecutan). Este archivo es IDEMPOTENTE:
-- re-aplicarlo es un NO-OP y reproduce el mismo esquema en una base vacia.
--
-- Tenancy: owner_id = sub del JWT, IDENTICO a agents.owner_id (V001/V002) y provider_credentials
-- (V006). El backend/worker se conectan con el rol de servicio (pooler) que OMITE RLS; el aislamiento
-- real es el WHERE owner_id de cada query del repositorio. Las policies RLS de abajo son la segunda
-- capa.

-- gen_random_uuid vive en pgcrypto; V006 ya lo asegura, se repite aqui por si V008 se aplicara sola.
create extension if not exists pgcrypto;

create table if not exists jobs (
  id            uuid primary key default gen_random_uuid(),
  -- A QUE agente ejecutar. on delete cascade: borrar el agente limpia sus jobs encolados.
  agent_id      uuid not null references agents(id) on delete cascade,
  -- Dueno de la tarea (sub del JWT). NOT NULL a proposito: un job autonomo SIEMPRE tiene dueno, a
  -- diferencia de agents/agent_runs donde owner_id es nullable por filas admin historicas.
  owner_id      text not null,
  -- QUE credencial de la boveda (provider_credentials.id) usar al ejecutar. El vinculo persistido que
  -- hoy falta: sin un humano que pegue la key, el worker la resuelve de la boveda por owner+credential.
  -- Sin FK on delete: si se borra la credencial, el job queda y fallara limpio al intentar resolverla
  -- (PR 5.2), en vez de desaparecer en silencio de la cola.
  credential_id uuid not null,
  -- Estados REALES de cola (no solo terminales como agent_runs): pending -> running -> completed|failed.
  status        text not null default 'pending'
                  check (status in ('pending', 'running', 'completed', 'failed')),
  -- Mensajes/input de la tarea (mismo shape que el body de /v1/run/:agentId: { messages, ... }).
  payload       jsonb not null default '{}'::jsonb,
  -- Cuando debe ejecutarse. NULL = ASAP (apenas haya worker libre). Terreno para el scheduler (PR 5.3):
  -- el worker filtrara por scheduled_for is null or scheduled_for <= now().
  scheduled_for timestamptz,
  -- Reintentos: el claim incrementa attempts; last_error guarda el detalle del ultimo fallo (PR 5.2).
  attempts      integer not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- started_at: cuando un worker tomo el job (claim). finished_at: cuando llego a un estado terminal.
  started_at    timestamptz,
  finished_at   timestamptz
);

-- Indices para que el worker consulte la cola eficientemente. El compuesto cubre el claim real
-- (where status = 'pending' and (scheduled_for is null or scheduled_for <= now()) order by created_at):
-- Postgres puede resolver el filtro por status + scheduled_for y el orden por created_at con un solo
-- indice. Los dos simples sirven a consultas operativas por estado o por horario.
create index if not exists jobs_status_idx on jobs (status);
create index if not exists jobs_scheduled_for_idx on jobs (scheduled_for);
create index if not exists jobs_pending_claim_idx on jobs (status, scheduled_for, created_at);

-- RLS por owner_id. jobs es una tabla OPERATIVA gestionada por la plataforma (el backend/worker la
-- escriben con el rol de servicio que omite RLS), igual que agent_runs: por eso solo exponemos SELECT
-- al rol authenticated (un usuario podra ver el estado de SUS tareas; p.ej. una vista "mis tareas
-- programadas"). La creacion y las transiciones de estado JAMAS pasan por el cliente: ocurren
-- server-side via el repositorio. El aislamiento principal sigue siendo el WHERE owner_id del repo.
alter table jobs enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.
drop policy if exists "jobs_select_own" on jobs;
create policy "jobs_select_own"
  on jobs for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));
