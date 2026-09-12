-- VOCABULARIO ABIERTO FUERA DE LA CLAVE (V045): la clave de identidad de una plantilla compartida
-- lleva SOLO el NUCLEO CERRADO, y los datos abiertos viajan en esta columna nueva.
--
-- POR QUE, y es una medida y no una preferencia: la busqueda de una plantilla compara
-- `marcadores_clave` contra el conjunto que el consumidor declara Y TODOS SUS SUBCONJUNTOS, asi que
-- el tope de la lista del `in` es 2^N sobre el numero de marcadores. Con 6 son 64 claves; con los 9
-- de hoy, 512; con los que harian falta para cubrir siete familias de interfaz, 2,7 x 10^11. El
-- indice unico no se degrada por numero de filas sino por el tamano del `in`, y la estimacion situa
-- el punto de quiebre entre 12 y 15 marcadores. Ampliar el vocabulario CERRADO se agota una decena de
-- marcadores antes de cubrir las interfaces medidas.
--
-- EL CRITERIO DE PERTENENCIA AL NUCLEO ES VERIFICABLE, NO CURADO: un dato pertenece al nucleo si y
-- solo si existe comparacion determinista escrita para el, o sea si `compararParametros`
-- (apps/worker/src/verificacion.ts) sabe compararlo contra el DOM. Hoy son seis (destinatario, monto,
-- producto, cantidad, asunto, cuerpo) y son exactamente los campos de `ParametrosDeclarados`. Fecha,
-- lugar y nombre existen en `MarcadorParametro` pero NO en `ParametrosDeclarados`: son de facto
-- vocabulario abierto disfrazado de cerrado, engordan 2^N y no aportan una sola comparacion. El test
-- apps/worker/test/nucleo-de-marcadores.test.ts DERIVA el nucleo de la comparacion escrita y falla si
-- alguien agrega un marcador a la clave sin escribir su comparacion.
--
-- QUE NO CAMBIA:
--  - el INDICE UNICO de V041 sigue siendo (dominios_clave, codigo_de_intencion, marcadores_clave).
--    Esta columna queda deliberadamente FUERA de la identidad y fuera de la busqueda por contencion:
--    solo DECLARA que datos abiertos pide el procedimiento, y el valor lo resuelve el consumidor al
--    aplicarlo, exactamente como hoy resuelve cualquier ranura.
--  - las filas existentes. Los cuatro marcadores en uso en produccion (asunto, cuerpo, destinatario)
--    son del nucleo, asi que ninguna clave se mueve y la columna nace en '[]' para todas. Cero filas
--    modificadas, cero corroboracion perdida, cero consumidores perdidos.
--
-- COMPATIBILIDAD HACIA ATRAS: mientras la columna no exista, el repositorio publica con el statement
-- de siempre (cae por SQLSTATE 42703 y lo recuerda), asi que el despliegue del codigo puede preceder
-- a esta migracion sin romper nada. Con la columna vacia, la conducta es identica a la de hoy.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico). Este archivo es IDEMPOTENTE: re-aplicarlo es un NO-OP.
-- Revertir es
--   alter table plantillas_compartidas drop column if exists marcadores_abiertos;

alter table plantillas_compartidas
  add column if not exists marcadores_abiertos jsonb not null default '[]'::jsonb;

comment on column plantillas_compartidas.marcadores_abiertos is
  'Marcadores del VOCABULARIO ABIERTO que los pasos exigen (los que no tienen comparacion determinista escrita: fecha, lugar, nombre). Lista JSON ordenada, derivada de los pasos igual que marcadores_clave. NO forma parte del indice unico ni de la busqueda por contencion: su dato lo resuelve el consumidor al aplicar la plantilla.';
