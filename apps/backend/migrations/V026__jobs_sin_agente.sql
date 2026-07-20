-- JOBS SIN AGENTE NI CREDENCIAL (Fase 7.1c). Los jobs de SITIOS CONECTADOS (kind:'conectar_sitio',
-- 'confirmar_conexion' y 'desconectar_sitio'; ver packages/shared/src/jobs/sitio-payload.ts) NO
-- ejecutan ningun modelo: hay un humano manejando el navegador remoto y el worker solo orquesta
-- (7.1b ramifica ANTES de resolver agente/credencial, ver apps/worker/src/execution.ts). Por eso no
-- tienen agente que ejecutar ni credencial de la boveda que usar, y las columnas agent_id /
-- credential_id de V008 (hasta hoy NOT NULL) pasan a admitir NULL.
--
-- Alcance MINIMO a proposito:
--  - Solo se relaja la nulabilidad. La FK de agent_id -> agents(id) on delete cascade queda intacta:
--    un agent_id presente sigue teniendo que existir; NULL simplemente no participa de la FK.
--  - Los jobs simples y de receta SIGUEN escribiendo ambos ids (el codigo que los encola no cambia).
--    El worker ademas se defiende: un job NO-sitio con ids nulos falla permanente con mensaje claro.
--  - RLS/policies de V008 no cambian (el select propio filtra por owner_id, no por agente).
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase. Este archivo es IDEMPOTENTE: DROP NOT NULL sobre una columna ya nullable es un NO-OP.

alter table jobs alter column agent_id drop not null;
alter table jobs alter column credential_id drop not null;
