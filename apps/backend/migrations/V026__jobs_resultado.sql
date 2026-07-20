-- RESULTADO DE JOBS (Fase 7.1d): una columna ADITIVA sobre jobs (V008) para que un job pueda
-- DEVOLVER algo al que lo encolo. Hasta ahora la cola solo comunicaba estado + last_error; la tarea
-- web (kind:'tarea_web') necesita entregar el resultado de la navegacion a la tool del agente
-- (platform_revisar_tarea_en_sitio), que lo lee acotado por owner_id via JobsRepository.
--
--   - resultado: JSON con el desenlace que el worker guarda ANTES de markCompleted (p.ej.
--     { estado: 'ok' | 'requiere_aprobacion', resumen: ... }). null = el job no produjo resultado
--     (todos los jobs previos a 7.1d, y los que fallan).
--
-- NUNCA lleva credenciales ni contexto de sesion: el contexto sigue viviendo SOLO cifrado en
-- sitios_conectados.contexto_cifrado (V024). El worker sanea lo que guarda (solo texto de resumen).
--
-- Operacion: se aplica A MANO en el SQL Editor de Supabase, DESPUES de V008. IDEMPOTENTE:
-- re-aplicarlo es un NO-OP. Revertir: alter table jobs drop column if exists resultado;

alter table jobs add column if not exists resultado jsonb;
