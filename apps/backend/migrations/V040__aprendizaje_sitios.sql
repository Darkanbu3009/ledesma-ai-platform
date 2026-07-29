-- ATLAS DE SITIOS (V040): la primera pieza del APRENDIZAJE COLECTIVO. Agrega, POR DOMINIO, las
-- estrategias de localizacion que GANARON en ejecuciones exitosas de cualquier usuario, y se las
-- ofrece como PISTAS a todo agente que opere despues en ese mismo dominio (motor libre y ejecutor de
-- recetas). El aviso de privacidad vigente ya declara esta finalidad (aprendizaje estructural
-- agregado) y el usuario la acepta al entrar (V039).
--
-- QUE ES Y QUE NO ES. Esta tabla describe la ESTRUCTURA de un sitio, no lo que un usuario hizo en el:
--   - lo que se guarda: dominio, una CLASE DE ELEMENTO (accion + rol accesible + nombre normalizado)
--     y las formas estructurales de volver a encontrarlo (atributo estable, rol, texto visible);
--   - lo que JAMAS se guarda: owner_id, valores tecleados, textos del usuario, ids de trayectoria, de
--     receta o de job, screenshots, URLs. NO HAY COLUMNA donde escribirlos: la tabla entera son ocho
--     columnas y ninguna es de tenencia. Ese es el mecanismo, no la promesa.
--
-- ANONIMATO DE ORIGEN. Para poder contar CUANTOS usuarios distintos produjeron una estructura sin
-- saber quienes son, `origenes_hash` guarda HMAC-SHA256 del owner con un secreto que vive SOLO en el
-- worker (nunca en esta base). Es de una sola via: desde la fila no se puede volver al usuario, y sin
-- el secreto no se puede ni confirmar una sospecha. Es un CONTADOR DE DISTINTOS, no un identificador.
--
-- CORROBORACION (la regla que protege el pozo desde el primer usuario externo): una entrada se sirve a
-- un origen DISTINTO del que la creo solo cuando su estructura fue producida por al menos 2 origenes
-- independientes. El propio origen siempre se beneficia de lo suyo por sus recetas normales, asi que
-- el umbral no resta valor con pocos usuarios. `corroboraciones` cuenta observaciones exitosas (sube
-- siempre); el UMBRAL mira `origenes_hash`, que solo crece con origenes NUEVOS. La regla la aplica el
-- worker (apps/worker/src/atlas-sitios.ts), igual que V038 deja el historial de ganadoras crudo aqui y
-- su interpretacion en promocion-estrategias.ts.
--
-- EL ATLAS ES PISTA, NO RECETA: se inyecta como estrategias ADICIONALES de fallback y como contexto de
-- percepcion. La VERIFICACION DETERMINISTA previa a una accion irreversible (verificacion.ts) y la
-- GUARDIA DE ACCION (tarea-web.ts) NO consultan esta tabla y son ignorantes de su existencia: lo que
-- el atlas puede cambiar es COMO se encuentra un boton, jamas SI una accion se ejecuta.
--
-- ESTA TABLA NO ES `recetas_web` (V035) ni `trayectorias_web` (V030): aquellas son POR DUENO y llevan
-- su owner_id; esta es GLOBAL y no puede llevarlo.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico: ni el backend, ni el worker, ni CI las ejecutan). Este archivo
-- es IDEMPOTENTE: re-aplicarlo es un NO-OP. Revertir es
--   drop table if exists aprendizaje_sitios;

-- gen_random_uuid vive en pgcrypto; lo aseguran V006/V008/V013/V024/V030/V035, se repite por si V040
-- se aplicara sola.
create extension if not exists pgcrypto;

create table if not exists aprendizaje_sitios (
  id                 uuid primary key default gen_random_uuid(),
  -- Dominio del sitio. Es la UNICA dimension de agrupacion: una entrada jamas cruza de dominio.
  dominio            text not null,
  -- CLASE DE ELEMENTO: la identidad estructural del control, no su posicion ni su contenido. La
  -- construye el worker como `accion|rol:<rol>|<nombre normalizado>` (con caida a un atributo estable
  -- o al texto visible cuando el elemento no expone rol accesible). El nombre va normalizado y
  -- TRUNCADO a 60 caracteres. Ver claseDeElemento en apps/worker/src/atlas-sitios.ts.
  clase_de_elemento  text not null,
  -- Lista RANKEADA de estrategias estructurales, la ganadora primero. Solo 'atributo' (lista cerrada
  -- de atributos estables), 'rol' y 'texto': el xpath queda FUERA a proposito (es la ruta del DOM de
  -- UNA sesion concreta, no se puede truncar sin romperlo y no describe la estructura del sitio).
  -- Toda estrategia que coincida total o parcialmente con un valor tecleado de la corrida se descarta
  -- ANTES de llegar aqui (estrategiasParaElAtlas).
  estrategias        jsonb not null,
  -- Cuantas ejecuciones exitosas confirmaron esta estructura. Sube en CADA observacion, tambien si es
  -- del mismo origen: mide cuanto se apoya la plataforma en esta entrada, no cuanta gente la produjo.
  corroboraciones    integer not null default 1 check (corroboraciones >= 1),
  -- HMAC-SHA256 (hex) de los origenes DISTINTOS que produjeron esta estructura. No reversible, con
  -- secreto del worker. Su LARGO es el umbral de corroboracion; su contenido no identifica a nadie.
  origenes_hash      jsonb not null default '[]'::jsonb,
  primera_vez_en     timestamptz not null default now(),
  actualizada_en     timestamptz not null default now()
);

-- UNA fila por estructura: dos observaciones de la misma clase en el mismo dominio se AGREGAN sobre la
-- misma fila (upsert), no acumulan filas. Sin esto, el contador de origenes distintos no significaria
-- nada porque cada corrida crearia su propia fila.
--
-- ES TAMBIEN EL INDICE POR DOMINIO: `dominio` es su columna izquierda, asi que la unica lectura del
-- inyector (todas las entradas de un dominio) lo usa tal cual. Un segundo indice solo por dominio
-- seria redundante y encareceria cada escritura del agregador.
create unique index if not exists aprendizaje_sitios_dominio_clase_uniq
  on aprendizaje_sitios (dominio, clase_de_elemento);

alter table aprendizaje_sitios enable row level security;

-- SIN NINGUNA POLICY, a proposito y a diferencia de recetas_web (V035) o sitios_conectados (V024):
-- aquellas tienen dueno y su policy es `owner_id = auth.jwt() ->> 'sub'`. Esta tabla NO tiene dueno,
-- asi que no existe la pregunta "¿es mia?" y no hay policy que pueda responderla. Con RLS habilitada
-- y cero policies, PostgREST no devuelve NUNCA una fila a un cliente autenticado ni anonimo. La
-- escriben y la leen EXCLUSIVAMENTE el worker y el backend con el rol de servicio.
--
-- Cinturon y tirantes: se revocan ademas los privilegios directos, incluido SELECT (aqui si, a
-- diferencia de V035, donde SELECT se conservaba para que su policy pudiera aplicar).
revoke select, insert, update, delete on aprendizaje_sitios from authenticated, anon;
