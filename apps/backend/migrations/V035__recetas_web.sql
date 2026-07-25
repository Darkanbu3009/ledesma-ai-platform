-- RECETAS DE TAREA WEB (Fase F, paso 2 de 2): la PROMOCION de una trayectoria exitosa (V030) a un
-- procedimiento que se vuelve a ejecutar SIN llamar al modelo. Una receta guarda, paso a paso, COMO
-- localizar cada elemento y QUE hacer con el; el worker la repite con primitivas de bajo nivel y solo
-- escala al motor de navegacion el paso concreto cuyo elemento ya no aparece.
--
-- POR QUE EXISTE (motivacion medida en produccion): una tarea web de 15 pasos consumio 101270 tokens
-- de entrada, casi todo screenshots reenviados al modelo en cada iteracion. Repetir esa misma tarea de
-- forma determinista no consume ninguno.
--
-- ESTA TABLA NO ES `recipes` (V013). Aquella son cadenas lineales de INSTRUCCIONES DE TEXTO para un
-- agente conversacional (agent_id + credential_id + steps, encoladas con el payload { kind: 'recipe' })
-- y siguen intactas, con sus datos, sus rutas y sus policies. Una RECETA WEB no tiene agente, no tiene
-- credencial propia y no ejecuta instrucciones de texto: es la traza de localizacion y accion de una
-- navegacion. Nombres distintos a proposito en toda la pila (recetas_web / receta-web.ts frente a
-- recipes / recipe-payload.ts) para que no se puedan confundir al leer el codigo.
--
-- IDENTIDAD DE UNA RECETA (D3): owner + dominio + FIRMA DEL OBJETIVO. La firma se calcula en el worker
-- normalizando el objetivo (minusculas, sin acentos, sin puntuacion) y sustituyendo los parametros
-- concretos que extrae el extractor determinista por marcadores. Asi "envia un correo a martin@x.com
-- con asunto Hola" y "envia un correo a ana@y.com con asunto Adios" comparten firma, comparten receta,
-- y los valores concretos se sustituyen recien al ejecutar.
--
-- PRIVACIDAD (el punto que decide que puede vivir aqui): un paso de escritura guarda el MARCADOR del
-- parametro ('destinatario', 'monto', 'producto', 'cantidad'), NUNCA el valor tecleado. Los valores
-- reales se resuelven en cada corrida desde el objetivo de ESA corrida. Un paso cuyo valor la censura
-- (apps/worker/src/censura.ts) marco como sensible se promueve SIN valor, solo con su localizacion. Por
-- construccion no hay contrasenas, tarjetas ni tokens en `pasos`.
--
-- SEGURIDAD DE LO QUE SE GUARDA: `pasos` es jsonb y se valida ENTERO al leerlo
-- (packages/shared/src/recetas/contrato.ts): un paso que no valide invalida la receta completa y la
-- tarea corre por el camino normal. Un paso de navegacion guarda una RUTA RELATIVA, jamas una URL: el
-- ejecutor la resuelve contra el dominio de la conexion, asi que ninguna receta puede sacar la sesion
-- del usuario a otro dominio.
--
-- LA RECETA NO AUTORIZA NADA (D7): ejecutar por receta no salta la verificacion determinista previa a
-- una accion irreversible ni la politica del usuario (V034). La receta decide COMO llegar a la accion;
-- si esa accion se ejecuta o no lo sigue decidiendo la comparacion contra el objetivo y la politica.
--
-- Tenancy: owner_id = sub del JWT (text), IDENTICO a jobs (V008), sitios_conectados (V024),
-- aprobaciones_web (V027), trayectorias_web (V030) y politicas_ejecucion (V034). El worker escribe con
-- el rol de servicio (omite RLS); el aislamiento real es el WHERE owner_id de cada query del
-- repositorio. Las policies RLS (solo SELECT propio) son la segunda capa.
--
-- Sin FK a sitios_conectados ni a trayectorias_web A PROPOSITO (mismo criterio que aprobaciones_web
-- V027 y trayectorias_web V030): la retencion de trayectorias (30 dias) es mucho mas corta que la vida
-- util de una receta, y desconectar y reconectar un sitio no debe borrar lo aprendido sobre el.
-- `creada_desde_trayectoria` es una referencia de auditoria, no una dependencia.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico: ni el backend, ni el worker, ni CI las ejecutan). Este archivo es
-- IDEMPOTENTE: re-aplicarlo es un NO-OP. Revertir es `drop table if exists recetas_web;` (tabla nueva,
-- sin FKs entrantes).

-- gen_random_uuid vive en pgcrypto; lo aseguran V006/V008/V013/V024/V030, se repite por si V035 se aplicara sola.
create extension if not exists pgcrypto;

create table if not exists recetas_web (
  id                        uuid primary key default gen_random_uuid(),
  -- Dueno de la receta (sub del JWT). NOT NULL: lo aprendido en la cuenta de alguien es suyo.
  owner_id                  text not null,
  -- Dominio en el que la receta sabe operar. Una receta JAMAS se aplica a otro dominio.
  dominio                   text not null,
  -- Firma del objetivo con los parametros sustituidos por marcadores (ver cabecera, D3).
  firma_objetivo            text not null,
  -- Se incrementa cada vez que una corrida exitosa REEMPLAZA la receta activa de esta firma. Sirve
  -- para leer en la base cuantas veces el sitio obligo a reaprender el procedimiento.
  version                   integer not null default 1 check (version >= 1),
  -- 'activa'   -> es la que se usa para ejecutar.
  -- 'obsoleta' -> el sitio cambio tanto que mas de la mitad de sus pasos hubo que escalarlos al motor
  --               (D6): deja de usarse y la siguiente corrida exitosa genera una receta nueva.
  estado                    text not null default 'activa' check (estado in ('activa', 'obsoleta')),
  -- Los pasos re-ejecutables. Forma y validacion en packages/shared/src/recetas/contrato.ts. Sin
  -- valores tecleados: solo marcadores de parametro (ver PRIVACIDAD en la cabecera).
  pasos                     jsonb not null,
  -- Trayectoria (V030) de la que se promovio. Sin FK (ver cabecera): es auditoria, no dependencia.
  creada_desde_trayectoria  uuid,
  -- Contadores de uso, para poder medir el ahorro y detectar recetas que dejaron de servir.
  ejecuciones_exitosas      integer not null default 0 check (ejecuciones_exitosas >= 0),
  ejecuciones_fallidas      integer not null default 0 check (ejecuciones_fallidas >= 0),
  ultima_ejecucion_en       timestamptz,
  creada_en                 timestamptz not null default now(),
  actualizada_en            timestamptz not null default now()
);

-- UNA receta ACTIVA por owner, dominio y firma: promover sobre una firma ya conocida REEMPLAZA (sube
-- version), no acumula. El unique es PARCIAL (where estado = 'activa') a proposito: las obsoletas se
-- conservan como historia de lo que el sitio rompio y no deben chocar entre si ni con la activa.
create unique index if not exists recetas_web_activa_uniq
  on recetas_web (owner_id, dominio, firma_objetivo)
  where estado = 'activa';

-- Busqueda del camino a ejecutar al recibir una tarea web (owner + dominio, despues firma).
create index if not exists recetas_web_owner_dominio_idx on recetas_web (owner_id, dominio);

alter table recetas_web enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.
-- Igual que sitios_conectados (V024) y politicas_ejecucion (V034): SOLO select propio. Una receta la
-- escribe EXCLUSIVAMENTE el worker con el rol de servicio, tras una corrida que salio bien. Exponer
-- INSERT/UPDATE por PostgREST dejaria que un cliente se fabricara sus propios pasos de navegacion.
drop policy if exists "recetas_web_select_own" on recetas_web;
create policy "recetas_web_select_own"
  on recetas_web for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- Cinturon y tirantes: ademas de NO tener policies de escritura, se revocan los privilegios de
-- escritura directa a los roles de cliente (mismo endurecimiento que V023/V024/V034). SELECT se
-- conserva para que la policy de arriba pueda aplicar.
revoke insert, update, delete on recetas_web from authenticated, anon;
