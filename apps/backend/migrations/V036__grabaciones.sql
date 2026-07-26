-- GRABACION DE TAREAS (via complementaria para SEMBRAR una receta): el usuario le ENSENA una tarea al
-- sistema haciendola el mismo una vez en la vista en vivo, y esa grabacion se convierte en una receta
-- (recetas_web, V035) que despues se ejecuta sin llamar al modelo.
--
-- LA ARQUITECTURA PRINCIPAL NO CAMBIA. El agente sigue navegando libremente cualquier sitio donde el
-- usuario ya inicio sesion, y esa universalidad es la propuesta de valor. La grabacion existe para dos
-- casos concretos: sitios donde el agente falla de forma repetida, y arrancar el sistema de recetas sin
-- depender de una primera corrida exitosa del agente. Una receta grabada NO tiene privilegios: se
-- ejecuta con la MISMA verificacion determinista de parametros y la MISMA politica del usuario (V034)
-- que cualquier otra (ver la columna `origen` que agrega esta migracion, que sirve para DISTINGUIRLAS,
-- no para tratarlas distinto).
--
-- EL INVARIANTE INNEGOCIABLE, escrito en el esquema: EL LOGIN JAMAS SE GRABA. No existe aqui ninguna
-- columna de contrasena ni de credencial, ni existira. La grabacion solo puede iniciarse sobre una
-- conexion en estado 'activo' (la sesion la establecio el flujo de login de V024/7.1b, que sigue
-- intacto), y si durante la grabacion aparece un campo de contrasena el worker DETIENE la captura, tira
-- lo capturado y deja la fila en 'descartada' con motivo 'contrasena'. La deteccion es la MISMA
-- comprobacion determinista (input[type=password]) que ya usaba el pre-chequeo de caducidad.
--
-- PRIVACIDAD de `pasos`: todo valor tecleado pasa por la censura del worker (apps/worker/src/censura.ts)
-- ANTES de llegar aqui, asi que no hay contrasenas, tarjetas ni tokens. Los valores que el usuario marca
-- como DATOS VARIABLES se BORRAN de esta tabla al promover: la receta guarda el marcador
-- ('destinatario', 'monto', ...) y la grabacion queda con el marcador tambien. Lo que no se marca es
-- texto fijo del procedimiento y se conserva tal cual.
--
-- Tenancy: owner_id = sub del JWT (text), IDENTICO a jobs (V008), sitios_conectados (V024),
-- aprobaciones_web (V027), trayectorias_web (V030), politicas_ejecucion (V034) y recetas_web (V035). El
-- worker escribe con el rol de servicio (omite RLS); el aislamiento real es el WHERE owner_id de cada
-- query del repositorio. Las policies RLS (solo SELECT propio) son la segunda capa, mismo patron que
-- V024: una grabacion la escribe EXCLUSIVAMENTE el servidor, nunca un cliente por PostgREST.
--
-- Sin FK a sitios_conectados A PROPOSITO (mismo criterio que V027/V030/V035): desconectar y reconectar
-- un sitio no debe borrar lo que el usuario ya enseno sobre el. `connection_id` es una referencia.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico: ni el backend, ni el worker, ni CI las ejecutan). Este archivo es
-- IDEMPOTENTE: re-aplicarlo es un NO-OP. Revertir es
--   drop table if exists grabaciones;
--   alter table recetas_web drop column if exists origen;

-- gen_random_uuid vive en pgcrypto; lo aseguran V006/V008/V024/V030/V035, se repite por si V036 se aplicara sola.
create extension if not exists pgcrypto;

create table if not exists grabaciones (
  id                  uuid primary key default gen_random_uuid(),
  -- Dueno de la grabacion (sub del JWT). NOT NULL: lo que alguien ensena en su cuenta es suyo.
  owner_id            text not null,
  -- Conexion (sitios_conectados, V024) sobre cuya sesion activa se grabo. Sin FK (ver cabecera).
  connection_id       uuid not null,
  -- Dominio en el que se grabo. Una receta grabada JAMAS se aplica a otro dominio.
  dominio             text not null,
  -- Lo que el usuario escribio en lenguaje llano ("que le vas a ensenar"). De aqui sale la FIRMA del
  -- objetivo con la que la receta se busca despues, calculada con el MISMO mecanismo que la promocion
  -- automatica desde una trayectoria exitosa.
  descripcion         text not null,
  -- 'grabando'   -> la sesion esta abierta y el worker esta capturando.
  -- 'terminada'  -> el usuario dijo "ya termine"; los pasos estan guardados y listos para revisar.
  -- 'descartada' -> no se guarda nada (ver motivo). El caso que importa es 'contrasena'.
  estado              text not null default 'grabando' check (
                        estado in ('grabando', 'terminada', 'descartada')
                      ),
  -- Por que se descarto. null mientras no este descartada. 'contrasena' es el invariante innegociable;
  -- 'vencida' es no haber dicho "ya termine" a tiempo; 'demasiados_pasos' y 'no_repetible' son
  -- grabaciones que no describen una tarea que se pueda repetir tal cual; 'sitio_no_disponible' es que
  -- la conexion dejo de estar activa antes de empezar.
  motivo              text check (
                        motivo in ('contrasena', 'vencida', 'demasiados_pasos', 'no_repetible',
                                   'sitio_no_disponible')
                      ),
  -- Los pasos capturados. Forma y validacion en packages/shared/src/grabaciones/contrato.ts. Arranca
  -- vacio y lo escribe el worker al terminar la captura.
  pasos               jsonb not null default '[]'::jsonb,
  -- URL de la vista en vivo que el usuario abre para HACER la tarea. Solo poblada mientras 'grabando';
  -- al terminar (o descartar) se limpia. NO es una credencial del sitio: es la vista del navegador
  -- remoto, el mismo mecanismo que ya usa el login (sitios_conectados.vista_en_vivo_url, V025).
  vista_en_vivo_url   text,
  creada_en           timestamptz not null default now(),
  actualizada_en      timestamptz not null default now()
);

-- Listado de las grabaciones del usuario y barridos por estado.
create index if not exists grabaciones_owner_estado_idx on grabaciones (owner_id, estado);

alter table grabaciones enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.
-- Igual que sitios_conectados (V024), politicas_ejecucion (V034) y recetas_web (V035): SOLO select
-- propio. Exponer INSERT/UPDATE por PostgREST dejaria que un cliente se fabricara sus propios pasos de
-- navegacion y se los diera a ejecutar al worker, que es exactamente lo que no puede pasar.
drop policy if exists "grabaciones_select_own" on grabaciones;
create policy "grabaciones_select_own"
  on grabaciones for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- Cinturon y tirantes: ademas de NO tener policies de escritura, se revocan los privilegios de
-- escritura directa a los roles de cliente (mismo endurecimiento que V023/V024/V034/V035).
revoke insert, update, delete on grabaciones from authenticated, anon;

-- ORIGEN de una receta (V035): 'automatica' = promovida sola desde una trayectoria exitosa del agente;
-- 'grabacion' = sembrada por el usuario ensenando la tarea. Existe para poder DISTINGUIRLAS despues
-- (medir cuales sirven, decidir donde el agente falla), NO para tratarlas distinto: una receta grabada
-- pasa por la misma verificacion determinista de parametros y la misma politica del usuario. El default
-- 'automatica' deja intactas las filas existentes.
alter table recetas_web add column if not exists origen text not null default 'automatica';

-- El CHECK se agrega aparte y de forma idempotente (ADD CONSTRAINT no admite IF NOT EXISTS).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'recetas_web_origen_check'
  ) then
    alter table recetas_web
      add constraint recetas_web_origen_check check (origen in ('automatica', 'grabacion'));
  end if;
end
$$;
