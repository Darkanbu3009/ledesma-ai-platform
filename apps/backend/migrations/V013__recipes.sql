-- RECETAS de la EJECUCION AUTONOMA (Fase 5.5). Una receta es un FLUJO LINEAL MULTI-PASO: define QUE
-- agente correr, CON QUE credencial de la boveda, y una SECUENCIA ORDENADA de pasos (cada paso = UN
-- mensaje de texto / instruccion). El agente ejecuta los N pasos EN ORDEN; el output de un paso se
-- inyecta como contexto en el siguiente (el mecanismo de inyeccion es 5.5b). El agente y sus tools son
-- FIJOS para toda la receta.
--
-- Esta tabla es SOLO el MODELO DE DATOS (5.5a): define y persiste la secuencia de instrucciones. NO
-- ejecuta nada por si misma. El EJECUTOR multi-paso vive en el WORKER (apps/worker) y se construye en
-- 5.5b: un futuro disparador (manual/scheduler/trigger) materializara una corrida encolando UN job en
-- la cola `jobs` (V008) cuyo payload lleva el discriminador { kind: 'recipe', recipeId, steps } (ver
-- packages/shared/src/jobs/recipe-payload.ts). Ese payload viaja INTACTO por el mismo encolado que ya
-- usan el scheduler (V010) y los triggers (routes/incoming-triggers.ts), que copian jobs.payload sin
-- interpretarlo; por eso soportar recetas ahi no requiere tocar el encolado ni el worker en 5.5a.
--
-- CAMINO A (deliberado): UN job corre los N pasos internamente y el output de cada paso vive en memoria
-- durante la ejecucion. NO hay tracking de paso ni checkpoint: si el job se REINTENTA, RE-EJECUTA DESDE
-- EL PASO 1 (el reintento es del flujo completo, no desde el fallo). Esto se documenta aqui para que la
-- UI (5.5c) lo comunique; 5.5a no construye tracking de paso.
--
-- El molde es scheduled_tasks (V009) y triggers (V012): owner_id text, agent_id, credential_id,
-- is_active, RLS por owner, creacion/edicion SOLO server-side (pasa por el gate por tier 'autonomous' y
-- la validacion de pertenencia del backend).
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico: ni el backend ni CI las ejecutan). Este archivo es IDEMPOTENTE:
-- re-aplicarlo es un NO-OP y reproduce el mismo esquema en una base vacia.
--
-- Tenancy: owner_id = sub del JWT, IDENTICO a agents.owner_id (V001/V002), provider_credentials (V006),
-- jobs (V008), scheduled_tasks (V009) y triggers (V012). El backend se conecta con el rol de servicio
-- (pooler) que OMITE RLS; el aislamiento real es el WHERE owner_id de cada query del repositorio. Las
-- policies RLS de abajo son la segunda capa.

-- gen_random_uuid vive en pgcrypto; lo aseguran V006/V008/V009/V012, se repite aqui por si V013 se aplicara sola.
create extension if not exists pgcrypto;

create table if not exists recipes (
  id            uuid primary key default gen_random_uuid(),
  -- Dueno de la receta (sub del JWT). NOT NULL: una receta autonoma SIEMPRE tiene dueno.
  owner_id      text not null,
  -- Agente que ejecuta TODOS los pasos de la receta. on delete cascade (igual que jobs/scheduled_tasks/
  -- triggers): borrar el agente limpia sus recetas, y asi un disparo nunca encola un job para un agente
  -- inexistente.
  agent_id      uuid not null references agents(id) on delete cascade,
  -- QUE credencial de la boveda usar al ejecutar. Sin FK on delete (mismo criterio que jobs): si se
  -- borra la credencial, la receta queda y los jobs que encole fallaran limpio al resolverla (PR 5.2/5.5b),
  -- en vez de desaparecer en silencio.
  credential_id uuid not null,
  -- Nombre legible para que el usuario identifique la receta.
  name          text not null,
  -- Descripcion opcional (para que sirve la receta). Puede ser null.
  description   text,
  -- La SECUENCIA ORDENADA de pasos. Un array jsonb PRESERVA EL ORDEN de insercion, que es la esencia de
  -- una receta lineal: el paso i corre antes que el i+1. Cada paso = { "message": <texto> } (una
  -- instruccion). El CHECK de abajo exige que sea un array NO VACIO (>= 1 paso); el backend valida ademas
  -- que cada paso tenga contenido (Zod, routes/recipes.ts). Sin default: steps es obligatorio.
  steps         jsonb not null,
  -- Pausar/activar sin borrar: un disparo futuro solo consideraria las activas.
  is_active     boolean not null default true,
  -- Ultima vez que se materializo una corrida (job) para esta receta (ISO). null = nunca corrio. Lo
  -- setea el disparador de 5.5b al encolar; 5.5a solo declara la columna.
  last_run_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- steps DEBE ser un array jsonb con AL MENOS 1 paso. Defensa en profundidad junto a la validacion Zod
  -- del backend: aunque la creacion/edicion solo ocurre server-side, la base rechaza una receta sin pasos.
  -- El `jsonb_typeof(steps) = 'array'` corta antes de jsonb_array_length (AND corto-circuito) para no
  -- fallar si steps no fuera un array.
  constraint recipes_steps_non_empty check (
    jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) >= 1
  )
);

-- Indice por owner para el CRUD del usuario (listar sus recetas).
create index if not exists recipes_owner_id_idx on recipes (owner_id);

-- RLS por owner_id. recipes es una tabla OPERATIVA gestionada por la plataforma: la creacion y la
-- edicion JAMAS pasan por el cliente (ocurren server-side via el repositorio con el rol de servicio que
-- omite RLS), porque la CREACION debe pasar por el GATE POR TIER ('autonomous') y la validacion de
-- pertenencia del backend. Igual que jobs (V008), scheduled_tasks (V009) y triggers (V012), solo
-- exponemos SELECT al rol authenticated (para una futura vista "mis recetas", 5.5c). Exponer
-- INSERT/UPDATE via RLS permitiria saltarse el gate por tier insertando directo por PostgREST:
-- deliberadamente NO se hace.
alter table recipes enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.
drop policy if exists "recipes_select_own" on recipes;
create policy "recipes_select_own"
  on recipes for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));
