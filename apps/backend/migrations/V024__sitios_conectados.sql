-- SITIOS CONECTADOS (Fase 7.1a): el MODELO DE DATOS de la capacidad de que un agente opere DENTRO de
-- la cuenta de un usuario en una plataforma web. Un "sitio conectado" es un dominio en el que el
-- usuario YA inicio sesion EL MISMO (el login JAMAS se automatiza: ocurre en una vista en vivo del
-- navegador; la plataforma nunca ve ni almacena su contrasena) y del que se hereda la SESION:
-- cookies y storage del navegador, cifrados en reposo.
--
-- Esta tabla es SOLO datos (7.1a). El EJECUTOR que crea la sesion de navegador, muestra la vista en
-- vivo y hereda el contexto es 7.1b; la UI es 7.1c. Ninguno existe todavia y esta migracion no los
-- necesita.
--
-- SEGURIDAD (el punto central de la tabla):
--   - NO existe ninguna columna de contrasena, ni existira: el login lo teclea el usuario en el
--     navegador real. Lo que se guarda es el CONTEXTO DE SESION resultante (cookies/storage).
--   - contexto_cifrado guarda ese contexto SIEMPRE cifrado con AES-256-GCM bajo VAULT_SECRET
--     (src/crypto/aes-gcm.ts, el MISMO modulo de la boveda de credenciales V006). Las cookies de
--     sesion de un tercero SON credenciales: valen lo mismo que la contrasena que se evito guardar.
--     El cifrado/descifrado ocurre EXCLUSIVAMENTE server-side (repositorio); en bytea viven los
--     bytes iv | tag | ciphertext que empaqueta ese modulo.
--   - proxy_ref / egress_ip pinean la IDENTIDAD DE RED con la que se establecio la sesion: reusar
--     la sesion desde otra IP invalida la sesion del usuario y dispara verificaciones en su cuenta.
--     7.1b DEBE abortar si la salida observada difiere de la pineada; aqui solo se persiste.
--
-- Ciclo de vida (columna estado):
--   'esperando_login' -> registro creado, sesion de navegador abierta, el usuario aun no confirma.
--   'activo'          -> el usuario confirmo; el contexto quedo cifrado y la sesion es heredable.
--   'caducado'        -> el sitio invalido la sesion (expira_en vencido o rechazo observado).
--   'error'           -> el establecimiento fallo (timeout sin confirmar, sesion irrecuperable).
--
-- Tenancy: owner_id = sub del JWT, IDENTICO a agents.owner_id (V001/V002), provider_credentials
-- (V006), jobs (V008), recipes (V013) y consents/data_subject_requests (V014). Por eso es TEXT y NO
-- uuid: es el mismo identificador opaco que usa toda la plataforma, y las policies comparan contra
-- auth.jwt() ->> 'sub' SIN cast, exactamente como el resto. El backend se conecta con el rol de
-- servicio (pooler) que OMITE RLS; el aislamiento real es el WHERE owner_id de cada query del
-- repositorio (sitios-conectados-repository.ts). Las policies RLS de abajo son la segunda capa.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico: ni el backend ni CI las ejecutan). Este archivo es IDEMPOTENTE:
-- re-aplicarlo es un NO-OP y reproduce el mismo esquema en una base vacia. Revertir es
-- `drop table if exists sitios_conectados;` (tabla nueva sin FKs entrantes: el drop es limpio).

-- gen_random_uuid vive en pgcrypto; lo aseguran V006/V008/V009/V012/V013, se repite por si V024 se aplicara sola.
create extension if not exists pgcrypto;

create table if not exists sitios_conectados (
  id                  uuid primary key default gen_random_uuid(),
  -- Dueno de la conexion (sub del JWT). NOT NULL: una sesion heredada SIEMPRE tiene dueno.
  owner_id            text not null,
  -- Dominio del sitio conectado (p.ej. 'app.ejemplo.com'). La unidad de conexion es el dominio:
  -- un owner tiene A LO SUMO una conexion por dominio (unique de abajo).
  dominio             text not null,
  -- URL de login que se abrio en la vista en vivo. Opcional: informativa para reconectar.
  url_login           text,
  -- Id del contexto de navegador en el PROVEEDOR externo (donde persisten cookies/perfil). Se
  -- devuelve al borrar para que 7.1b lo purgue TAMBIEN en el proveedor (borrado en ambos lados).
  contexto_externo_id text,
  -- Contexto de sesion (cookies/storage) CIFRADO con AES-256-GCM bajo VAULT_SECRET: los bytes
  -- iv | tag | ciphertext de src/crypto/aes-gcm.ts. JAMAS en claro; JAMAS se selecciona en listados.
  contexto_cifrado    bytea,
  -- Referencia de la salida de red pineada para este dominio (proxy pegajoso). Sin rotacion.
  proxy_ref           text,
  -- IP de salida OBSERVADA al establecer la sesion. 7.1b aborta si la salida actual difiere.
  egress_ip           inet,
  -- Referencia del fingerprint de navegador con el que se establecio la sesion.
  fingerprint_ref     text,
  -- Ciclo de vida de la conexion (ver cabecera). CHECK como defensa en profundidad del tipado del
  -- repositorio: la base rechaza un estado inventado.
  estado              text not null default 'esperando_login' check (
                        estado in ('esperando_login', 'activo', 'caducado', 'error')
                      ),
  creado_en           timestamptz not null default now(),
  -- Ultima vez que una ejecucion uso (o refresco) esta sesion. null = nunca usada.
  ultimo_uso_en       timestamptz,
  -- Expiracion conocida de la sesion (si el sitio la comunica). null = desconocida.
  expira_en           timestamptz,
  -- UNA conexion por owner y dominio: reconectar REEMPLAZA la sesion, no la duplica.
  constraint sitios_conectados_owner_dominio_uk unique (owner_id, dominio)
);

-- Listados del usuario y barridos por estado (p.ej. expirar 'esperando_login' viejos en 7.1b).
create index if not exists sitios_conectados_owner_estado_idx on sitios_conectados (owner_id, estado);

-- RLS por owner_id, con el MISMO predicado que agents (V002): owner_id = auth.jwt() ->> 'sub', sin
-- cast. A diferencia de agents (tabla gestionable por el cliente, con las 4 policies), aqui solo se
-- expone SELECT: sitios_conectados guarda CREDENCIALES DE SESION cifradas y su creacion/edicion es
-- EXCLUSIVAMENTE server-side (el cifrado con VAULT_SECRET solo existe en el backend). Exponer
-- INSERT/UPDATE via RLS permitiria escribir blobs por PostgREST saltandose el cifrado. Mismo
-- endurecimiento que data_subject_requests (V014) y upgrade_requests (V023).
alter table sitios_conectados enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.
drop policy if exists "sitios_conectados_select_own" on sitios_conectados;
create policy "sitios_conectados_select_own"
  on sitios_conectados for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- Cinturon y tirantes: ademas de NO tener policies de escritura, se revocan los privilegios de
-- escritura directa a los roles de cliente (igual que V023). SELECT se conserva para la policy.
revoke insert, update, delete on sitios_conectados from authenticated, anon;
