-- ACTIVACION del disparo por horario (pg_cron). SE ENTREGA POR SEPARADO de las funciones (V010) A
-- PROPOSITO: este paso requiere PRIVILEGIOS DE OPERADOR (habilitar una extension de Postgres) y se hace
-- UNA SOLA VEZ por base. Las funciones de V010 son SQL puro y se aplican siempre; ESTO las pone a correr.
--
-- ORDEN OBLIGATORIO: aplicar V009 (tabla) y V010 (funciones) ANTES que este archivo. cron.schedule de
-- abajo invoca enqueue_due_scheduled_tasks(), que debe existir ya.
--
-- =============================================================================================
-- PASO MANUAL DEL OPERADOR (una sola vez): habilitar la extension pg_cron.
-- ---------------------------------------------------------------------------------------------
-- En Supabase, pg_cron NO viene activada por defecto. Dos formas equivalentes de habilitarla:
--   (a) Dashboard: Database > Extensions > buscar "pg_cron" > Enable. (Recomendado en Supabase.)
--   (b) SQL (requiere rol con privilegio de superusuario/owner, p.ej. en el SQL Editor):
--         create extension if not exists pg_cron;
-- pg_cron corre sus jobs en la base donde se creo la extension (en Supabase, normalmente `postgres`),
-- la MISMA donde viven scheduled_tasks/jobs y las funciones de V010. Si tu proyecto usa otra base,
-- crea la extension y programa el job en esa misma base.
-- =============================================================================================

-- Idempotente: intenta crear la extension (no-op si ya existe). En un entorno donde el rol del SQL
-- Editor no tenga permiso para create extension, este statement fallara: usa la via (a) del Dashboard y
-- luego re-aplica desde el bloque cron.schedule de abajo.
create extension if not exists pg_cron;

-- Programa enqueue_due_scheduled_tasks() para correr CADA MINUTO ('* * * * *'). Idempotente: si el job
-- ya existe (re-aplicacion), primero lo des-programa y luego lo vuelve a crear, para no duplicarlo.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'enqueue-due-scheduled-tasks') then
    perform cron.unschedule('enqueue-due-scheduled-tasks');
  end if;
end
$$;

select cron.schedule(
  'enqueue-due-scheduled-tasks',
  '* * * * *',
  $$select enqueue_due_scheduled_tasks();$$
);

-- Para VERIFICAR que quedo programado:
--   select jobid, jobname, schedule, command, active from cron.job where jobname = 'enqueue-due-scheduled-tasks';
-- Para DESACTIVARLO mas adelante:
--   select cron.unschedule('enqueue-due-scheduled-tasks');
