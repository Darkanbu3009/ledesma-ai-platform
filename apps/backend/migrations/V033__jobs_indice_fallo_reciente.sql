-- INDICE de la BARRERA ANTI RELANZAMIENTO (BUG A): la consulta
-- JobsRepository.existeFalloPermanenteReciente busca, por cada intento de encolar una tarea web via
-- platform_ejecutar_tarea_en_sitio, un job 'failed' RECIENTE del mismo owner sobre la misma conexion
-- (payload->>'connectionId'), excluyendo cancelaciones. Sin indice, esa consulta recorre todos los
-- jobs failed del owner en cada llamada de la tool.
--
-- Indice PARCIAL a proposito: solo filas failed de tarea web (la barrera no mira otros estados ni
-- otros kinds), asi el indice queda chico y el resto de la tabla no paga el costo de mantenerlo.
--
-- Operacion: como el resto de las migraciones, se aplica A MANO en el SQL Editor de Supabase.
-- IDEMPOTENTE: re-aplicarla es un no-op. REVERSION limpia:
--   drop index if exists idx_jobs_tarea_web_fallo_reciente;

create index if not exists idx_jobs_tarea_web_fallo_reciente
  on jobs (owner_id, (payload->>'connectionId'), finished_at desc)
  where status = 'failed' and (payload->>'kind') = 'tarea_web';
