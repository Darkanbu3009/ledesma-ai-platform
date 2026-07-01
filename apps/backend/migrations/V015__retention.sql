-- RETENCION Y BORRADO (Fase 5.6). Define el mecanismo IN-DB de purga conservadora + los indices por edad
-- que hoy faltan. NO programa nada por si mismo (eso es V016, opt-in): este archivo es SQL puro y seguro
-- de aplicar siempre, igual que V010 define las funciones del scheduler sin activarlas.
--
-- Politica (espeja retention-policy.ts, el default conservador de la plataforma):
--   - agent_runs (V003, solo metadatos): se conservan p_agent_runs_days dias (default 365).
--   - jobs TERMINALES (completed/failed, V008): se conservan p_terminal_jobs_days dias desde finished_at
--     (default 90). Los jobs pending/running NUNCA se tocan.
-- Nada RECIENTE se borra: el corte es now() - intervalo. Subir los dias retiene mas; bajarlos, menos.
--
-- La MISMA politica esta implementada tambien en TypeScript (RetentionRepository.purgeExpired), que es la
-- via testeable y la que expone el endpoint admin (POST /v1/admin/retention/purge) y el erasure (Parte D).
-- Esta funcion SQL es la GEMELA para automatizar via pg_cron sin un proceso backend corriendo (V016).
--
-- Operacion: como el resto, se aplica A MANO en el SQL Editor de Supabase. IDEMPOTENTE: re-aplicarlo es un
-- NO-OP (create index if not exists, create or replace function).

-- Indices por edad para que la purga no haga table scan. agent_runs por created_at; jobs por (status,
-- finished_at) que cubre exactamente el filtro de la purga terminal.
create index if not exists agent_runs_created_at_idx on agent_runs (created_at);
create index if not exists jobs_status_finished_at_idx on jobs (status, finished_at);

-- Funcion de purga conservadora. Devuelve un jsonb con cuantas filas borro por tabla (para logs/inspeccion
-- del cron). SECURITY INVOKER (default): corre con los privilegios de quien la invoca (el rol de servicio o
-- el rol del cron), que ya omite RLS.
create or replace function retention_purge_expired(
  p_agent_runs_days integer default 365,
  p_terminal_jobs_days integer default 90
) returns jsonb
language plpgsql
as $$
declare
  v_agent_runs bigint;
  v_terminal_jobs bigint;
begin
  -- agent_runs mas viejos que la ventana (solo metadatos).
  with deleted as (
    delete from agent_runs
    where created_at < now() - make_interval(days => p_agent_runs_days)
    returning id
  )
  select count(*) into v_agent_runs from deleted;

  -- jobs TERMINALES ya finalizados y mas viejos que la ventana. El filtro por status es la salvaguarda:
  -- pending/running jamas se borran.
  with deleted as (
    delete from jobs
    where status in ('completed', 'failed')
      and finished_at is not null
      and finished_at < now() - make_interval(days => p_terminal_jobs_days)
    returning id
  )
  select count(*) into v_terminal_jobs from deleted;

  return jsonb_build_object('agent_runs', v_agent_runs, 'terminal_jobs', v_terminal_jobs);
end;
$$;
