-- OBSERVABILIDAD de la ejecucion autonoma (solo lectura): indice de apoyo para el HISTORIAL de jobs por
-- usuario. El endpoint GET /v1/jobs (JobsRepository.listByOwner) consulta la cola con
--   where owner_id = $1 [and status = $2] order by created_at desc limit $n offset $m
-- Los indices de V008 (jobs_status_idx, jobs_scheduled_for_idx, jobs_pending_claim_idx) sirven al CLAIM
-- del worker, no a este acceso por dueno: sin un indice por owner_id, listar el historial degrada a un
-- scan + sort a medida que la cola crece. Este compuesto (owner_id, created_at desc) resuelve el filtro
-- por dueno Y el orden descendente por fecha con un solo indice.
--
-- ADITIVO y de SOLO LECTURA: no toca ninguna columna, dato, ni el camino de escritura de la cola (worker/
-- scheduler/triggers). Como el resto de las migraciones del repo, se aplica A MANO en el SQL Editor de
-- Supabase (ni el backend ni CI las ejecutan) y es IDEMPOTENTE: re-aplicarlo es un NO-OP.

create index if not exists jobs_owner_created_idx on jobs (owner_id, created_at desc);
