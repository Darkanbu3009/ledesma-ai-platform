-- RESUMEN AGREGADO del dashboard (solo lectura): indice de apoyo para las agregaciones de agent_runs POR
-- OWNER. El endpoint GET /v1/dashboard (AgentRunRepository.totalsForOwner / runsByDayForOwner /
-- tokensByModelForOwner) consulta las corridas con
--   where owner_id = $1 [and created_at >= $2] [and created_at <= $3]  (+ group by dia | modelo)
-- El unico indice de V003 (agent_runs_agent_created_idx) es por agent_id, no por owner: sin un indice por
-- owner_id, estas agregaciones sobre todos los agentes del owner degradan a un seq scan + sort a medida
-- que agent_runs crece (hasta 365 dias de retencion). Este compuesto (owner_id, created_at desc) resuelve
-- el filtro por dueno Y el acote/orden por fecha con un solo indice, en linea con V017 para jobs.
--
-- ADITIVO y de SOLO LECTURA: no toca ninguna columna, dato, ni el camino de escritura de agent_runs
-- (worker/motor). Como el resto de las migraciones del repo, se aplica A MANO en el SQL Editor de Supabase
-- (ni el backend ni CI las ejecutan) y es IDEMPOTENTE: re-aplicarlo es un NO-OP.

create index if not exists agent_runs_owner_created_idx on agent_runs (owner_id, created_at desc);
