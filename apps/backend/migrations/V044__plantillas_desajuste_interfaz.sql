-- DESAJUSTE DE INTERFAZ (V044): evidencia ESTRUCTURAL de que una plantilla compartida ya no
-- describe la pagina que el sitio sirve. La produce la SONDA DE RECONOCIMIENTO previa del worker
-- (pre-flight, sin modelo y sin ejecutar un solo paso): antes de correr un procedimiento aprendido,
-- el worker lee la estructura de la pagina de partida y comprueba que las clases de elemento
-- OBSERVABLES que el procedimiento declara sigan existiendo, con la misma derivacion canonica de
-- clase que la barrera de identidad. Si falta alguna, la tarea cae al motor libre SIN tocar el DOM
-- y el desajuste queda registrado aqui.
--
-- POR QUE UN CONTADOR PROPIO Y NO `fallos_consecutivos` (D4): un desajuste no es un fallo de
-- ejecucion (no se ejecuto nada) y su evidencia es menos ambigua que la de un fallo. El retiro por
-- desajuste exige DOS CONSUMIDORES DISTINTOS: dos desajustes del mismo consumidor pueden ser una
-- cohorte minoritaria de un experimento del sitio (la variante vieja sigue sirviendose al resto),
-- mientras que dos consumidores distintos dicen que el sitio cambio para todos. Por eso la columna
-- guarda HASHES de consumidor y no un entero: su LARGO es el umbral.
--
-- MISMO MECANISMO DE ANONIMATO que `origenes_hash` y `consumidores_hash` (V041/V043): HMAC-SHA256
-- del consumidor con la clave de plantillas del worker (etiqueta 'plantillas-compartidas/v1'),
-- deduplicado con la tecnica `@>` dentro del mismo statement. Contador de distintos, no
-- identificador: de una sola via, y la clave nunca vive en esta base.
--
-- El CHECK de `ultima_falla_motivo` (V042) se extiende con el motivo 'desajuste_de_interfaz', el
-- mismo del vocabulario cerrado de MOTIVOS_DE_FALLA_DE_PLANTILLA (packages/shared). Se reemplaza de
-- forma idempotente con el patron de V036/V041 (ADD CONSTRAINT no admite IF NOT EXISTS). El nombre
-- del constraint es el que Postgres autogenero al crear la columna con su CHECK en V042.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico). Este archivo es IDEMPOTENTE: re-aplicarlo es un NO-OP.
-- Revertir es
--   alter table plantillas_compartidas drop column if exists desajustes_hash;
--   alter table plantillas_compartidas drop constraint if exists plantillas_compartidas_ultima_falla_motivo_check;
--   alter table plantillas_compartidas add constraint plantillas_compartidas_ultima_falla_motivo_check
--     check (ultima_falla_motivo is null
--       or ultima_falla_motivo in ('barrera_bloqueada', 'sin_efecto', 'abandonada', 'sesion'));

alter table plantillas_compartidas
  add column if not exists desajustes_hash jsonb not null default '[]'::jsonb;

comment on column plantillas_compartidas.desajustes_hash is
  'HMAC-SHA256 (hex) de los consumidores DISTINTOS cuya sonda pre-flight detecto un desajuste de interfaz. Contador de distintos, no identificador; misma clave y misma etiqueta de derivacion que origenes_hash. Con 2 o mas, la fila pasa a retirada.';

do $$
begin
  alter table plantillas_compartidas
    drop constraint if exists plantillas_compartidas_ultima_falla_motivo_check;
  alter table plantillas_compartidas
    add constraint plantillas_compartidas_ultima_falla_motivo_check
    check (
      ultima_falla_motivo is null
      or ultima_falla_motivo in (
        'barrera_bloqueada',
        'sin_efecto',
        'abandonada',
        'sesion',
        'desajuste_de_interfaz'
      )
    );
end
$$;
