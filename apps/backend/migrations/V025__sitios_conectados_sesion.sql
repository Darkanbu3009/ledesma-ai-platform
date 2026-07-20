-- SESION DE NAVEGADOR EN VUELO (Fase 7.1b): dos columnas ADITIVAS sobre sitios_conectados (V024)
-- para que el flujo de login manual sea reanudable entre jobs:
--
--   - sesion_externa_id: id de la SESION de navegador en el proveedor externo (Browserbase) que
--     conectar_sitio dejo abierta para el login manual. confirmar_conexion RECONECTA por este id
--     para heredar el contexto; el barrido lo usa para CERRAR sesiones abandonadas. Se limpia al
--     confirmar o al expirar: solo esta poblado mientras hay una sesion viva del lado del proveedor.
--   - vista_en_vivo_url: URL de la vista en vivo de esa sesion. Es el ENTREGABLE de conectar_sitio
--     hacia la UI (7.1c): el usuario la abre e interactua DIRECTAMENTE contra el proveedor, sin
--     pasar por el worker. La cola jobs (V008) no tiene columna de resultado: el resultado del job
--     ES esta fila, y la UI la lee via el repositorio/RLS de V024.
--
-- NINGUNA de las dos es una credencial: la vista en vivo exige la sesion viva del proveedor (muere
-- sola por timeout) y el id de sesion no autentica nada por si mismo. El contexto heredado, que SI
-- es credencial, sigue viviendo SOLO cifrado en contexto_cifrado (V024).
--
-- Operacion: se aplica A MANO en el SQL Editor de Supabase, DESPUES de V024. IDEMPOTENTE:
-- re-aplicarlo es un NO-OP. Revertir: alter table sitios_conectados drop column if exists ... ;

alter table sitios_conectados add column if not exists sesion_externa_id text;
alter table sitios_conectados add column if not exists vista_en_vivo_url text;

-- Barrido del worker (7.1b): busca 'esperando_login' viejos SIN acotar por owner (recorre todos los
-- tenants; es una tarea de plataforma, como el reaper de jobs). El indice de V024 arranca por
-- owner_id y no sirve; este cubre exactamente ese filtro por estado + antiguedad.
create index if not exists sitios_conectados_estado_creado_idx on sitios_conectados (estado, creado_en);
