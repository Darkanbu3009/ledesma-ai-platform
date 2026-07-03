-- CONTABILIDAD de prompt caching en agent_runs. Con caching, el proveedor separa el input en tres cubos
-- con precios distintos: input pleno (1x, ya en input_tokens), escritura de cache (~1.25x) y lectura de
-- cache (~0.1x). Sin estas columnas, al activar el caching input_tokens baja (pasa a ser SOLO el input no
-- cacheado) y la fila perderia los tokens cacheados: agent_runs dejaria de reflejar la factura real. Estas
-- dos columnas capturan ese desglose para que el conteo siga completo y se pueda tarifar cada cubo.
--
-- ADITIVO y de bajo riesgo: columnas nuevas NOT NULL con default 0. Las filas viejas quedan en 0 (sin
-- caching) y el camino de escritura (RunRepository.record) las puebla; las lecturas del dashboard
-- (totales/serie/recientes) siguen sumando input_tokens/output_tokens sin cambios. Como el resto de las
-- migraciones del repo, se aplica A MANO en el SQL Editor de Supabase (ni el backend ni CI las ejecutan)
-- y es IDEMPOTENTE: re-aplicarla es un NO-OP.

alter table agent_runs
  add column if not exists cache_read_tokens integer not null default 0,
  add column if not exists cache_write_tokens integer not null default 0;
