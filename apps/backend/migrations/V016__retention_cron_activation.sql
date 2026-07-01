-- ACTIVACION OPT-IN de la retencion automatica (pg_cron). SE ENTREGA POR SEPARADO de la funcion (V015) A
-- PROPOSITO, igual que V011 se separa de V010: activar el borrado periodico es una decision DELIBERADA del
-- operador (la politica es conservadora pero borra datos). Aplicar este archivo es OPCIONAL: sin el, la
-- retencion solo corre a demanda via el endpoint admin (POST /v1/admin/retention/purge). Con el, ademas
-- corre sola cada dia.
--
-- ORDEN OBLIGATORIO: aplicar V015 (funcion retention_purge_expired) ANTES que este archivo. El
-- cron.schedule de abajo la invoca y debe existir ya.
--
-- =============================================================================================
-- PASO MANUAL DEL OPERADOR (una sola vez): habilitar la extension pg_cron.
-- ---------------------------------------------------------------------------------------------
-- En Supabase, pg_cron NO viene activada por defecto: Dashboard > Database > Extensions > "pg_cron" >
-- Enable, o (con rol superusuario) `create extension if not exists pg_cron;`. Si ya la activaste para el
-- scheduler (V011), este paso ya esta hecho: pg_cron es una sola extension por base.
-- =============================================================================================

-- Idempotente: no-op si ya existe (p.ej. activada por V011).
create extension if not exists pg_cron;

-- Programa la purga para correr DIARIAMENTE a las 03:00 UTC ('0 3 * * *'): una hora de baja carga, lejos
-- del disparo por minuto del scheduler. Conservador: una vez al dia basta para una ventana de dias.
-- Idempotente: des-programa antes de volver a crear, para no duplicar el job.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'retention-purge-expired') then
    perform cron.unschedule('retention-purge-expired');
  end if;
end
$$;

-- Usa los defaults conservadores de la funcion (365 dias agent_runs, 90 dias jobs terminales). Para
-- ajustar la ventana, pasa argumentos explicitos: retention_purge_expired(180, 30).
select cron.schedule(
  'retention-purge-expired',
  '0 3 * * *',
  $$select retention_purge_expired();$$
);

-- Para VERIFICAR que quedo programado:
--   select jobid, jobname, schedule, command, active from cron.job where jobname = 'retention-purge-expired';
-- Para DESACTIVARLO mas adelante (dejar de borrar automaticamente):
--   select cron.unschedule('retention-purge-expired');
