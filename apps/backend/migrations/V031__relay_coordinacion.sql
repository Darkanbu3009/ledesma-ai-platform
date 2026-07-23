-- COORDINACION DEL RELAY DE TECLADO MOVIL (B-1): estado COMPARTIDO por todas las instancias del servicio
-- relay para que dos instancias solapadas (la ventana de un rolling deploy en Railway) NO puedan consumir
-- el mismo token dos veces ni abrir dos canales a la misma sesion de login. El uso unico del jti y el lock
-- "un solo canal por conexion" son INVARIANTES DE SEGURIDAD; vivian en la memoria de cada proceso del
-- relay (single-use.ts / rate-limit.ts) y por eso se rompian con multiples instancias.
--
-- El relay NO toca esta base (sigue SIN DATABASE_URL). Media el BACKEND por su listener INTERNO
-- (src/routes/internal-relay.ts, alcanzable solo por la red privada de Railway), que expone consumir el
-- jti y tomar/liberar el lock de forma ATOMICA aca. El relay se autentica con una MAC del RELAY_TOKEN_SECRET
-- que ya comparte con el backend.
--
-- MINIMO CONOCIMIENTO: de un jti se guarda solo su SHA-256 (hash), nunca el jti en claro; del lock solo el
-- connection_id (id de la fila sitios_conectados), un nonce opaco de la sesion del relay y la expiracion.
-- Cero contenido de pulsaciones, cero credenciales.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de Supabase
-- (no hay runner automatico: ni el backend ni CI las ejecutan). Este archivo es IDEMPOTENTE: re-aplicarlo
-- es un NO-OP y reproduce el mismo esquema en una base vacia. Revertir es
-- `drop table if exists relay_jti_consumidos, relay_conexiones_activas;` (tablas nuevas sin FKs entrantes).

-- USO UNICO del jti: la PRESENCIA del hash del jti significa "ya consumido". El consumo es un INSERT con
-- ON CONFLICT DO NOTHING: solo la PRIMERA instancia inserta (canal autorizado); una segunda choca contra
-- la PK y no inserta (reuso -> rechazo). Se retiene hasta exp (pasado eso el token ya no verifica).
create table if not exists relay_jti_consumidos (
  jti_hash    text primary key,          -- SHA-256 (hex) del jti; nunca el jti en claro
  exp         bigint not null,           -- expiracion epoch segundos del token (para purgar)
  consumido_en timestamptz not null default now()
);

-- Barrido por expiracion (purga periodica). La PK ya cubre la busqueda por jti_hash del consumo.
create index if not exists relay_jti_consumidos_exp_idx on relay_jti_consumidos (exp);

-- LOCK por conexion: a lo sumo UNA fila por connection_id => a lo sumo un canal vivo por conexion. Tomar
-- es un INSERT con ON CONFLICT que solo pisa un lock VENCIDO (exp <= ahora): asi un crash del relay no deja
-- la conexion trabada mas alla de la vida del token. lock_nonce identifica la sesion del relay que tiene el
-- lock, para que SOLO ella lo libere (no pisar un lock ya retomado por otra sesion).
create table if not exists relay_conexiones_activas (
  connection_id text primary key,        -- id de la fila sitios_conectados (unidad de exclusion)
  lock_nonce    text not null,           -- nonce opaco de la sesion del relay que tomo el lock
  exp           bigint not null,         -- expiracion epoch segundos (auto-liberacion ante crash)
  tomado_en     timestamptz not null default now()
);

create index if not exists relay_conexiones_activas_exp_idx on relay_conexiones_activas (exp);

-- RLS deny-all (cinturon y tirantes). Estas tablas son coordinacion interna: NADIE las toca por PostgREST.
-- El backend se conecta con el rol de servicio (pooler) que OMITE RLS; habilitar RLS sin policies deja
-- fuera a authenticated/anon. Mismo endurecimiento que sitios_conectados (V024) / upgrade_requests (V023).
alter table relay_jti_consumidos enable row level security;
alter table relay_conexiones_activas enable row level security;
revoke insert, update, delete, select on relay_jti_consumidos from authenticated, anon;
revoke insert, update, delete, select on relay_conexiones_activas from authenticated, anon;

-- PURGA de filas vencidas (acota la memoria/tamano; ambas tablas viven una ventana de <= 15 min). Se puede
-- invocar a demanda o programar por pg_cron (ver el bloque OPCIONAL de abajo). Idempotente.
create or replace function relay_coordinacion_purgar()
returns void
language sql
as $$
  delete from relay_jti_consumidos where exp < extract(epoch from now());
  delete from relay_conexiones_activas where exp < extract(epoch from now());
$$;

-- =============================================================================================
-- OPCIONAL: purga automatica cada 10 minutos con pg_cron (mismo patron que V011/V016). Descomentar para
-- activarla. Requiere la extension pg_cron habilitada (una sola vez por base; ya activada si se uso el
-- scheduler o la retencion). Sin esto, las tablas se mantienen chicas igual (ventana <= 15 min) y se puede
-- purgar a demanda con `select relay_coordinacion_purgar();`.
-- ---------------------------------------------------------------------------------------------
-- create extension if not exists pg_cron;
-- do $$
-- begin
--   if exists (select 1 from cron.job where jobname = 'relay-coordinacion-purgar') then
--     perform cron.unschedule('relay-coordinacion-purgar');
--   end if;
-- end
-- $$;
-- select cron.schedule('relay-coordinacion-purgar', '*/10 * * * *', $$select relay_coordinacion_purgar();$$);
