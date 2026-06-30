-- MECANISMO DE DISPARO del scheduler (Fase 5.3). Define las FUNCIONES SQL que, corriendo cada minuto,
-- revisan las tareas programadas (V009) cuyo horario llego e INSERTAN un job 'pending' en la cola
-- `jobs` (V008) que el worker (5.2) ya ejecuta. Aqui SOLO van las funciones (SQL puro, sin depender de
-- la extension pg_cron). La ACTIVACION (create extension pg_cron + cron.schedule) va por SEPARADO en
-- V011__scheduler_pgcron_activation.sql, porque requiere privilegios de operador y solo se hace una vez.
--
-- Operacion: se aplica A MANO en el SQL Editor de Supabase, IGUAL que el resto. Es IDEMPOTENTE: usa
-- CREATE OR REPLACE, asi que re-aplicarlo reemplaza las funciones sin error ni perdida de datos.
--
-- =============================================================================================
-- DECISION CLAVE: como se calcula el PROXIMO next_run_at desde el cron_expression del usuario.
-- ---------------------------------------------------------------------------------------------
-- pg_cron programa SU PROPIA funcion (cada minuto), pero NO expone un parser que calcule "el proximo
-- match de ESTE cron de usuario". Las opciones eran: (a) calcularlo en SQL, (b) que el backend lo
-- calcule y se lo pase, (c) otra via. Elegimos un HIBRIDO robusto y sin dependencias nuevas:
--   * El BACKEND (TypeScript, testeado en CI sin Postgres) calcula next_run_at al crear/editar una
--     tarea (apps/backend/src/scheduling/cron.ts -> nextCronRun).
--   * El DISPARO avanza next_run_at por SI MISMO con la funcion SQL GEMELA scheduler_cron_next (abajo),
--     asi el scheduler no depende del backend en cada corrida (auto-contenido en la base).
-- Ambas implementaciones interpretan el MISMO subconjunto de cron estandar de 5 campos, en UTC. El
-- "proximo match" NO se calcula con un parser fragil de saltos de calendario, sino por BARRIDO minuto a
-- minuto (generate_series) delegando TODA la aritmetica de fechas a Postgres: solo escribimos el
-- matcheo de UN instante contra el cron, que es simple y robusto. Ver docs/scheduler-pgcron.md.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- scheduler_cron_field_matches(spec, val, fmin, fmax): true si el valor `val` matchea UN campo cron
-- `spec` (con limites [fmin,fmax]). Soporta: '*', '*' con paso, valor, rango 'a-b', rango/valor con
-- paso 'a-b/n' / 'a/n', y listas con coma. Asume el spec bien formado (el backend lo valida antes de
-- insertar; la insercion solo ocurre server-side). Matchea UN valor: sin aritmetica de calendario.
-- ---------------------------------------------------------------------------------------------
create or replace function scheduler_cron_field_matches(spec text, val int, fmin int, fmax int)
returns boolean
language plpgsql
immutable
as $$
declare
  part      text;
  rangepart text;
  lo        int;
  hi        int;
  step      int;
begin
  foreach part in array string_to_array(spec, ',') loop
    step := 1;
    rangepart := part;
    if position('/' in part) > 0 then
      rangepart := split_part(part, '/', 1);
      step := nullif(split_part(part, '/', 2), '')::int;
    end if;

    if rangepart = '*' then
      lo := fmin;
      hi := fmax;
    elsif position('-' in rangepart) > 0 then
      lo := split_part(rangepart, '-', 1)::int;
      hi := split_part(rangepart, '-', 2)::int;
    else
      lo := rangepart::int;
      -- 'a/n' = 'a-max/n'; 'a' sin paso = solo a.
      if position('/' in part) > 0 then hi := fmax; else hi := lo; end if;
    end if;

    if step >= 1 and val >= lo and val <= hi and ((val - lo) % step) = 0 then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- scheduler_cron_matches(expr, ts): true si el instante `ts` (en UTC) matchea la expresion cron de 5
-- campos. Aplica la regla estandar de Vixie para dia-del-mes vs dia-de-semana: si AMBOS estan
-- restringidos (ninguno es '*'), matchea con OR; si alguno es '*', se aplica el otro (AND con comodin).
-- Domingo es 0 (extract dow); aceptamos tambien 7 en el spec. Gemela de cronMatchesAt en TypeScript.
-- ---------------------------------------------------------------------------------------------
create or replace function scheduler_cron_matches(expr text, ts timestamptz)
returns boolean
language plpgsql
immutable
as $$
declare
  f         text[];
  u         timestamp;  -- wall-clock UTC
  mn        int;
  hr        int;
  dom       int;
  mon       int;
  dow       int;
  dom_field text;
  dow_field text;
  dom_match boolean;
  dow_match boolean;
begin
  f := regexp_split_to_array(btrim(expr), '\s+');
  if array_length(f, 1) is distinct from 5 then
    return false;
  end if;

  u := ts at time zone 'UTC';
  mn  := extract(minute from u)::int;
  hr  := extract(hour   from u)::int;
  dom := extract(day    from u)::int;
  mon := extract(month  from u)::int;
  dow := extract(dow    from u)::int;  -- 0..6, 0 = domingo
  dom_field := f[3];
  dow_field := f[5];

  if not scheduler_cron_field_matches(f[1], mn,  0, 59) then return false; end if;
  if not scheduler_cron_field_matches(f[2], hr,  0, 23) then return false; end if;
  if not scheduler_cron_field_matches(f[4], mon, 1, 12) then return false; end if;

  dom_match := scheduler_cron_field_matches(dom_field, dom, 1, 31);
  dow_match := scheduler_cron_field_matches(dow_field, dow, 0, 7)
               or (dow = 0 and scheduler_cron_field_matches(dow_field, 7, 0, 7));

  if dom_field <> '*' and dow_field <> '*' then
    return dom_match or dow_match;
  else
    return dom_match and dow_match;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- scheduler_cron_next(expr, from_ts): el PROXIMO instante (UTC, truncado al minuto) ESTRICTAMENTE
-- posterior al minuto de `from_ts` que matchea el cron. null si no hay match en 1461 dias / 4 anios
-- (cron imposible, p.ej. '0 0 30 2 *'; 4 anios cubren el proximo 29 de febrero). Barrido minuto a
-- minuto con generate_series + corte temprano: para un cron tipico el primer match aparece en <= 1440
-- iteraciones; el LOOP sobre el query usa un cursor y NO materializa la serie. El horizonte de 1461
-- dias DEBE coincidir con HORIZON_MINUTES de la funcion gemela nextCronRun en TypeScript.
-- ---------------------------------------------------------------------------------------------
create or replace function scheduler_cron_next(expr text, from_ts timestamptz)
returns timestamptz
language plpgsql
stable
as $$
declare
  candidate timestamptz;
begin
  for candidate in
    select g
    from generate_series(
      date_trunc('minute', from_ts) + interval '1 minute',
      date_trunc('minute', from_ts) + interval '1461 days',
      interval '1 minute'
    ) as g
  loop
    if scheduler_cron_matches(expr, candidate) then
      return candidate;
    end if;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- enqueue_due_scheduled_tasks(): el corazon del disparo. La PROGRAMA pg_cron para correr cada minuto
-- (V011). Por cada tarea ACTIVA cuyo next_run_at ya vencio: encola un job 'pending' (copiando
-- agent_id, owner_id, credential_id, payload) y AVANZA la tarea (last_run_at = now(), next_run_at = el
-- proximo match). Devuelve cuantos jobs encolo.
--
-- IDEMPOTENCIA / SIN DUPLICADOS bajo concurrencia: el UPDATE ... RETURNING dentro del CTE `due` es UN
-- solo statement atomico que SELECCIONA-y-AVANZA las tareas vencidas a la vez. Postgres toma un lock de
-- fila por cada tarea que actualiza; una segunda corrida concurrente que llegue a la misma fila la ve
-- con next_run_at YA avanzado (futuro) y por tanto FUERA del filtro next_run_at <= now(): no la vuelve a
-- encolar. El INSERT inserta exactamente un job por fila efectivamente avanzada. Si next_run_at quedara
-- null (cron imposible), la tarea no se vuelve a seleccionar (filtro next_run_at is not null).
--
-- COMPORTAMIENTO ANTE ATRASOS: si el disparo no corrio por un rato (base caida), cada tarea vencida
-- dispara UNA sola vez al volver (no una corrida por cada minuto perdido) y luego avanza al proximo
-- match futuro. Es el comportamiento estandar "sin catch-up atronador".
-- ---------------------------------------------------------------------------------------------
create or replace function enqueue_due_scheduled_tasks()
returns integer
language plpgsql
as $$
declare
  enqueued integer;
begin
  with due as (
    update scheduled_tasks st
    set
      last_run_at = now(),
      next_run_at = scheduler_cron_next(st.cron_expression, now()),
      updated_at  = now()
    where st.is_active = true
      and st.next_run_at is not null
      and st.next_run_at <= now()
    returning st.agent_id, st.owner_id, st.credential_id, st.payload
  )
  insert into jobs (agent_id, owner_id, credential_id, payload, status)
  select agent_id, owner_id, credential_id, payload, 'pending'
  from due;

  get diagnostics enqueued = row_count;
  return enqueued;
end;
$$;
