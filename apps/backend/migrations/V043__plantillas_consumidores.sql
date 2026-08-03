-- EVIDENCIA DE CONSUMO de una plantilla compartida (V043). Con el checkpoint de aprobacion humana
-- ELIMINADO del flujo de consumo (decision de producto: el consentimiento vive en los documentos
-- legales aceptados al conectar sitios, y la proteccion en runtime es tecnica), la corroboracion pasa
-- a medirse con evidencia de LAS DOS MITADES del ciclo: cuantos origenes DISTINTOS produjeron el
-- procedimiento (`origenes_hash`, V041) y cuantos consumidores DISTINTOS lo ejecutaron con EXITO
-- (esta columna). Con ambos en 2 o mas, la fila 'candidata' pasa a 'corroborada' (transicion que
-- escribe registrarEjecucion, en el mismo statement del update de contadores).
--
-- MISMO MECANISMO DE ANONIMATO que `origenes_hash`, y es la misma clave HMAC del worker (etiqueta
-- 'plantillas-compartidas/v1'): cada consumo exitoso agrega el hash del consumidor
-- (hashDeOrigenDePlantilla), deduplicado con la misma tecnica `@>` del on conflict de la publicacion.
-- Es un CONTADOR DE DISTINTOS, no un identificador: de una sola via, y sin la clave (que vive solo en
-- el worker, nunca en esta base) no se puede ni confirmar una sospecha comparando hashes. Los FALLOS
-- no escriben aqui: solo el exito es evidencia de que el procedimiento funciona en otra cuenta.
--
-- SIN BACKFILL RETROACTIVO, a proposito: los consumos exitosos anteriores a esta migracion no
-- registraron QUIEN consumio (la columna no existia), asi que la corroboracion se gana con los
-- proximos exitos. El default '[]' deja a todas las filas existentes con cero consumidores contados.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico). Este archivo es IDEMPOTENTE: re-aplicarlo es un NO-OP.
-- Revertir es
--   alter table plantillas_compartidas drop column if exists consumidores_hash;

alter table plantillas_compartidas
  add column if not exists consumidores_hash jsonb not null default '[]'::jsonb;

comment on column plantillas_compartidas.consumidores_hash is
  'HMAC-SHA256 (hex) de los consumidores DISTINTOS que ejecutaron esta plantilla con exito. Contador de distintos, no identificador; misma clave y misma etiqueta de derivacion que origenes_hash.';
