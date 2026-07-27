-- AUTO REPARACION DE RECETAS WEB (V035): registro de QUE ESTRATEGIA GANO en cada paso de cada
-- ejecucion exitosa, para poder PROMOVER a primaria la que gana de forma consistente cuando la
-- primaria falla de forma consistente.
--
-- POR QUE, medido en produccion: en Gmail los ids son dinamicos por sesion (:u3, :q9), asi que la
-- estrategia primaria por atributo id falla en CADA corrida y el paso siempre se resuelve con un
-- fallback (rol accesible, texto). Funciona, pero cada corrida paga la latencia de probar primero
-- una estrategia que jamas va a resolver, y la receta nunca mejora sola.
--
-- QUE SE GUARDA. `ganadoras` es un jsonb por receta con, POR PASO, las ultimas ejecuciones exitosas
-- y la estrategia que resolvio el elemento en cada una:
--   { "<idx del paso>": [ { "indice": 1, "clave": "rol", "jobId": "...", "en": "<iso>" }, ... ] }
-- Se retienen solo las ultimas 5 entradas por paso (la regla de promocion mira las ultimas 2). Lo
-- escribe EXCLUSIVAMENTE el worker al cerrar una ejecucion exitosa por receta; las fallidas no
-- registran nada. La forma exacta y la regla viven en apps/worker/src/promocion-estrategias.ts.
--
-- PRIVACIDAD: `clave` es el TIPO de la estrategia (y el nombre del atributo cuando aplica: "rol",
-- "atributo:aria-label"), jamas su valor. Aqui no entra ningun texto leido del sitio.
--
-- `ajustes_automaticos` cuenta cuantas promociones aplico la receta sobre si misma. Es lo que la
-- consola muestra como "Se ajusto sola N veces" en la pantalla de tareas ensenadas.
--
-- CONCURRENCIA: el worker actualiza `ganadoras` (y, si promueve, `pasos`) en UN solo UPDATE
-- condicionado por la `version` leida. Dos corridas simultaneas de la misma receta no se pisan a
-- medias: la que llega tarde no coincide en version y no escribe (la ultima que gano la carrera
-- manda, el shape nunca queda corrupto).
--
-- ESTA TABLA NO ES `recipes` (V013). Ver la cabecera de V035.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico: ni el backend, ni el worker, ni CI las ejecutan). Este archivo
-- es IDEMPOTENTE: re-aplicarlo es un NO-OP. Revertir es
--   alter table recetas_web drop column if exists ganadoras;
--   alter table recetas_web drop column if exists ajustes_automaticos;

alter table recetas_web add column if not exists ganadoras jsonb not null default '{}'::jsonb;

alter table recetas_web add column if not exists ajustes_automaticos integer not null default 0
  check (ajustes_automaticos >= 0);

-- Las dos columnas las escribe solo el worker con el rol de servicio, igual que el resto de la
-- tabla. El REVOKE de V035 sigue vigente y se repite aqui por si esta migracion se aplicara sola.
revoke insert, update, delete on recetas_web from authenticated, anon;
