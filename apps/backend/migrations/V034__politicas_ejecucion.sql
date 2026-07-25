-- POLITICA DE EJECUCION por usuario: los tres ajustes que el dueno de la cuenta configura UNA SOLA
-- VEZ y que gobiernan si una accion que NO se puede deshacer (enviar, pagar, comprar, borrar) se
-- ejecuta o se detiene. Sustituye a la aprobacion por accion como comportamiento POR DEFECTO: la
-- proteccion pasa a ser la VERIFICACION DETERMINISTA previa (el worker compara lo que el usuario
-- pidio contra lo que hay en el sitio antes de ejecutar) mas esta politica, en lugar de una pregunta
-- al usuario en cada accion.
--
-- Que NO cambia esta migracion: aprobaciones_web e intervenciones_art22 (V027) siguen EXISTIENDO,
-- con sus datos, sus policies y su registro Art.22 intacto. Son un artefacto de cumplimiento (GDPR
-- Art.22 / LFPDPPP): el derecho a intervencion humana no desaparece porque el flujo por defecto ya
-- no la pida. Esta tabla solo agrega las preferencias que deciden CUANDO una accion se detiene.
--
-- Los tres ajustes (D3 del diseno):
--   ejecutar_acciones_irreversibles = false -> ninguna accion de la lista se ejecuta; se reporta.
--   tope_monto_sin_confirmacion            -> monto MAXIMO en MXN que puede ejecutarse sin detenerse.
--                                             El default 0 es deliberado y conservador: hasta que el
--                                             usuario configure un tope, ninguna accion con monto se
--                                             ejecuta.
--   sitios_excluidos                       -> dominios donde JAMAS se ejecutan acciones irreversibles.
--
-- Tenancy: owner_id = sub del JWT (text), IDENTICO a jobs (V008), sitios_conectados (V024) y
-- aprobaciones_web (V027). Una fila por owner (owner_id es la PK). La AUSENCIA de fila es un estado
-- valido y esperado: el worker usa los defaults y NO crea la fila (solo la crea el usuario al
-- guardar su configuracion).
--
-- Seguridad, mismo patron que sitios_conectados (V024): RLS con SELECT propio y REVOKE de las
-- escrituras a los roles de cliente. La politica se escribe EXCLUSIVAMENTE server-side (PUT
-- /v1/politicas-ejecucion con el owner del token): permitir INSERT/UPDATE por PostgREST dejaria que
-- un cliente elevara su propio tope sin pasar por la validacion del backend.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico: ni el backend, ni el worker, ni CI las ejecutan). Este archivo
-- es IDEMPOTENTE: re-aplicarlo es un NO-OP. Revertir es
-- `drop table if exists politicas_ejecucion;` (tabla nueva, sin FKs entrantes).

create table if not exists politicas_ejecucion (
  -- Dueno de la politica (sub del JWT). PK: UNA politica por usuario, sin filas duplicadas posibles.
  owner_id                        text primary key,
  -- false = ninguna accion irreversible se ejecuta; la tarea se detiene y lo reporta.
  ejecutar_acciones_irreversibles boolean not null default true,
  -- Monto maximo en MXN que puede ejecutarse sin detener la tarea. 0 (default) = ninguna accion con
  -- monto se ejecuta. CHECK >= 0: un tope negativo no significa nada y abriria comparaciones raras.
  tope_monto_sin_confirmacion     numeric not null default 0 check (tope_monto_sin_confirmacion >= 0),
  -- Dominios donde JAMAS se ejecutan acciones irreversibles (p.ej. '{banco.com,sat.gob.mx}').
  sitios_excluidos                text[] not null default '{}',
  creada_en                       timestamptz not null default now(),
  actualizada_en                  timestamptz not null default now()
);

alter table politicas_ejecucion enable row level security;

-- CREATE POLICY no admite IF NOT EXISTS; el drop-if-exists previo lo hace idempotente sin tocar datos.
drop policy if exists "politicas_ejecucion_select_own" on politicas_ejecucion;
create policy "politicas_ejecucion_select_own"
  on politicas_ejecucion for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

-- Cinturon y tirantes: ademas de NO tener policies de escritura, se revocan los privilegios de
-- escritura directa a los roles de cliente (mismo endurecimiento que V023/V024). SELECT se conserva
-- para que la policy de arriba pueda aplicar.
revoke insert, update, delete on politicas_ejecucion from authenticated, anon;
