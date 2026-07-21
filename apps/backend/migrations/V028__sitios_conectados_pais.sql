-- PINNING POR PAIS (rework de la identidad de red de 7.1b/7.1d): dos columnas ADITIVAS sobre
-- sitios_conectados (V024) para que el criterio de continuidad de red sea el PAIS de salida, no la
-- IP exacta.
--
-- DECISION DE ARQUITECTURA: los proxies del pool gestionado de Browserbase son residenciales
-- ROTATIVOS: la IP cambia entre sesiones aunque la geolocalizacion pedida sea la misma, asi que
-- exigir la egress_ip exacta abortaba tareas perfectamente validas. Lo que un sitio destino evalua
-- para invalidar una sesion no es la IP exacta sino un salto geografico imposible (cambio de pais):
-- un cambio de IP dentro del mismo pais es invisible para el sitio. Por eso:
--
--   - proxy_country: pais (ISO 3166-1 alpha-2, mayusculas) PINEADO a (owner_id, dominio) al conectar
--     el sitio, derivado de la ubicacion del usuario. Toda sesion posterior (login de reconexion y
--     tarea web) se crea pidiendo esta geolocalizacion al proveedor y ABORTA si el pais de salida
--     observado difiere. Obligatorio para operar: una fila legada con proxy_country null exige
--     reconectar el sitio para pinear el pais (el worker rechaza tareas sin pais pineado).
--   - proxy_state: subdivision opcional (p.ej. estado de EEUU) para afinar la geolocalizacion en el
--     futuro. Hoy se persiste pero no se exige.
--
-- egress_ip (V024) SE CONSERVA como referencia INFORMATIVA y de observabilidad (se loguea por
-- sesion); deja de ser criterio de aborto. Para sitios de maxima seguridad (banca) el plan futuro es
-- migrar a proxies sticky dedicados; no en esta fase.
--
-- Operacion: se aplica A MANO en el SQL Editor de Supabase, DESPUES de V024/V025. IDEMPOTENTE:
-- re-aplicarlo es un NO-OP. Revertir es limpio (columnas nuevas sin FKs ni indices propios):
--   alter table sitios_conectados drop column if exists proxy_country;
--   alter table sitios_conectados drop column if exists proxy_state;

alter table sitios_conectados add column if not exists proxy_country text;
alter table sitios_conectados add column if not exists proxy_state text;

-- Defensa en profundidad del formato: pais ISO 3166-1 alpha-2 en mayusculas (o null en filas
-- legadas). El CHECK se recrea idempotente via drop previo (ADD CONSTRAINT no admite IF NOT EXISTS).
alter table sitios_conectados drop constraint if exists sitios_conectados_proxy_country_ck;
alter table sitios_conectados add constraint sitios_conectados_proxy_country_ck
  check (proxy_country is null or proxy_country ~ '^[A-Z]{2}$');
