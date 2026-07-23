-- ACTIVACION de la PURGA periodica de la coordinacion del relay (pg_cron). SE ENTREGA POR SEPARADO de la
-- funcion (V031) A PROPOSITO, igual que V011 se separa de V010 y V016 de V015: programar el barrido es un
-- paso DELIBERADO del operador (habilita una extension de Postgres) y se hace UNA SOLA VEZ por base.
--
-- POR QUE ES NECESARIA (NEW-4): las tablas relay_jti_consumidos y relay_conexiones_activas crecen SIN
-- LIMITE si nada las purga. El consumo del jti y la toma del lock son INSERT; ninguna ruta de la aplicacion
-- borra, y una fila VENCIDA sigue ocupando espacio hasta que esta purga la elimine. Que el token/lock deje
-- de ser VALIDO a los <= 15 min NO achica la tabla. Sin este cron, cada handshake deja un registro para
-- siempre. Con el, el barrido corre cada 10 minutos y las tablas quedan acotadas a la ventana viva.
--
-- ORDEN OBLIGATORIO: aplicar V031 (funcion relay_coordinacion_purgar) ANTES que este archivo. El
-- cron.schedule de abajo la invoca y debe existir ya.
--
-- =============================================================================================
-- PASO MANUAL DEL OPERADOR (una sola vez): habilitar la extension pg_cron.
-- ---------------------------------------------------------------------------------------------
-- En Supabase, pg_cron NO viene activada por defecto: Dashboard > Database > Extensions > "pg_cron" >
-- Enable, o (con rol superusuario) `create extension if not exists pg_cron;`. Si ya la activaste para el
-- scheduler (V011) o la retencion (V016), este paso ya esta hecho: pg_cron es una sola extension por base.
-- =============================================================================================

-- Idempotente: no-op si ya existe (p.ej. activada por V011/V016).
create extension if not exists pg_cron;

-- Programa la purga para correr CADA 10 MINUTOS ('*/10 * * * *'): las filas viven una ventana de <= 15 min,
-- asi que un barrido cada 10 min mantiene las tablas chicas sin castigar la base. Idempotente: des-programa
-- antes de volver a crear, para no duplicar el job.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'relay-coordinacion-purgar') then
    perform cron.unschedule('relay-coordinacion-purgar');
  end if;
end
$$;

select cron.schedule(
  'relay-coordinacion-purgar',
  '*/10 * * * *',
  $$select relay_coordinacion_purgar();$$
);

-- Para VERIFICAR que quedo programado:
--   select jobid, jobname, schedule, command, active from cron.job where jobname = 'relay-coordinacion-purgar';
-- Para DESACTIVARLO mas adelante (dejar de purgar automaticamente):
--   select cron.unschedule('relay-coordinacion-purgar');
