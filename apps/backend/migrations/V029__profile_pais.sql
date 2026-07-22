-- PAIS DEL USUARIO EN EL PERFIL (cierra el circuito del pinning por pais de V028): una columna
-- ADITIVA sobre profiles para que el usuario DECLARE su pais una sola vez y toda conexion de sitio
-- pueda pinear la geolocalizacion del proxy sin depender de heuristicas del navegador.
--
-- CONTEXTO: V028 dejo el backend exigiendo un pais (ISO 3166-1 alpha-2) en POST /v1/sitios/conectar
-- para pinear proxy_country por (owner, dominio); pero no existia donde guardar el pais del usuario,
-- asi que toda conexion sin pais derivable fallaba con 400. Con esta columna:
--   - la consola pide el pais UNA vez (selector con la lista completa ISO 3166-1) y lo guarda aqui;
--   - POST /v1/sitios/conectar usa el pais del body y, si falta, cae al de este perfil;
--   - el pais es editable despues desde la configuracion del perfil.
--
-- El pais lo DECLARA el usuario: no hay geolocalizacion por IP ni servicios externos. Sirve a
-- usuarios de CUALQUIER pais (ningun default: null = aun no declarado).
--
-- Operacion: se aplica A MANO en el SQL Editor de Supabase, DESPUES de V005/V007/V021. IDEMPOTENTE:
-- re-aplicarlo es un NO-OP. Revertir es limpio (columna nueva sin FKs ni indices propios):
--   alter table profiles drop constraint if exists profiles_pais_ck;
--   alter table profiles drop column if exists pais;

alter table profiles add column if not exists pais text;

-- Defensa en profundidad del formato: pais ISO 3166-1 alpha-2 en mayusculas, o null (usuario que
-- aun no lo declaro). Mismo criterio que sitios_conectados.proxy_country (V028). El CHECK se
-- recrea idempotente via drop previo (ADD CONSTRAINT no admite IF NOT EXISTS).
alter table profiles drop constraint if exists profiles_pais_ck;
alter table profiles add constraint profiles_pais_ck
  check (pais is null or pais ~ '^[A-Z]{2}$');
