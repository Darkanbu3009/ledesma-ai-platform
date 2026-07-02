# Auditoria de seguridad #5 de 12 -- RLS y seguridad a nivel de base de datos

- **Alcance**: capa de BASE DE DATOS. Verifica que las politicas Row Level Security (RLS) de Supabase
  aislen los datos por `owner_id` como SEGUNDA CAPA de defensa (que pasa si el filtrado de la aplicacion
  falla y una query llega directo a la DB con las credenciales de un usuario `authenticated`), y audita
  TODAS las migraciones V001-V017 (esquema, permisos, integridad). La auditoria #2 cubrio el aislamiento
  en la capa de APLICACION (`WHERE owner_id` en el codigo, con el rol de servicio que IGNORA RLS); ESTA
  cubre la red de seguridad que hay debajo.
- **Fuente de verdad**: los 17 archivos SQL en `apps/backend/migrations/` (V001..V017), leidos linea por
  linea. Es el DDL versionado. **Nota critica**: en este repo las migraciones se aplican A MANO en el SQL
  Editor de Supabase (no hay runner automatico: ni el backend ni CI las ejecutan; confirmado en los
  comentarios de V005:11-13, V006:7-9, etc.). Por tanto **el estado REAL en prod puede diferir del DDL
  versionado**. Cada hallazgo sensible a esa diferencia trae su query de verificacion en la seccion 11.
- **Fecha**: 2026-07-02.
- **Metodo**: lectura manual del DDL + verificacion adversarial (bateria de agentes que re-leyeron las
  migraciones para confirmar/refutar cada hallazgo y un barrido de completitud sobre todo el esquema).
  Read-only: no se ejecuto DDL, no se toco codigo, migraciones ni la base, no se consulto produccion.
- **Tipo**: auditoria adversarial de seguridad de base de datos. Pregunta central en cada punto: *"si el
  filtrado de la aplicacion fallara y una query llegara a la DB con las credenciales de un usuario
  `authenticated` cualquiera, RLS lo detendria de ver/tocar datos de otro owner?"*.

---

## 1. Resumen ejecutivo

**Veredicto (una frase): RLS es una red de seguridad EFECTIVA EN 10 DE 14 TABLAS, CON UN HUECO CRITICO en
las 4 tablas de identidad/registro (`organizations`, `profiles`, `subscriptions`, `usage_counters`), que
NO tienen RLS ni politicas.** En el modelo de exposicion por defecto de Supabase (Data API / PostgREST
activa + grants por defecto a `anon`/`authenticated` en el schema `public`, que el repo nunca revoca),
ese hueco permite a cualquier usuario `authenticated` leer datos de identidad de TODOS los owners
(PII: `full_name`, `org_id`, `account_type`, `role`, `tier`) y -- si tiene grants de escritura, tambien
default en Supabase -- **auto-promoverse `tier = 'autonomous'`** (escalada de privilegios que saltea el
gate admin), auto-aprobar su organizacion o subir su propia cuota. Las otras 10 tablas de negocio tienen
RLS impecable (`owner_id = auth.jwt() ->> 'sub'`, `to authenticated`, fail-closed), no hay funciones
`SECURITY DEFINER`, no hay vistas, no existe el schema `ia_admin`, y las funciones de `pg_cron` respetan
el owner correctamente.

**El modelo de dos capas** (fundamental para leer este informe): el backend y el worker se conectan con
`DATABASE_URL` usando el **rol de servicio del pooler** de Supabase (`apps/backend/src/db/client.ts:11`),
que **IGNORA RLS**. Para esas vias, la unica defensa es el `WHERE owner_id` del codigo (auditoria #2:
AISLA). RLS solo aplica al rol **`authenticated`** (y `anon`) cuando la consola/un cliente consulta
Supabase DIRECTAMENTE via PostgREST/supabase-js con el JWT del usuario. La consola YA instancia ese
cliente con la anon key publica (`apps/console/src/lib/supabase.ts:6`); hoy solo lo usa para Auth y para
Storage (no hay `.from('<tabla>')` a PostgREST en el codigo del console), pero el endpoint `/rest/v1` es
intrinsecamente alcanzable por cualquiera que tenga la anon key (embebida en el bundle del navegador).
**Ahi es donde RLS protege de verdad -- y donde las 4 tablas sin RLS quedan expuestas.**

Hallazgos por severidad:

| Severidad | Cantidad | Naturaleza |
|-----------|----------|------------|
| CRITICA   | 1        | RLS ausente en las 4 tablas de identidad/registro -> lectura cross-tenant de PII/negocio (CRITICA-1). |
| ALTA      | 1        | Misma raiz, camino de ESCRITURA: escalada de privilegios de `tier`/aprobacion/cuota via PostgREST (ALTA-1). |
| MEDIA     | 3        | CHECKs de enum faltantes (M-1); `retention_purge_expired` sin guard de dias -> borrado de datos recientes ante mis-call (M-2); ausencia total de GRANT/REVOKE explicito (M-3). |
| BAJA      | 5        | Higiene / defensa en profundidad (B-1..B-5). |

CRITICA-1 y ALTA-1 comparten raiz (la ausencia de RLS en `V005`/`V007`) y **un solo fix** las cierra
ambas. Su explotabilidad final es CONDICIONAL al estado real de prod (Data API activa + grants), que las
migraciones no garantizan ni por tanto descartan: confirmar con las queries de la seccion 11. Aun si prod
tuviera RLS puesta a mano, **las migraciones no reproducen esa postura segura desde cero**, contradiciendo
su objetivo declarado (V002:11-12: "una recreacion desde cero tenga la misma postura").

---

## 2. Modelo de acceso y roles (que rol usa cada via)

| Via de acceso | Rol de Postgres | RLS aplica? | Defensa efectiva |
|---------------|-----------------|:-----------:|------------------|
| Backend HTTP (`apps/backend`) | rol de servicio (pooler, `DATABASE_URL`) | **NO** (lo omite) | `WHERE owner_id` del codigo (auditoria #2) |
| Worker (`apps/worker`) | rol de servicio (`DATABASE_URL`) | **NO** | `WHERE owner_id` del codigo (auditoria #2) |
| `pg_cron` (scheduler V011, retencion V016) | superusuario/owner del cron | **NO** (BYPASSRLS) | logica de la funcion (owner copiado de la fila) |
| Consola / supabase-js con JWT de usuario | **`authenticated`** | **SI** | **las politicas RLS de este informe** |
| Cliente con solo anon key (sin login) | **`anon`** | **SI** | RLS (fail-closed si la policy es `to authenticated`) |

Conclusiones del modelo:
- **Donde RLS protege de verdad**: en la via `authenticated`/`anon` -> PostgREST. Es la unica capa ahi.
- **Donde la unica defensa es el codigo**: en backend/worker (rol de servicio). RLS es irrelevante para
  ellos por diseno; el codigo es la defensa primaria (auditoria #2 confirma que AISLA).
- **Consecuencia del hueco (CRITICA-1)**: para las 10 tablas con RLS, un fallo del codigo que dejara pasar
  una query `authenticated` sigue frenado por RLS. Para las 4 tablas SIN RLS, ese fallo -- o directamente
  un cliente que hable a PostgREST -- no tiene ninguna red debajo.

---

## 3. Inventario de migraciones V001-V017

Numeracion **sin huecos** (V001..V017, 17 archivos, 1 c/u). DDL **mayormente idempotente**
(`create ... if not exists`, `create or replace`, `drop policy if exists`, `add column if not exists`):
ningun statement lanza error al re-aplicarse. Excepciones de convergencia en B-4.

| Mig | Objeto(s) que crea/modifica | Proposito | RLS en la mig |
|-----|-----------------------------|-----------|:-------------:|
| V001 | tabla `agents` (+ index owner_id) | config de agentes (nunca llaves de proveedor) | no (la habilita V002) |
| V002 | `enable RLS` + 4 policies en `agents` (S/I/U/D) | 2a capa de aislamiento de agents | **si** |
| V003 | tabla `agent_runs` + index + `enable RLS` + policy SELECT | auditoria de corridas (solo metadatos) | **si** |
| V004 | columna `agents.webhook_secret` (default volatil, NOT NULL) | secreto de firma de webhooks SALIENTES | (hereda agents) |
| V005 | tablas `organizations`, `profiles`, `subscriptions`, `usage_counters` (+ FKs, ADD COLUMN idempotentes) | registro multi-tenant | **NO (hueco -> CRITICA-1)** |
| V006 | tabla `provider_credentials` + index + `enable RLS` + 4 policies (S/I/U/D) | boveda de credenciales cifradas AES-256-GCM | **si (CRUD, ver B-1)** |
| V007 | columna `profiles.tier` + CHECK (`free`/`pro`/`autonomous`) | gate de features por plan (modo autonomo) | **NO (profiles sin RLS -> ALTA-1)** |
| V008 | tabla `jobs` + 3 indices + `enable RLS` + policy SELECT | cola de ejecucion autonoma | **si (SELECT)** |
| V009 | tabla `scheduled_tasks` + 2 indices + `enable RLS` + policy SELECT | plantillas de tareas programadas | **si (SELECT)** |
| V010 | 4 funciones `plpgsql` (matcheo cron + `enqueue_due_scheduled_tasks`) | disparo del scheduler (SQL puro) | n/a (INVOKER) |
| V011 | `create extension pg_cron` + `cron.schedule` (cada minuto) | activa el disparo por horario | n/a |
| V012 | tabla `triggers` + CHECK coherencia auth + UNIQUE parcial + index + `enable RLS` + policy SELECT | webhooks entrantes autenticados | **si (SELECT)** |
| V013 | tabla `recipes` + CHECK steps no vacio + index + `enable RLS` + policy SELECT | flujos lineales multi-paso | **si (SELECT)** |
| V014 | tablas `consents`, `data_subject_requests`, `processing_records` + indices + `enable RLS` + 3 policies SELECT | privacidad/cumplimiento (LFPDPPP/GDPR) | **si (SELECT)** |
| V015 | 2 indices por edad + funcion `retention_purge_expired` (SECURITY INVOKER) | purga conservadora por retencion | n/a (INVOKER, ver M-2) |
| V016 | `create extension pg_cron` + `cron.schedule` (diario 03:00 UTC) | activa la purga automatica (opt-in) | n/a |
| V017 | index `jobs (owner_id, created_at desc)` | historial de jobs por owner (GET /v1/jobs) | n/a |

Objetos totales confirmados: **14 tablas**, **5 funciones** (todas SECURITY INVOKER), **2 cron jobs**,
**0 vistas**, **0 esquemas custom** (solo se referencian `cron` de pg_cron y `auth` de Supabase; ningun
`ia_admin`).

---

## 4. Matriz de RLS por tabla (el corazon del informe)

Predicado abreviado `= sub` significa `owner_id = (auth.jwt() ->> 'sub')`. Todas las policies existentes
son `to authenticated`. "Escritura via RLS" = si un cliente `authenticated` puede INSERT/UPDATE/DELETE
directo por PostgREST.

| # | Tabla | Mig | RLS habilitado | Policies (cmd) | Predicado | Rol que protege | Escritura via RLS |
|---|-------|-----|:--------------:|----------------|-----------|-----------------|-------------------|
| 1 | `agents` | V001/V002:13 | **SI** | SELECT, INSERT, UPDATE, DELETE (V002:19,26,33,41) | `= sub` (INSERT/UPDATE en `with check`) | authenticated | SI, acotada a `owner=sub` (B-1) |
| 2 | `agent_runs` | V003:19 | **SI** | SELECT (V003:23) | `= sub` | authenticated | no (server-side) |
| 3 | `provider_credentials` | V006:34 | **SI** | SELECT, INSERT, UPDATE, DELETE (V006:40,47,54,62) | `= sub` | authenticated | SI, acotada a `owner=sub` (**B-1**) |
| 4 | `jobs` | V008:68 | **SI** | SELECT (V008:72) | `= sub` | authenticated | no (server-side) |
| 5 | `scheduled_tasks` | V009:64 | **SI** | SELECT (V009:68) | `= sub` | authenticated | no (server-side) |
| 6 | `triggers` | V012:84 | **SI** | SELECT (V012:88) | `= sub` | authenticated | no (server-side) |
| 7 | `recipes` | V013:83 | **SI** | SELECT (V013:87) | `= sub` | authenticated | no (server-side) |
| 8 | `consents` | V014:60 | **SI** | SELECT (V014:66) | `= sub` | authenticated | no (server-side) |
| 9 | `data_subject_requests` | V014:101 | **SI** | SELECT (V014:105) | `= sub` | authenticated | no (server-side) |
| 10 | `processing_records` | V014:132 | **SI** | SELECT (V014:135) | `= sub` | authenticated | no (server-side) |
| 11 | `organizations` | V005:22 | **NO** | **ninguna** | -- | **nadie (RLS off = acceso total)** | **SI, SIN filtro** |
| 12 | `profiles` | V005:34 / V007 | **NO** | **ninguna** | -- | **nadie** | **SI, SIN filtro** |
| 13 | `subscriptions` | V005:48 | **NO** | **ninguna** | -- | **nadie** | **SI, SIN filtro** |
| 14 | `usage_counters` | V005:59 | **NO** | **ninguna** | -- | **nadie** | **SI, SIN filtro** |

**Lectura de la matriz**: filas 1-10 = red de seguridad efectiva. Filas 11-14 = **sin red**. Con RLS
deshabilitado, RLS no se evalua en absoluto: `anon`/`authenticated` acceden a TODAS las filas si tienen
grants (por defecto en Supabase). Ninguna policy usa `USING (true)`, `to public` ni `FOR ALL`: entre las
tablas con RLS no hay politicas permisivas. Para `anon`, las 10 tablas con RLS son fail-closed (policies
`to authenticated`, sin policy para `anon` -> deny). Las filas admin con `owner_id` NULL (agents/agent_runs)
son invisibles a `authenticated` (`NULL = sub` -> NULL, no true): fail-closed correcto.

---

## 5. Hallazgos

### CRITICA-1 -- RLS totalmente ausente en las 4 tablas de identidad/registro (lectura cross-tenant)

- **Severidad**: CRITICA. **Confianza**: ALTA en el hueco del DDL (confirmado por lectura + grep +
  verificacion adversarial independiente); explotabilidad final CONDICIONAL al estado real de prod
  (ver "Verificacion pendiente").
- **Ubicacion**: `apps/backend/migrations/V005__registration.sql` (tablas creadas en :22 `organizations`,
  :34 `profiles`, :48 `subscriptions`, :59 `usage_counters`; **ningun** `enable row level security` ni
  `create policy` en toda la migracion) y `V007__profile_tier.sql` (solo ALTER a `profiles`, sin RLS).
- **Evidencia**: `grep "enable row level security"` sobre `apps/backend/migrations/` devuelve EXACTAMENTE
  10 resultados (las tablas 1-10 de la matriz); ninguno es para estas 4. `grep "create policy"` idem.
  Ninguna otra migracion (V001-V017) las cubre. En Postgres, RLS esta deshabilitado por defecto -> estas
  4 tablas no evaluan RLS.
- **Explotabilidad / impacto (A -> datos de B)**: en Supabase, las tablas del schema `public` se exponen
  por la Data API (PostgREST) y los roles `anon`/`authenticated` reciben GRANT por defecto; **el repo no
  ejecuta ningun REVOKE** (M-3). Con RLS off, un usuario `authenticated` cualquiera puede
  `GET /rest/v1/profiles?select=*` (o `supabase.from('profiles').select('*')`) y **leer TODAS las filas
  de todos los owners**. `profiles` contiene PII y datos de negocio: `full_name`, `org_id`,
  `account_type`, `role`, `identity_verified`, `tier` (esquema en V005:34-45, V007:16). `organizations`
  expone nombres y estados de todas las empresas; `subscriptions` los planes; `usage_counters` el consumo.
  El propio V002:4-6 reconoce este exacto modelo de amenaza ("si en el futuro la consola llamara a
  PostgREST directo") y aplica RLS a `agents` como mitigacion -- **pero esa mitigacion nunca se aplico a
  las 4 tablas de V005/V007**. La superficie es real: la consola instancia un cliente supabase-js con la
  anon key publica (`apps/console/src/lib/supabase.ts:6`); aunque hoy no haga `.from()` a estas tablas, el
  endpoint `/rest/v1` es alcanzable por cualquiera con la anon key.
- **Por que un auditor lo pasa por alto**: las 10 tablas vecinas tienen RLS impecable y comentarios
  extensos sobre "la segunda capa"; el contraste hace creer que TODO el esquema esta cubierto. La
  auditoria #2 (tenancy, seccion 3.10) listo estas tablas pero marco su columna "owner en WHERE" como
  "NO (por diseno)" **evaluando solo el camino admin del codigo, no la exposicion de LECTURA por ausencia
  de RLS** -- exactamente el punto ciego que esta auditoria de DB cubre.
- **Recomendacion (sin arreglar aqui)**: (a) `alter table ... enable row level security` + policies por
  owner en las 4: `profiles` con `id = (auth.jwt() ->> 'sub')::uuid`; `organizations`/`subscriptions`/
  `usage_counters` via join al profile del sub (o `to authenticated using (false)` si NUNCA deben leerse
  por el cliente y solo el rol de servicio las toca); o (b) `REVOKE ALL ON <tabla> FROM anon, authenticated`.
  Idealmente ambos (defensa en profundidad). Versionar el cambio en una migracion para que una recreacion
  desde cero herede la postura segura.
- **Verificacion pendiente en Supabase** (no ejecutada por esta auditoria): `select relname, relrowsecurity
  from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname;` y la
  query de grants (seccion 11). Si prod SI tiene RLS a mano en estas 4 tablas, el riesgo en vivo baja,
  pero el hueco de reproducibilidad del esquema persiste (finding valido a nivel migraciones).

### ALTA-1 -- Escalada de privilegios de tier/aprobacion/cuota por escritura directa (misma raiz que CRITICA-1)

- **Severidad**: ALTA. **Confianza**: ALTA en el mecanismo; explotabilidad CONDICIONAL a que
  `authenticated` tenga grants de escritura (default en Supabase) y la Data API este activa.
- **Ubicacion**: `V007__profile_tier.sql:16-22` (`profiles.tier`) combinado con `V005` (`profiles`,
  `organizations`, `usage_counters` sin RLS). Gate documentado en V007:6-12.
- **Evidencia / impacto**: `profiles.tier` es el **gate server-side del MODO AUTONOMO** (crear/ejecutar
  agentes sin confirmacion humana): el backend lo lee con `select tier from profiles where id = <sub>`
  (`apps/backend/src/registration/registration-repository.ts:292-293`) y el cambio es solo-admin
  (`POST /v1/admin/profiles/:id/tier`, `requireAdmin`). Como `profiles` no tiene RLS, un usuario
  `authenticated` con grant de UPDATE podria `PATCH /rest/v1/profiles?id=eq.<su-sub>` con
  `{ "tier": "autonomous" }` y **auto-promoverse**, saltandose el gate admin que el resto del esquema
  (scheduled_tasks/triggers/recipes exponen solo SELECT por RLS **precisamente** para forzar la creacion
  server-side tras el gate por tier, ver V009:58-63). El backend, al releer el tier, veria `autonomous` y
  habilitaria el modo. Vias analogas: `UPDATE organizations SET status='approved'` (auto-aprobar la propia
  empresa; el CHECK falta -> M-1) y `UPDATE usage_counters SET runs_limit=999999` (saltar la cuota).
- **Por que es ALTA y no CRITICA**: requiere grant de ESCRITURA de `authenticated` (default, pero un paso
  mas que la sola lectura de CRITICA-1); el `with check` no aplica (no hay RLS); el CHECK de `tier`
  (V007:22) SI restringe el valor a `free`/`pro`/`autonomous`, asi que solo puede promoverse a un tier
  valido (no inventar uno). El dano posterior (agentes autonomos) exige mas pasos.
- **Recomendacion**: la misma que CRITICA-1 (RLS + policies, o REVOKE de escritura). Para `profiles.tier`
  en particular, aunque se habilite RLS, la policy de UPDATE NO debe permitir que el propio owner cambie
  `tier` (columna gobernada por admin): restringir la escritura de `profiles` a solo columnas seguras o
  no exponer UPDATE a `authenticated` en absoluto (el patron solo-SELECT del resto del esquema).

### MEDIA-1 -- Faltan CHECK constraints en columnas de estado tipo-enum (permiten estado invalido)

- **Severidad**: MEDIA (integridad de datos). **Confianza**: ALTA.
- **Ubicacion / evidencia**: son `text not null` **sin CHECK**: `organizations.status` (V005:25),
  `profiles.account_type` (V005:37), `profiles.role` (V005:38), `subscriptions.plan` (V005:51),
  `subscriptions.status` (V005:52), `usage_counters.period_kind` (V005:64). La base aceptaria cualquier
  string. En contraste, SI tienen CHECK: `profiles.tier` (V007:22), `jobs.status` (V008:38-39),
  `agent_runs.status` (V003:11), `data_subject_requests.status`/`request_type` (V014:82-88),
  `consents.document_type` (V014:43), `agents.provider_id` (V001:6), `triggers.auth_mode` (V012:44).
- **Impacto**: es un hueco de INTEGRIDAD, no de bypass de autorizacion. La `organizations.status` gobierna
  el gate de aprobacion, pero el gate es fail-closed por igualdad estricta case-sensitive a `'approved'`
  (`apps/console/src/lib/registration.ts` compara `status === 'approved'`), asi que un estado invalido
  ('Approved', typo, etc.) NO concede acceso. El riesgo real es estado inconsistente/silencioso que rompa
  supuestos del codigo (que asume un conjunto cerrado de valores).
- **Recomendacion**: agregar CHECKs que espejen los enums que el codigo espera (mismo patron
  drop-if-exists/add de V007), empezando por `organizations.status` y `subscriptions.status`.

### MEDIA-2 -- `retention_purge_expired` no valida que los dias sean positivos (borrado de datos recientes ante mis-call)

- **Severidad**: MEDIA (perdida de datos / integridad). **Confianza**: ALTA en el defecto; requiere un
  caller privilegiado para materializarse.
- **Ubicacion**: `apps/backend/migrations/V015__retention.sql:26-57` (funcion), DELETE en :37-41 y :46-52.
- **Evidencia**: los cortes son `created_at < now() - make_interval(days => p_agent_runs_days)` y
  `finished_at < now() - make_interval(days => p_terminal_jobs_days)`. La funcion **no valida** que los
  parametros sean `> 0`. Con `p_*_days = 0`, el corte es `now()` -> `created_at < now()` borra
  **practicamente TODO** (todo lo anterior a este instante). Con valor negativo, el corte cae en el futuro
  -> borra incluso mas. La invariante declarada "nada RECIENTE se borra" (V015:9) solo se cumple con
  dias > 0.
- **Explotabilidad**: NO alcanzable por `authenticated` via PostgREST RPC: la funcion es SECURITY INVOKER
  y `agent_runs`/`jobs` tienen RLS con solo policy de SELECT, asi que un DELETE bajo el rol
  `authenticated` afecta 0 filas (default-deny). El riesgo es un caller **privilegiado** (rol de servicio,
  cron, o el endpoint admin `POST /v1/admin/retention/purge`) que pase 0/negativo por error o por input no
  saneado. Los callers actuales son seguros: el cron usa los defaults conservadores (365/90, V016:34-38) y
  el gemelo TypeScript `RetentionRepository.purgeExpired` valida; pero **la funcion SQL no se auto-defiende**.
- **Recomendacion**: agregar al inicio de la funcion un guard `if p_agent_runs_days < 1 or
  p_terminal_jobs_days < 1 then raise exception ...` (o `greatest(p, 1)`), para que la salvaguarda viva en
  la DB y no dependa de que cada caller pase dias sensatos.

### MEDIA-3 -- Ausencia total de GRANT/REVOKE explicito: el esquema depende 100% de los grants por defecto de Supabase

- **Severidad**: MEDIA (postura de permisos). **Confianza**: ALTA.
- **Ubicacion**: todo `apps/backend/migrations/` (V001-V017): `grep "grant "`/`"revoke "` no devuelve DDL
  de permisos (los hits de "grant" son texto de flujos de auth, no SQL).
- **Evidencia / impacto**: la seguridad de acceso via PostgREST descansa enteramente en (a) los grants por
  defecto que Supabase otorga a `anon`/`authenticated` en `public` y (b) RLS como unica barrera. Para las
  10 tablas con RLS eso es el patron correcto de Supabase. Pero: (1) sin REVOKE, cualquier tabla nueva
  creada a mano en el SQL Editor (patron declarado de este repo) hereda grants amplios y queda expuesta si
  se olvida el RLS -- exactamente lo que paso con las 4 tablas de V005 (CRITICA-1); (2) el modelo es
  fragil ante cambios de defaults de Supabase. Ademas, sin REVOKE sobre funciones, `EXECUTE` queda en
  PUBLIC: `authenticated`/`anon` pueden invocar `enqueue_due_scheduled_tasks()` y `retention_purge_expired()`
  como RPC via PostgREST. Hoy es inocuo (SECURITY INVOKER + RLS -> 0 filas afectadas, ver seccion 6), pero
  es superficie que conviene cerrar.
- **Recomendacion**: adoptar una postura explicita: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon,
  authenticated` como base y conceder selectivamente lo necesario (o confiar en RLS pero con un
  `ALTER DEFAULT PRIVILEGES ... REVOKE` que blinde tablas futuras). `REVOKE EXECUTE` sobre las funciones
  de scheduler/retencion a `anon`/`authenticated` (solo el cron/servicio las necesita).

### BAJA-1 -- `provider_credentials` (y `agents`) exponen CRUD COMPLETO a `authenticated` via RLS

- **Severidad**: BAJA (minimo privilegio; sin fuga cross-tenant). **Confianza**: ALTA.
- **Ubicacion**: `V006__provider_credentials.sql:39-65` (policies INSERT/UPDATE/DELETE `_own`);
  contrastar con `jobs` (V008:70-75), `scheduled_tasks` (V009:66-71), `triggers` (V012:86-91),
  `recipes` (V013:85-89), privacidad (V014) que exponen **solo SELECT**.
- **Evidencia / impacto**: a diferencia del patron least-privilege solo-SELECT del resto de tablas
  operativas, `provider_credentials` y `agents` permiten a un cliente `authenticated` crear/editar/borrar
  sus propias filas directo por PostgREST, **salteando la validacion server-side del repositorio** (Zod,
  cifrado). Esta **acotado a `owner_id = sub`** (`with check`, V006:50,58): **NO hay fuga cross-tenant**.
  Y un `encrypted_key` auto-insertado por el cliente no descifraria sin `VAULT_SECRET` (auto-dano, no
  escalada; el cliente no tiene la llave maestra). En `agents`, el CRUD editable por el dueno es mas
  plausiblemente intencional (config propia). Se reporta como **desviacion del patron de minimo
  privilegio** sobre la tabla mas sensible (la boveda): si el modelo de cifrado cambiara, o se agregara
  una columna que el cliente no deba fijar, la escritura directa importaria.
- **Recomendacion**: evaluar reducir `provider_credentials` a solo-SELECT para `authenticated` (como el
  resto de tablas operativas), ya que toda escritura legitima pasa por el backend con el rol de servicio.

### BAJA-2 -- Las policies SELECT exponen material secreto (ciphertext/hash) al propio owner via PostgREST

- **Severidad**: BAJA (no usable; defensa en profundidad). **Confianza**: ALTA.
- **Ubicacion**: `V006:40-43` (`encrypted_key` seleccionable) y `V012:87-91`
  (`hmac_secret_encrypted`, `url_token_hash` seleccionables).
- **Evidencia / impacto**: la policy SELECT abarca toda la fila; un cliente `authenticated` que consulte
  su propia credencial/trigger por PostgREST recibiria `encrypted_key` (ciphertext AES-256-GCM),
  `hmac_secret_encrypted` (cifrado) y `url_token_hash` (hash SHA-256). **Ninguno es usable para firmar/
  descifrar sin `VAULT_SECRET` o sin el token en claro** (las migraciones lo notan, V012:82), y es
  material del PROPIO owner, no cross-tenant. Pero el backend deliberadamente NO serializa este material
  en sus listados (auditoria #2, seccion 5), mientras que un SELECT directo por PostgREST SI lo devuelve:
  inconsistencia entre la capa app (lo oculta) y la capa DB (lo expone). Superficie a vigilar si
  `VAULT_SECRET` se filtrara o el cifrado se debilitara.
- **Recomendacion**: idealmente estas columnas nunca deberian viajar por el canal de lectura del cliente;
  si `provider_credentials`/`triggers` deben ser legibles por PostgREST, exponerlas via una vista que
  proyecte solo columnas no sensibles, o restringir columnas por grant.

### BAJA-3 -- `agent_runs.agent_id` ON DELETE CASCADE borra el historial de auditoria/uso al borrar el agente

- **Severidad**: BAJA (integridad de auditoria). **Confianza**: ALTA.
- **Ubicacion**: `V003__agent_runs.sql:4` (`agent_id uuid not null references agents(id) on delete cascade`).
- **Evidencia / impacto**: `agent_runs` es el rastro de consumo por corrida (tokens, duracion, status,
  V003:1-14). Con CASCADE, borrar un `agents` purga en silencio TODO su historial de runs. Mitigante: el
  contador agregado `usage_counters` cuelga de `profiles`, no de `agents` (V005:59-66), asi que el conteo
  de cuota sobrevive; lo que se pierde es el detalle granular (auditoria/facturacion fina). No es un bypass
  de cuota (el agregado no baja), pero un usuario podria borrar el rastro detallado de sus corridas
  eliminando el agente.
- **Recomendacion**: si `agent_runs` debe conservarse como registro contable/auditable, considerar
  `ON DELETE SET NULL` en `agent_id` (o desacoplar el historico), evaluando el impacto en las metricas.

### BAJA-4 -- Idempotencia parcial: convergencia de esquema incompleta y dependencia de privilegios de operador

- **Severidad**: BAJA (higiene de migraciones). **Confianza**: ALTA.
- **Ubicacion / evidencia**: (a) `V005__registration.sql:67`
  `alter table usage_counters add column if not exists id uuid not null default gen_random_uuid()`: si la
  tabla se creo a mano SIN `id` (escenario que la propia migracion documenta, V005:57-58), el ADD COLUMN
  agrega la columna pero **NO** la constraint PRIMARY KEY (el `create table` la trae, pero no se ejecuta si
  la tabla ya existe): una base parcialmente migrada puede quedar con `usage_counters.id` sin PK.
  (b) `V011:23`/`V016:19` `create extension if not exists pg_cron` **fallara** si el rol del SQL Editor no
  tiene privilegio de superusuario/owner (documentado como paso manual, V011:8-18). (c) `V001` crea
  `agents` sin RLS y `V002` lo habilita aparte: aplicar V001 solo dejaria `agents` sin RLS.
- **Impacto**: ninguno de seguridad directo; son riesgos de reproducibilidad ("recreacion desde cero"
  puede divergir del esquema real). Se agrava por M-3 (sin REVOKE por defecto para blindar el intervalo
  entre crear una tabla y habilitarle RLS).
- **Recomendacion**: para `usage_counters`, un `alter table ... add primary key (id)` idempotente
  (guardado con `if not exists` sobre la constraint via bloque `do $$`); documentar el orden obligatorio
  V001->V002.

### BAJA-5 -- `agents.webhook_secret` se guarda EN CLARO (secreto de firma saliente)

- **Severidad**: BAJA (superficie de spoofing ante filtracion de DB). **Confianza**: ALTA.
- **Ubicacion**: `V004__webhook_secret.sql:4-6` (`webhook_secret text not null default ('whsec_' ||
  encode(gen_random_bytes(24), 'hex'))`).
- **Evidencia / impacto**: a diferencia de `encrypted_key`/`hmac_secret_encrypted`/`url_token_hash` (todos
  cifrados/hasheados), `webhook_secret` vive en claro. Su naturaleza es un secreto de **firma de webhooks
  SALIENTES** (prefijo `whsec_`, estilo Stripe: la plataforma firma cada POST, el cliente verifica), **no**
  una credencial de proveedor: no permite quemar API keys ajenas. Riesgo si la base se filtrara: un
  atacante podria forjar firmas de entregas que aparenten venir de la plataforma (spoofing/integridad
  hacia el endpoint del cliente). Ademas, la policy UPDATE de `agents` (B-1) permitiria al dueno fijar un
  `webhook_secret` elegido a su propio agente (auto-afectante). Confirmado (checklist J): son las unicas
  columnas con material sensible; **no hay ninguna columna con una API key de proveedor en claro**.
- **Recomendacion**: evaluar cifrar `webhook_secret` en reposo (como el resto del material sensible) o
  documentar explicitamente que su modelo de amenaza (filtracion de DB -> spoofing de webhooks) es
  aceptable.

---

## 6. Funciones, `pg_cron` y `SECURITY DEFINER` (checklists E y F)

**No existe ninguna funcion `SECURITY DEFINER` en las migraciones** (`grep "security definer"` ->
sin resultados). Las 5 funciones son SECURITY INVOKER (el default; V015:24-25 lo dice explicito):

| Funcion | Mig | Volatilidad | Seguridad | Que hace |
|---------|-----|-------------|-----------|----------|
| `scheduler_cron_field_matches` | V010:32 | IMMUTABLE | INVOKER | matchea un campo cron (puro) |
| `scheduler_cron_matches` | V010:78 | IMMUTABLE | INVOKER | matchea un instante contra el cron (puro) |
| `scheduler_cron_next` | V010:134 | STABLE | INVOKER | proximo match (barrido minuto a minuto, puro) |
| `enqueue_due_scheduled_tasks` | V010:175 | (volatile) | INVOKER | UPDATE `scheduled_tasks` + INSERT `jobs` |
| `retention_purge_expired` | V015:26 | (volatile) | INVOKER | DELETE `agent_runs`/`jobs` por edad |

**Por que INVOKER es aqui una propiedad de SEGURIDAD**: como no hay REVOKE (M-3), `EXECUTE` esta en PUBLIC,
asi que `authenticated`/`anon` pueden invocar `enqueue_due_scheduled_tasks()` y `retention_purge_expired()`
como RPC de PostgREST (viven en `public`). Al ser SECURITY INVOKER, correrian bajo la RLS del invocador:

- `retention_purge_expired()` invocada por `authenticated`: los DELETE sobre `agent_runs`/`jobs` (RLS
  activa, solo policy SELECT) afectan **0 filas** por default-deny; devuelve `{agent_runs:0,terminal_jobs:0}`
  sin error. Inocua.
- `enqueue_due_scheduled_tasks()` invocada por `authenticated`: el `UPDATE scheduled_tasks ... RETURNING`
  afecta **0 filas** (sin policy UPDATE) -> el CTE `due` queda vacio -> INSERT de 0 jobs -> devuelve 0 sin
  error. Inocua. (Matiz: si el CTE NO estuviera vacio, el INSERT sobre `jobs` sin policy INSERT daria
  ERROR de RLS, no un insert silencioso; el resultado neto de 0 se debe al CTE vacio.)

**pg_cron (checklist F)**: `enqueue_due_scheduled_tasks` corre cada minuto (V011) como superusuario/owner
del cron (BYPASSRLS) -- correcto y necesario: es un scheduler GLOBAL. Su logica **respeta el owner**: el
`UPDATE ... RETURNING st.agent_id, st.owner_id, st.credential_id, st.payload` (V010:191) alimenta un
`INSERT INTO jobs SELECT ... FROM due` (V010:193-195) **sin JOIN ni producto cartesiano**, por lo que cada
job hereda `owner_id`/`agent_id`/`credential_id`/`payload` de la MISMA fila de la tarea. **Cero
cross-owner.** Sin duplicados bajo concurrencia: el `UPDATE ... RETURNING` atomico + lock de fila +
recheck (EvalPlanQual, READ COMMITTED) hace que una corrida concurrente vea `next_run_at` ya avanzado
(futuro) y no re-encole (V010:164-169). `retention_purge_expired` (V016, diario) borra solo por edad y
solo `jobs` terminales (`completed`/`failed` con `finished_at is not null`, V015:46-52): **jamas toca
pending/running**. Su unico defecto es la falta de guard de dias (M-2).

---

## 7. Integridad referencial (checklist G)

| FK | Mig:linea | ON DELETE | Evaluacion |
|----|-----------|-----------|------------|
| `agent_runs.agent_id -> agents(id)` | V003:4 | CASCADE | borra historial al borrar agente (B-3) |
| `jobs.agent_id -> agents(id)` | V008:28 | CASCADE | correcto (limpia jobs encolados) |
| `scheduled_tasks.agent_id -> agents(id)` | V009:28 | CASCADE | correcto |
| `triggers.agent_id -> agents(id)` | V012:39 | CASCADE | correcto |
| `recipes.agent_id -> agents(id)` | V013:43 | CASCADE | correcto |
| `processing_records.agent_id -> agents(id)` | V014:120 | CASCADE | correcto (`agent_id` NULLABLE, a diferencia de las otras 5) |
| `*.credential_id` (jobs/scheduled_tasks/triggers/recipes) | -- | **SIN FK** | deliberado y documentado (V008:34-35): si se borra la credencial, la fila queda y el job **falla limpio** al resolverla, en vez de desaparecer en silencio. Acepta huerfanos por diseno. |
| `profiles.org_id -> organizations(id)` | V005:36 | (default) NO ACTION/RESTRICT | no se puede borrar una org con profiles: correcto |
| `subscriptions.profile_id -> profiles(id)` | V005:50 | (default) RESTRICT | correcto |
| `usage_counters.profile_id -> profiles(id)` | V005:61 | (default) RESTRICT | correcto |
| `owner_id` (todas las tablas) | -- | **SIN FK a `auth.users`** | `owner_id` es `text` libre = `sub`; no hay cascada al borrar un usuario de Supabase -> los datos quedan huerfanos (el erasure se maneja app-side, `RetentionRepository`). Consistente con el modelo. |

Sin ON DELETE peligroso (ningun SET NULL sobre columna NOT NULL, ningun ciclo). El unico matiz es B-3
(CASCADE sobre datos de auditoria). Borrar un agente **no** deja jobs/tareas/triggers huerfanos apuntando
a un `agent_id` inexistente: el CASCADE los limpia. Borrar una credencial SI deja
jobs/tareas/triggers/recetas apuntando a un `credential_id` inexistente, pero es la decision documentada
(fallo limpio al descifrar).

---

## 8. Indices y restricciones (checklist H, solo correctitud/seguridad)

**Indices `owner_id` presentes** (soportan el filtrado por dueno): `agents` (V001:18),
`provider_credentials` (V006:28), `scheduled_tasks` (V009:52), `triggers` (V012:68), `recipes` (V013:74),
`consents` (V014:58), `data_subject_requests` (V014:97), `processing_records` (V014:128),
`jobs (owner_id, created_at desc)` (V017:13). **`agent_runs` no tiene index por `owner_id`** (solo por
`agent_id, created_at` V003:17), pero el codigo lo consulta por `agent_id`, no por `owner_id`: no afecta
correctitud. Indices operativos: `jobs` status/scheduled_for/claim (V008:59-61), `scheduled_tasks` due
(V009:56), retencion por edad (V015:20-21). El rendimiento a fondo es la auditoria #11; aqui basta.

**Restricciones que SI protegen correctitud/seguridad**:
- `triggers`: CHECK `triggers_auth_material_check` (coherencia: exactamente el material del `auth_mode`
  presente, el otro NULL; V012:61-64) + **UNIQUE parcial** sobre `url_token_hash` (V012:73-75, evita dos
  triggers con el mismo token). Solido.
- `recipes`: CHECK `recipes_steps_non_empty` (array jsonb con >= 1 paso; V013:68-70). Solido.
- `consents`: **UNIQUE** `(owner_id, document_type, document_version)` (V014:55-56, consentimiento
  versionado idempotente). Solido.
- CHECKs de enum en `jobs.status`, `agent_runs.status`, `data_subject_requests.status`/`request_type`,
  `consents.document_type`, `agents.provider_id`, `agents.max_tokens`/`temperature`, `triggers.auth_mode`,
  `profiles.tier`. Solidos.

**Restricciones que faltan** (integridad, no seguridad grave): CHECKs de M-1; sin UNIQUE en
`provider_credentials(owner_id, label)` (labels duplicados posibles); sin UNIQUE en
`subscriptions(profile_id)` ni `usage_counters(profile_id)` (un profile podria tener varias filas si el
codigo fallara). Todas BAJA/higiene.

---

## 9. Datos sensibles en la DB (checklist J) -- confirmado a nivel DDL

Confirmado leyendo cada `create table`: los secretos viven SIEMPRE cifrados o hasheados; **no hay ninguna
columna con una API key de proveedor en claro**.

| Columna | Tabla | Mig | Forma | Reversible sin secreto maestro? |
|---------|-------|-----|-------|:-------------------------------:|
| `encrypted_key` | `provider_credentials` | V006:22 | AES-256-GCM (bajo `VAULT_SECRET`) | no |
| `hmac_secret_encrypted` | `triggers` | V012:46 | AES-256-GCM (bajo `VAULT_SECRET`) | no |
| `url_token_hash` | `triggers` | V012:48 | SHA-256 (hex) del token | no (hash) |
| `webhook_secret` | `agents` | V004:5 | **EN CLARO** (secreto de firma saliente, no credencial) | -- (B-5) |

La unica salvedad es `webhook_secret` en claro (B-5), cuyo modelo de amenaza es distinto (spoofing de
firma saliente, no fuga de credencial de proveedor).

---

## 10. Lo que SI esta bien (breve)

- **10 de 14 tablas con RLS impecable**: predicado `owner_id = (auth.jwt() ->> 'sub')`, `to authenticated`,
  fail-closed para `anon` y para filas admin con `owner_id` NULL. Ninguna policy `USING (true)`, `to public`
  ni `FOR ALL`: cero politicas permisivas entre las tablas cubiertas.
- **Sin `SECURITY DEFINER`**: no hay ninguna funcion que corra con permisos del creador saltando RLS. Las
  5 funciones son INVOKER, lo que ademas neutraliza su exposicion como RPC (invocadas por `authenticated`
  afectan 0 filas por RLS).
- **`pg_cron` respeta el owner**: el scheduler copia `owner_id` de la misma fila al job (cero cross-owner),
  sin duplicados bajo concurrencia; la retencion nunca borra `pending`/`running`.
- **Secretos cifrados/hasheados** en reposo (encrypted_key, hmac_secret_encrypted, url_token_hash);
  ninguna API key de proveedor en claro.
- **Constraints fuertes donde importan**: coherencia de material de auth + UNIQUE parcial en `triggers`;
  steps no vacios en `recipes`; consentimiento versionado unico; CHECKs de enum en las columnas de estado
  criticas del flujo de ejecucion.
- **FKs a `agents` con CASCADE** evitan referencias huerfanas de agente; `credential_id` sin FK es
  deliberado (fallo limpio documentado).
- **Numeracion V001-V017 sin huecos** y DDL que no falla al re-aplicarse.
- **No existe el schema `ia_admin`** ni ninguna vista: no hay superficie oculta que saltee RLS en el repo.

---

## 11. Queries de verificacion en Supabase (para que el usuario las corra -- NO ejecutadas aqui)

Read-only. Confirman el estado REAL de prod frente al DDL versionado (recordar: las migraciones se aplican
a mano, prod puede diferir). Correr en el SQL Editor con un rol admin/`postgres`.

**(1) RLS habilitado por tabla** -- confirma/refuta CRITICA-1 (esperar `false` en las 4 tablas de V005):
```sql
select relname as tabla, relrowsecurity as rls_on, relforcerowsecurity as rls_forced
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relrowsecurity, relname;
```

**(2) Todas las politicas RLS y su predicado** -- confirma la matriz de la seccion 4:
```sql
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd;
```

**(3) Grants a anon/authenticated** -- determina la EXPLOTABILIDAD de CRITICA-1/ALTA-1 (si `authenticated`
tiene SELECT/UPDATE sobre `profiles`/`organizations`/`usage_counters`, el hueco es explotable):
```sql
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
```

**(4) `auth.users` NO expuesta a authenticated** (checklist D) -- esperar VACIO para anon/authenticated:
```sql
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'auth' and table_name = 'users' and grantee in ('anon', 'authenticated');
```

**(5) Funciones y su `SECURITY DEFINER`** -- esperar `prosecdef = false` en las 5 funciones:
```sql
select n.nspname as schema, p.proname as funcion, p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by p.proname;
```

**(6) Grants de EXECUTE en las funciones** (M-3) -- ver si `authenticated`/`anon`/PUBLIC pueden invocarlas:
```sql
select routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
order by routine_name, grantee;
```

**(7) Existencia del schema `ia_admin` y de vistas** (checklist E) -- esperar 0 filas en ambas:
```sql
select nspname from pg_namespace where nspname = 'ia_admin';
select table_schema, table_name from information_schema.views
where table_schema not in ('pg_catalog', 'information_schema');
```

**(8) Jobs de pg_cron programados** (checklist F):
```sql
select jobid, jobname, schedule, command, active from cron.job order by jobname;
```

**(9) Exposicion de la Data API / schemas expuestos**: revisar en el Dashboard de Supabase
(Settings -> API -> "Exposed schemas" y si la Data API esta habilitada). Si `public` NO esta expuesta o la
Data API esta apagada, la explotabilidad practica de CRITICA-1/ALTA-1 baja (el hueco de reproducibilidad
del esquema persiste igual).

---

## 12. Cobertura, alcance y limites

- **Auditado**: los 17 archivos de `apps/backend/migrations/` (V001-V017), leidos linea por linea, mas el
  wiring de conexion (`apps/backend/src/db/client.ts`), la lectura de `auth.users` del worker
  (`apps/worker/src/alertas.ts:288-301`), el verificador de JWT (`apps/backend/src/auth/jwt-verifier.ts`,
  `sub` -> `owner_id`), el gate de tier (`registration-repository.ts:292`) y el cliente supabase-js de la
  consola (`apps/console/src/lib/supabase.ts:6`).
- **Verificacion cruzada**: ademas de la lectura manual (autoritativa), se corrio una bateria adversarial
  de agentes que re-leyeron las migraciones para confirmar/refutar cada afirmacion (matriz de RLS,
  ausencia de RLS en las 4 tablas, ausencia de SECURITY DEFINER, correccion de owner en pg_cron, secretos
  cifrados, FKs, constraints, idempotencia) y un barrido de completitud sobre todo el DDL. Los 8 chequeos
  clave volvieron CONFIRMADOS (uno PARCIAL, que refino B-4); el barrido no hallo vistas, schemas custom ni
  `ia_admin`. Cada hallazgo esta anclado a `migracion:linea`.
- **Fuera de alcance (otras auditorias / no cubierto aqui)**: el estado REAL de RLS/grants en produccion
  (requiere las queries de la seccion 11, que esta auditoria NO ejecuto por ser read-only sobre el repo);
  el rendimiento a fondo de indices (auditoria #11); la fortaleza de `VAULT_SECRET`; el aislamiento de la
  capa de aplicacion (auditoria #2, que concluyo AISLA); la superficie del widget publico.
- **No se ejecuto DDL, no se consulto produccion, no se modifico codigo, migraciones ni datos.** El unico
  entregable es este informe.

---

## 13. Conclusion

A nivel de base de datos, la plataforma tiene una **segunda capa de RLS solida y bien diseñada para 10 de
sus 14 tablas de negocio** -- predicados owner-scoped correctos, fail-closed, sin politicas permisivas, sin
funciones `SECURITY DEFINER`, sin vistas ni schemas ocultos, con `pg_cron` que respeta el owner y secretos
cifrados en reposo. Pero **las 4 tablas de identidad/registro (`organizations`, `profiles`,
`subscriptions`, `usage_counters`) no tienen RLS ni politicas** (V005/V007), justo donde vive la PII y el
flag `tier` que gobierna el modo autonomo. En el modelo de exposicion por defecto de Supabase (Data API +
grants a `authenticated`, que el repo nunca revoca), eso permite lectura cross-tenant de datos de identidad
(CRITICA-1) y, por la via de escritura, escalada de privilegios de `tier`/aprobacion/cuota (ALTA-1) --
exactamente el fallo que la "red de seguridad" debia atrapar cuando el codigo no esta en el camino. Ambos
comparten raiz y un solo fix (habilitar RLS + policies, o REVOKE). Su explotabilidad en vivo es condicional
al estado real de prod y **debe confirmarse con las queries de la seccion 11** antes de cerrar el backlog;
pero, aun si prod estuviera parchada a mano, las migraciones **no reproducen la postura segura desde cero**,
que es su objetivo declarado. **Veredicto: RLS es una red de seguridad efectiva con un hueco critico
verificado en la capa de identidad.** Todos los hallazgos se remiten al backlog consolidado sin arreglarse
aqui.
