-- PLANTILLAS COMPARTIDAS (V041): la segunda pieza del APRENDIZAJE COLECTIVO, despues del ATLAS DE
-- SITIOS (V040). El atlas describe COMO se encuentra un control; esta tabla describe EN QUE ORDEN se
-- opera un conjunto de controles para llevar a cabo UNA INTENCION IRREVERSIBLE. Existe para que un
-- usuario nuevo no vuelva a pagar el descubrimiento que otro ya pago: la primera corrida de una tarea
-- cuesta motor libre, y repetir un procedimiento determinista cuesta cero tokens.
--
-- ESTA MIGRACION SOLO HABILITA LA ESCRITURA. En el commit que la introduce NINGUNA via de lectura
-- consulta esta tabla: la publicacion la llena y nadie la sirve todavia. El consumo es un cambio
-- aparte, con su propia barrera de identidad y su propia decision sobre `estado`.
--
-- QUE SE GUARDA. Cuatro cosas y ninguna mas: la IDENTIDAD de la plantilla (el conjunto de dominios, el
-- codigo de intencion y el conjunto de marcadores que exige), el PROCEDIMIENTO (pasos con localizadores
-- estructurales y ranuras vacias), los CONTADORES de como le fue, y un contador de ORIGENES DISTINTOS.
--
-- QUE JAMAS SE GUARDA, y el mecanismo es la AUSENCIA DE COLUMNA, no una promesa: owner_id, la firma del
-- objetivo, ninguna descripcion, ningun valor literal tecleado por nadie, ningun xpath, ninguna ruta,
-- ningun id de trayectoria, de receta ni de job. No es que no se escriban: NO HAY DONDE ESCRIBIRLOS.
--
-- POR QUE NO HAY DESCRIPCION NI FIRMA, que es lo que distingue esta tabla de `recetas_web` (V035):
--   - la FIRMA del objetivo es el texto normalizado del usuario con sus datos sustituidos. Sigue siendo
--     SU frase, con su idioma, sus palabras y su forma de pedir las cosas: es un cuasi identificador y
--     no tiene nada que hacer en una tabla global. La identidad de una plantilla, por eso, no es la
--     firma sino tres componentes que NINGUN modelo redacta: el conjunto de dominios, el codigo de
--     intencion (la familia del verbo irreversible que el propio usuario escribio) y el conjunto de
--     marcadores de parametro que los pasos exigen;
--   - la DESCRIPCION (V037) es directamente la frase del usuario, generalizada pero suya.
--
-- SOLO INTENCIONES IRREVERSIBLES. `codigo_de_intencion` es NOT NULL y su CHECK es cerrado: no existe la
-- fila de una tarea reversible. Es deliberado y el motivo es de seguridad, no de alcance: cuando el
-- objetivo no contiene ningun verbo de accion bloqueada, la guardia de accion deja pasar todo sin
-- comparar nada contra la pagina (tarea-web.ts), asi que una plantilla reversible ajena correria de
-- punta a punta sin una sola comprobacion. Las reversibles quedan fuera hasta que exista una barrera
-- que las cubra.
--
-- ANONIMATO DE ORIGEN. `origenes_hash` guarda HMAC-SHA256 del owner con una clave que vive SOLO en el
-- worker (nunca en esta base). Es un CONTADOR DE DISTINTOS, no un identificador: de una sola via, y sin
-- la clave no se puede ni confirmar una sospecha comparando hashes. La clave se deriva con una ETIQUETA
-- PROPIA ('plantillas-compartidas/v1'), DISTINTA de la del atlas ('atlas-sitios/v1'), justamente para
-- que el mismo owner produzca hashes INCOMPARABLES en las dos tablas: con la misma etiqueta, quien
-- tuviera acceso a la base podria unir `aprendizaje_sitios` con esta por el hash y reconstruir un
-- patron de uso ("el origen de esta plantilla es el que produjo estas 40 entradas en estos 6 dominios"),
-- que es exactamente el cuasi identificador que el hash existe para evitar.
--
-- ESTA TABLA NO ES `recetas_web` (V035) ni `recipes` (V013): aquellas son POR DUENO y llevan owner_id.
-- Esta es GLOBAL y no puede llevarlo, igual que `aprendizaje_sitios` (V040).
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico: ni el backend, ni el worker, ni CI las ejecutan). Este archivo
-- es IDEMPOTENTE: re-aplicarlo es un NO-OP. Revertir es
--   drop table if exists plantillas_compartidas;
--   alter table recetas_web drop constraint if exists recetas_web_origen_check;
--   alter table recetas_web add constraint recetas_web_origen_check
--     check (origen in ('automatica', 'grabacion'));

-- gen_random_uuid vive en pgcrypto; lo aseguran V006/V008/V013/V024/V030/V035/V040, se repite por si
-- V041 se aplicara sola.
create extension if not exists pgcrypto;

create table if not exists plantillas_compartidas (
  id                    uuid primary key default gen_random_uuid(),
  -- CONJUNTO DE DOMINIOS de la tarea, ordenado, en minusculas, deduplicado y unido con '+'. Es un
  -- CONJUNTO y no una lista para que {tienda, correo} y {correo, tienda} sean la MISMA plantilla. Mismo
  -- criterio que sufijoDeDominios (apps/worker/src/receta-web.ts), que es lo que ya agrupa las firmas
  -- de las recetas multisitio.
  dominios_clave        text not null,
  -- CODIGO DE INTENCION: la FAMILIA del verbo irreversible que el usuario escribio en su objetivo, tal
  -- como la asigna la deteccion determinista sobre su texto literal (VERBOS_ACCION_BLOQUEADA y
  -- detectarVerboBloqueado, apps/worker/src/prompt-tarea-web.ts). Ocho valores y ni uno mas: la lista
  -- cerrada del CHECK es la misma union AccionIrreversible del worker. NINGUN modelo lo redacta ni lo
  -- clasifica: sale de una expresion regular sobre lo que el usuario ya habia escrito.
  codigo_de_intencion   text not null,
  -- CONJUNTO DE MARCADORES de parametro que los pasos EXIGEN, ordenado y unido con '+', o '' cuando la
  -- plantilla no pide ningun dato. Sale de marcadoresDeParametros(pasos) (packages/shared, contrato de
  -- recetas): la unica fuente que no puede divergir de lo que la ejecucion va a pedir de verdad. Es ''
  -- y no NULL a proposito: forma parte del indice unico, y en Postgres dos NULL no colisionan.
  marcadores_clave      text not null,
  -- EL PROCEDIMIENTO. Pasos con la forma de PasoPublicable (packages/shared, contrato de plantillas),
  -- que es el contrato de recetas MENOS tres cosas: sin accion 'navegar' (implicaria una ruta), sin
  -- estrategia xpath (es la ruta del DOM de UNA sesion, no describe el sitio para nadie mas) y sin
  -- valores literales. Y con la MISMA lista estrecha de atributos que el atlas: solo 'aria-label' y
  -- 'data-*', asi que quedan fuera 'id' y 'name' aunque el contrato de recetas los admita (son los que
  -- llevan identificadores por cuenta o por sesion; el caso Gmail de V038). Las dos fronteras de
  -- privacidad de las dos tablas globales son la misma frontera, no una mas ancha que la otra.
  -- Un paso que en la receta llevaba un literal se publica como RANURA VACIA
  -- nombrada por la CLASE del elemento ({ tipo: 'ranura', clase: 'escribir|rol:textbox|asunto' }),
  -- nunca por el valor: el valor lo aporta el consumidor desde su propio objetivo en tiempo de
  -- ejecucion. Ademas cada paso lleva su CLASE DE ELEMENTO, que la receta no tiene: es lo que la
  -- barrera de identidad compara antes de actuar sobre un control ajeno.
  pasos                 jsonb not null,
  -- CICLO DE VIDA de la plantilla. 'candidata' = publicada y todavia sin aval suficiente para servirse;
  -- 'corroborada' = la produjeron origenes independientes y su historial la respalda; 'retirada' = dejo
  -- de servir (fallo repetido o purga administrativa). En este commit TODA fila nace y se queda
  -- 'candidata': quien decide las transiciones es el consumo, que es otro cambio.
  estado                text not null default 'candidata',
  -- HMAC-SHA256 (hex) de los origenes DISTINTOS que produjeron esta plantilla. No reversible, con clave
  -- del worker y etiqueta de derivacion PROPIA (ver cabecera). Su LARGO es lo que mide corroboracion;
  -- su contenido no identifica a nadie.
  origenes_hash         jsonb not null default '[]'::jsonb,
  -- COMO LE FUE a la plantilla, en agregado y sin decir a quien. Los tres contadores son la materia
  -- prima de las transiciones de `estado` que hara el consumo; en este commit solo se inicializan.
  ejecuciones_exitosas  integer not null default 0 check (ejecuciones_exitosas >= 0),
  ejecuciones_fallidas  integer not null default 0 check (ejecuciones_fallidas >= 0),
  -- Fallos SEGUIDOS: es lo que distingue una plantilla que envejecio mal de una con mala suerte suelta.
  fallos_consecutivos   integer not null default 0 check (fallos_consecutivos >= 0),
  ultima_ejecucion_en   timestamptz,
  primera_vez_en        timestamptz not null default now(),
  actualizada_en        timestamptz not null default now(),
  constraint plantillas_compartidas_codigo_de_intencion_check check (
    codigo_de_intencion in (
      'enviar',
      'publicar',
      'borrar',
      'pagar',
      'transferir',
      'comprar',
      'firmar',
      'cancelarSuscripcion'
    )
  ),
  constraint plantillas_compartidas_estado_check check (
    estado in ('candidata', 'corroborada', 'retirada')
  )
);

-- UNA fila por IDENTIDAD: dos publicaciones de la misma (dominios, intencion, marcadores) se AGREGAN
-- sobre la misma fila (upsert que suma el origen si es nuevo), no acumulan filas. Sin esto el contador
-- de origenes distintos no significaria nada, porque cada corrida crearia su propia fila.
--
-- ES TAMBIEN EL INDICE DE LECTURA DEL CONSUMO: sus tres columnas, en ese orden, son exactamente la
-- clave con la que una tarea nueva buscara su plantilla. Un segundo indice seria redundante y
-- encareceria cada escritura de la publicacion.
create unique index if not exists plantillas_compartidas_identidad_uniq
  on plantillas_compartidas (dominios_clave, codigo_de_intencion, marcadores_clave);

alter table plantillas_compartidas enable row level security;

-- SIN NINGUNA POLICY, con el MISMO criterio y la MISMA justificacion que V040 y a diferencia de
-- recetas_web (V035) o sitios_conectados (V024): aquellas tienen dueno y su policy es
-- `owner_id = auth.jwt() ->> 'sub'`. Esta tabla NO tiene dueno, asi que no existe la pregunta "¿es
-- mia?" y no hay policy que pueda responderla. Con RLS habilitada y cero policies, PostgREST no
-- devuelve NUNCA una fila a un cliente autenticado ni anonimo. La escriben y la leen EXCLUSIVAMENTE el
-- worker y el backend con el rol de servicio.
--
-- Cinturon y tirantes: se revocan ademas los privilegios directos, incluido SELECT (aqui si, igual que
-- V040 y a diferencia de V035, donde SELECT se conservaba para que su policy pudiera aplicar).
revoke select, insert, update, delete on plantillas_compartidas from authenticated, anon;

-- ORIGEN de una receta (V035/V036): 'automatica' = promovida sola desde una trayectoria exitosa del
-- agente; 'grabacion' = sembrada por el usuario ensenando la tarea. Se agrega
-- 'plantilla_compartida' = sembrada desde una plantilla que otro origen descubrio. El valor todavia no
-- lo escribe NADIE: lo escribira el consumo, y el CHECK tiene que admitirlo antes para que ese cambio
-- no arrastre una migracion propia. Es el UNICO ALTER de esta migracion sobre una tabla existente y no
-- toca ni una fila: `origen` sigue siendo NOT NULL con el mismo default 'automatica'.
--
-- El CHECK se reemplaza dentro de un do $$ y de forma idempotente, con el patron de V036 (ADD
-- CONSTRAINT no admite IF NOT EXISTS): se descarta el vigente si existe y se agrega el nuevo, asi que
-- re-aplicar la migracion vuelve a dejar exactamente la misma restriccion.
do $$
begin
  alter table recetas_web drop constraint if exists recetas_web_origen_check;
  alter table recetas_web
    add constraint recetas_web_origen_check
    check (origen in ('automatica', 'grabacion', 'plantilla_compartida'));
end
$$;
