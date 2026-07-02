# Auditoria #8 de 12 -- Integridad de datos y migraciones

- **Alcance**: INTEGRIDAD Y CORRECTITUD de la capa de datos. Verifica que el estado en la base NUNCA
  pueda quedar inconsistente, corrupto o huerfano: relaciones solidas entre tablas, migraciones
  V001-V017 coherentes y re-aplicables, imposibilidad de escribir datos que violen invariantes del
  negocio, y atomicidad de las operaciones que tocan varias filas/tablas. Cierra el Bloque B
  (correctitud y robustez).
- **Relacion con la auditoria #5**: la #5 cubrio el MISMO esquema desde el angulo de SEGURIDAD (RLS,
  permisos, exposicion PostgREST). ESTA lo cubre desde el angulo de CORRECTITUD/INTEGRIDAD (relaciones,
  atomicidad, invariantes, consistencia migraciones-vs-codigo). **No se repite RLS.**
- **Fuente de verdad**: los 17 archivos SQL en `apps/backend/migrations/` (V001..V017), leidos linea por
  linea, mas todo el codigo que escribe al negocio (`apps/backend/src`, `apps/worker/src`,
  `packages/shared/src/jobs`). **Nota critica**: en este repo las migraciones se aplican A MANO en el SQL
  Editor de Supabase (no hay runner automatico: ni el backend ni CI las ejecutan; confirmado en
  V005:11-13, V006:7-9, V008:16-18, etc.). Por tanto **el estado REAL en prod puede diferir del DDL
  versionado**; los hallazgos sensibles a esa diferencia traen su query de verificacion en la seccion 9.
- **Fecha**: 2026-07-02.
- **Metodo**: modelo del esquema esperado desde las migraciones -> lectura del codigo para confirmar que
  concuerdan -> mapeo del grafo de relaciones -> matriz de invariantes -> analisis de atomicidad de cada
  operacion multi-escritura -> verificacion adversarial (bateria de agentes que re-leyeron el codigo real
  para confirmar/refutar cada hallazgo). Read-only: no se ejecuto DDL/DML, no se toco codigo, migraciones
  ni la base, no se consulto produccion.
- **Tipo**: auditoria adversarial de integridad de datos. Pregunta central: *"hay ALGUNA forma de que la
  base quede en un estado que no deberia existir -- escritura parcial, relacion rota, valor fuera de
  rango, operacion interrumpida a la mitad?"*.

---

## 1. Resumen ejecutivo

**Veredicto (una frase): la integridad de datos esta PROTEGIDA CON SALVEDADES -- el nucleo (claim de la
cola, encolado del scheduler, registro de usuarios) es atomico y correcto, las FK de `agent_id` blindan
la orfandad, y el conjunto de CHECK constraints es rico; PERO hay una operacion legal (erasure ARCO) que
NO es atomica, referencias "sueltas" de `credential_id` sin FK que acumulan trabajo condenado a fallar,
un contador de negocio (`runs_used`) que jamas se mantiene, y constraints criticos definidos INLINE que
podrian faltar en la base real por el modelo de migracion a mano.**

**Ningun hallazgo permite corromper datos existentes en operacion normal.** Los problemas son: (a) una
ventana de estado parcial en el erasure, (b) duplicacion de trabajo (jobs) ante reintentos, (c) datos
"muertos"/incompletos que se acumulan sin corromper (contadores, jobs fallidos), y (d) fragilidad
operativa de las migraciones a mano. No se encontro ninguna via para escribir un `status`, `tier`,
`auth_mode` o `provider_id` fuera de su enum, ni para dejar un job huerfano de su agente.

### Conteo de hallazgos

| Severidad | Cantidad | IDs |
|---|---|---|
| CRITICA | 0 | -- |
| ALTA | 1 | H-01 |
| MEDIA | 6 | H-02, H-03, H-04, H-05, H-06, H-07 |
| BAJA | 7 | H-08, H-09, H-10, H-11, H-12, H-13, H-14 |

### El modelo de escritura (fundamental para leer este informe)

El backend y el worker se conectan con `DATABASE_URL` usando el **rol de servicio del pooler** de Supabase
(`apps/backend/src/db/client.ts:11`, `apps/worker/src/db.ts:13`), `postgres.js` con `prepare:false`. Ese
rol **omite RLS**: la integridad depende exclusivamente de (1) los constraints de la base y (2) la
disciplina del codigo del repositorio. RLS (auditoria #5) no protege la integridad aqui porque el rol de
servicio la ignora. Por eso este informe se concentra en **constraints DB + atomicidad del codigo**: son
las dos unicas defensas reales para las escrituras del negocio.

---

## 2. Grafo de relaciones entre tablas

Cada arista va de la tabla HIJA (que referencia) a la PADRE (referenciada). "FK real" = constraint
declarado; "suelta" = una columna `*_id` sin constraint. ON DELETE en blanco/`RESTRICT` = el default de
Postgres (`NO ACTION`), que **bloquea** el borrado del padre si hay hijos.

| Hija -> Padre | Columna | Tipo | ON DELETE | Riesgo de orfandad | Evidencia |
|---|---|---|---|---|---|
| agent_runs -> agents | agent_id | **FK real** | CASCADE | Ninguno: borrar el agente limpia sus runs | V003:4 |
| jobs -> agents | agent_id | **FK real** | CASCADE | Ninguno de fila; un job `running` en vuelo se BORRA si se borra el agente (ver H-02b) | V008:28 |
| scheduled_tasks -> agents | agent_id | **FK real** | CASCADE | Ninguno: cascade limpia la tarea | V009:28 |
| triggers -> agents | agent_id | **FK real** | CASCADE | Ninguno | V012:39 |
| recipes -> agents | agent_id | **FK real** | CASCADE | Ninguno | V013:43 |
| processing_records -> agents | agent_id (nullable) | **FK real** | CASCADE | Ninguno | V014:120 |
| profiles -> organizations | org_id (nullable) | **FK real** | (RESTRICT) | Borrar una org con perfiles queda BLOQUEADO; no hay borrado de org en el codigo | V005:36 |
| subscriptions -> profiles | profile_id | **FK real** | (RESTRICT) | Borrar un perfil queda bloqueado si tiene subscripcion (ver H-10) | V005:50 |
| usage_counters -> profiles | profile_id | **FK real** | (RESTRICT) | Idem | V005:61 |
| **jobs -> provider_credentials** | credential_id | **SUELTA** | N/A | **Dangling: credencial borrada deja el job apuntando a un id inexistente (H-05)** | V008:36 |
| **scheduled_tasks -> provider_credentials** | credential_id | **SUELTA** | N/A | Dangling: encola jobs que siempre fallaran (H-05) | V009:32 |
| **triggers -> provider_credentials** | credential_id | **SUELTA** | N/A | Dangling (H-05) | V012:42 |
| **recipes -> provider_credentials** | credential_id | **SUELTA** | N/A | Dangling (H-05) | V013:47 |
| (todas las operativas) -> profiles / auth.users | owner_id (text) | **SUELTA** cross-type | N/A | `owner_id` es `text`, `profiles.id`/`auth.users.id` son `uuid`; sin FK. Mismo valor logico, dos tipos (H-13) | V001:12, V006:19 |
| jobs.payload / scheduled_tasks.payload / triggers.payload_template -> recipes | recipeId (dentro del jsonb) | **SUELTA** | N/A | Snapshot de receta: `recipeId` puede apuntar a una receta ya borrada (solo trazabilidad) | recipe-payload.ts:44 |

**Lectura del grafo**: el eje `agent_id` esta **completamente blindado** por FK con CASCADE -- no existe
forma de que un job/tarea/trigger/receta quede huerfano de su agente. El eje `credential_id` es **una
referencia suelta por diseño** (documentado en V008:28-31): se prioriza "fallar limpio" sobre integridad
referencial, con la consecuencia de H-05. El eje `owner_id` es suelto y cross-type (H-13). Las FK de
registro (org/profile) usan `RESTRICT` implicito, lo que previene orfandad pero condiciona el orden de un
borrado manual (H-10).

---

## 3. Matriz de invariantes (el corazon del informe)

Para cada invariante del negocio: quien lo protege. `constraint_DB` = imposible violarlo incluso con un
`INSERT`/`UPDATE` directo (rol de servicio saltando la API). `solo_codigo` = la unica defensa es la
aplicacion; un INSERT directo lo violaria. `nada` = no se mantiene.

| # | Invariante | Tabla | Protegido por | Evidencia / Nota |
|---|---|---|---|---|
| 1 | `status` ∈ {pending,running,completed,failed} | jobs | **constraint_DB** + codigo | CHECK V008:38-39 + Zod `JobStatusSchema` (jobs.ts:21) |
| 2 | `status` ∈ {completed,error,aborted} | agent_runs | **constraint_DB** + codigo | CHECK V003:11 |
| 3 | `status` ∈ {pending,in_progress,completed,rejected} | data_subject_requests | **constraint_DB** + codigo | CHECK V014:86-88 + Zod |
| 4 | `request_type` ∈ {access,rectification,cancellation,opposition,erasure} | data_subject_requests | **constraint_DB** + codigo | CHECK V014:82-84 + Zod |
| 5 | `tier` ∈ {free,pro,autonomous} | profiles | **constraint_DB** + codigo | CHECK V007:22 (patron drop/add idempotente, correcto) |
| 6 | `provider_id` ∈ {anthropic,openai,openai-compatible} | agents, provider_credentials | **constraint_DB** + codigo | CHECK V001:6, V006:21 |
| 7 | `auth_mode` ∈ {hmac,url_token} | triggers | **constraint_DB** + codigo | CHECK V012:44 |
| 8 | Coherencia material auth (hmac->secret, url_token->hash, el otro null) | triggers | **constraint_DB** (INLINE) | CHECK `triggers_auth_material_check` V012:61-64 -- pero definido INLINE en `create table if not exists` (**riesgo H-06**) |
| 9 | `steps` de receta = array no vacio (>=1) | recipes | **constraint_DB** (INLINE) + codigo | CHECK `recipes_steps_non_empty` V013:68-70 + Zod `StepsSchema.min(1)` (recipes.ts:27) -- CHECK INLINE (**riesgo H-06**) |
| 10 | `max_tokens` ∈ (0, 32000] | agents | **constraint_DB** | CHECK V001:9 |
| 11 | `temperature` ∈ [0, 2] | agents | **constraint_DB** | CHECK V001:10 |
| 12 | `document_type` ∈ {privacy_notice,terms} | consents | **constraint_DB** + codigo | CHECK V014:43 + Zod |
| 13 | Unicidad de consent (owner,type,version) | consents | **constraint_DB** | unique index V014:55-56 + `ON CONFLICT DO NOTHING` (consent-repository.ts:88) |
| 14 | Unicidad de `url_token_hash` | triggers | **constraint_DB** | unique index parcial V012:73-75 |
| 15 | `owner_id` NOT NULL (tablas autonomas/compliance) | jobs, scheduled_tasks, triggers, recipes, provider_credentials, consents, data_subject_requests, processing_records | **constraint_DB** | NOT NULL en cada DDL. NULLABLE a proposito en agents/agent_runs (filas admin historicas) |
| 16 | `finished_at` >= `started_at` >= `created_at` | jobs | **nada** (solo now() en codigo) | Sin CHECK (grep en migraciones: 0 constraints temporales). El codigo usa `now()` monotono, pero un INSERT/UPDATE directo puede violarlo (**H-08**) |
| 17 | `attempts` >= 0 | jobs | **solo_codigo** | Sin CHECK (V008:46 `default 0`). Solo se incrementa (+1) en el claim; un INSERT directo puede dejarlo negativo (**H-09**) |
| 18 | Job terminal (completed/failed) => `finished_at` NOT NULL | jobs | **solo_codigo** | `markCompleted`/`markFailed` setean `finished_at=now()` (jobs-repository.ts:227,235). La retencion se blinda con `finished_at is not null` (V015:49, retention-repository.ts:58) |
| 19 | `runs_used` <= `runs_limit` y refleja el consumo real | usage_counters | **nada** | `runs_used` **jamas se incrementa** en ningun lado del codigo (**H-03**) |
| 20 | `payload` de un job es ejecutable | jobs | **solo_codigo** | Zod (`JobPayloadSchema`, execution.ts:125) / `parseRecipeJobPayload` al ejecutar; la DB acepta cualquier jsonb (**H-12**) |
| 21 | `credential_id` referencia una credencial existente | jobs, scheduled_tasks, triggers, recipes | **solo_codigo** (parcial) | Validado al CREAR (`existsForOwner`, scheduled-tasks.ts:109); NO revalidado si la credencial se borra despues; sin FK (**H-05**) |
| 22 | `agent_id` referencia un agente existente | jobs, scheduled_tasks, triggers, recipes, processing_records | **constraint_DB** | FK ON DELETE CASCADE (seccion 2) |
| 23 | `cron_expression` valido | scheduled_tasks | **solo_codigo** | `isValidCronExpression` (Zod) al crear/editar; la DB acepta cualquier `text` (insercion solo server-side) |
| 24 | Un `subscription`/`usage_counter` por profile | subscriptions, usage_counters | **solo_codigo** | Sin `UNIQUE(profile_id)`; registration inserta uno guardado por la PK de profile; `loadState` tolera duplicados con `order by created_at desc limit 1` (registration-repository.ts:164,171) |

**Sintesis de la matriz**: los invariantes de ENUM y de rango numerico estan solidos a nivel DB (filas
1-14). Los huecos reales son: **timestamps sin constraint (16)**, **attempts sin CHECK (17)**, **contador
de uso muerto (19)** y **referencia de credencial sin FK (21)**. Ninguno permite corromper datos por la
API; los 16/17 solo por escritura directa; el 19/21 son gaps de diseño (contador inerte, orfandad blanda).

---

## 4. Coherencia migraciones <-> codigo (tabla por tabla)

Se comparo el DDL de cada migracion contra las interfaces `*Row` y las queries de cada repositorio.

- **agents (V001/V004)** vs `agent-repository.ts`: coincide. `AgentRow` mapea las 14 columnas; se leen/
  escriben con lista explicita (nunca `select *`). `webhook_secret` (V004) se lee pero NUNCA se escribe
  por el input (solo la base lo genera: default o `gen_random_bytes` al rotar, agent-repository.ts:165).
  **Doble fuente de verdad (H-11)**: `max_tokens default 1024` (V001:8) y `${input.maxTokens ?? 1024}`
  (agent-repository.ts:80,100,148); `description default ''` (V001:5) y `?? ''`. Coinciden hoy.
- **agent_runs (V003)** vs `run-repository.ts`: coincide. **Consistencia de escritura (H-04)**: SOLO la
  ruta sincrona `run-agent-by-id.ts:234` inserta en `agent_runs`; **el worker NUNCA registra un run**
  (grep: 0 usos de `AgentRunRepository` en `apps/worker`). Las ejecuciones autonomas (scheduler/trigger/
  receta) no aparecen en `agent_runs` ni en el panel de uso por agente (agents.ts:93-95).
- **organizations/profiles/subscriptions/usage_counters (V005/V007)** vs `registration-repository.ts`:
  coincide. Las interfaces `*Row` piden exactamente las columnas del DDL. `usage_counters.runs_used` se
  lee (loadState:171) pero **nunca se escribe salvo el 0 inicial** (H-03).
- **provider_credentials (V006)** vs `provider-credential-repository.ts`: coincide. `encrypted_key` nunca
  sale por metadata (solo `getDecryptedKeyForOwner`).
- **jobs (V008/V017)** vs `packages/shared/src/jobs/jobs-repository.ts`: coincide. `JobRow` mapea las 13
  columnas; `listByOwner` usa `payload->>'kind'` (operador jsonb correcto para inferir tipo sin traer el
  payload). `credential_id` se escribe pero la relacion es suelta (H-05).
- **scheduled_tasks (V009)** vs `scheduled-tasks-repository.ts`: coincide.
- **triggers (V012)** vs `triggers-repository.ts`: coincide. `getByIdForDispatch` es la unica lectura que
  trae el material de auth (server-side).
- **recipes (V013)** vs `recipes-repository.ts`: coincide. `rowToSteps` mapea defensivamente (descarta
  items sin `message`).
- **consents/data_subject_requests/processing_records (V014)** vs sus repos: coinciden.

**Conclusion de coherencia**: no hay ninguna columna que el codigo lea/escriba y la migracion no cree, ni
con tipo/nombre distinto. Las unicas divergencias son de USO: esquema parcialmente escrito (`agent_runs`
sin el worker, H-04) y muerto (`runs_used`, H-03), mas el doble default (H-11). La practica de "columnas
siempre explicitas" (documentada en agent-repository.ts:21-25) es una salvaguarda excelente: si a la base
le falta una columna, Postgres falla ruidoso en vez de devolver `undefined` en silencio.

---

## 5. Hallazgos

Cada hallazgo: SEVERIDAD, UBICACION (archivo:linea), EVIDENCIA, ESCENARIO, IMPACTO, RECOMENDACION (sin
arreglar). Nivel de confianza explicito.

### H-01 (ALTA) -- El erasure ARCO/GDPR NO es atomico: puede borrar de unas tablas y no de otras

- **Confianza**: alta.
- **Ubicacion**: `apps/backend/src/retention/retention-repository.ts:83-110`
  (`eraseOwnerOperationalData`) y `apps/backend/src/routes/data-requests.ts:137-144`.
- **Evidencia**: `eraseOwnerOperationalData` ejecuta **6 DELETE independientes** (agent_runs, jobs,
  scheduled_tasks, triggers, recipes, processing_records), cada uno un `await this.sql\`...\`` suelto,
  **SIN `sql.begin`**. La ruta luego llama `retentionRepo.eraseOwnerOperationalData(...)` y DESPUES, en
  una sentencia separada, `requestRepo.updateStatus(...)`. La UNICA operacion transaccional de todo el
  backend es el registro (registration-repository.ts:191,235); el erasure no lo es. El test lo confirma:
  `retention-repository.test.ts:142` asevera `calls.toHaveLength(6)` sin ninguna transaccion.
- **Escenario**: el admin resuelve una solicitud `erasure` con `erase:true`. Tras borrar `agent_runs` y
  `jobs`, un fallo transitorio del pooler (timeout, corte de conexion, `max:5` agotado) hace fallar el
  3er DELETE. La ruta lanza 500; `updateStatus` NO corre. Resultado: el titular queda con
  scheduled_tasks/triggers/recipes/processing_records SIN borrar, agent_runs/jobs SI borrados, y la
  solicitud sigue `pending`. Si el admin no reintenta (o marca `completed` a mano sin re-ejecutar el
  erase), sobreviven datos operativos que debian suprimirse. Ademas la `resolution_note` cita
  `JSON.stringify(erased)` (data-requests.ts:139): en un reintento exitoso el conteo reportado puede no
  reflejar lo ya borrado en el intento fallido.
- **Impacto**: una operacion LEGAL (derecho de supresion ARCO/GDPR) puede completarse a medias y quedar
  en un estado inconsistente y mal reportado. Mitigante: los DELETE son idempotentes (acotados por
  `owner_id`), asi que un reintento converge -- el daño es "supresion parcial + reporte impreciso", no
  corrupcion.
- **Recomendacion**: envolver los 6 DELETE y el `updateStatus` en una sola transaccion (`sql.begin`),
  como ya hace el registro; asi el erasure es todo-o-nada y la nota de resolucion refleja exactamente lo
  borrado.

### H-02 (MEDIA) -- `createJob` + `mark*` no transaccional: reintento del emisor puede duplicar el job

- **Confianza**: alta.
- **Ubicacion**: `apps/backend/src/routes/incoming-triggers.ts:196-202` (createJob luego markTriggered);
  `apps/backend/src/routes/recipes.ts:277-284` (createJob luego markRunNow).
- **Evidencia**: ambas rutas hacen `await jobsRepo.createJob(...)` y, en una sentencia separada,
  `await triggerRepo.markTriggered(...)` / `await recipeRepo.markRunNow(...)`, sin transaccion.
- **Escenario**: `createJob` commitea (job `pending` real en la cola). `markTriggered`/`markRunNow` falla
  por un blip de DB. La ruta lanza 500. En el caso del trigger entrante, el emisor del webhook **reintenta
  ante un no-2xx** (comportamiento estandar de webhooks) -> segundo `createJob` -> **dos jobs para el
  mismo evento**. El worker ejecutara ambos: doble consumo de la credencial/tokens y, si el agente tiene
  tools con efectos secundarios, doble efecto. No hay idempotency key.
- **Impacto**: ejecucion autonoma duplicada (costo real y posible efecto secundario duplicado). No
  corrompe datos; requiere un fallo en la segunda escritura mas un reintento.
- **Recomendacion**: encolar y marcar en una transaccion; o hacer `markTriggered`/`markRunNow`
  best-effort (no lanzar) para no inducir el reintento; idealmente una idempotency key por evento
  entrante.

### H-03 (MEDIA) -- `runs_used` nunca se incrementa: contador muerto y limite de negocio inexistente

- **Confianza**: alta.
- **Ubicacion**: `apps/backend/src/registration/registration-repository.ts:207-210` (creacion 0/10) y
  `:169-174` (unica lectura). Grep de `runs_used`/`runsUsed` en `apps`+`packages` (sin tests): 0
  escrituras fuera del INSERT inicial.
- **Evidencia**: `usage_counters` nace con `runs_used=0, runs_limit=10, period_kind='lifetime'` y NADIE
  ejecuta un `update ... set runs_used = runs_used + 1`. El valor se lee en `loadState` y viaja a `GET
  /v1/me` (y a la consola, registration.ts:51), pero permanece 0 para siempre.
- **Escenario**: un individuo corre agentes miles de veces; su `usageCounter.runsUsed` sigue en 0 y
  `runs_limit=10` no se aplica en ningun punto (no hay gate que lo consulte para bloquear).
- **Impacto**: el invariante "runs_used refleja el consumo real" jamas se cumple; el limite de cuota es
  un dato inerte. Riesgo futuro: si se activa un gate creyendo que el contador es real, decidiria sobre
  datos basura (siempre 0).
- **Recomendacion**: o incrementar `runs_used` en cada corrida (sync y autonoma) dentro de la misma
  transaccion del run, o eliminar/ocultar el contador hasta que exista facturacion y documentar que hoy
  es inerte.

### H-04 (MEDIA) -- El worker no registra `agent_runs`: metricas de uso por agente silenciosamente incompletas

- **Confianza**: alta.
- **Ubicacion**: `apps/worker/src/execution.ts` (no hay ninguna llamada a `AgentRunRepository.record`);
  contrastar con `apps/backend/src/routes/run-agent-by-id.ts:234-235` (la ruta sincrona SI registra).
- **Evidencia**: grep de `agent_runs`/`AgentRunRepository`/`.record(` en `apps/worker`: 0 resultados. El
  worker cierra jobs (`markCompleted`/`markFailed`) pero no escribe un `agent_runs`.
- **Escenario**: un agente disparado 1000 veces por scheduler/trigger/receta muestra 0 corridas en su
  panel de uso (agents.ts:93-95 leen `agent_runs`: `totalsForAgent`/`recentForAgent`/`runsByDay`). Las
  dos fuentes de verdad de "cuanto corrio un agente" (la cola `jobs` vs `agent_runs`) nunca se reconcilian.
- **Impacto**: observabilidad de uso engañosa (subreporta todo el uso autonomo). No es corrupcion, pero
  es un agregado que no refleja el estado real y podria alimentar decisiones (o facturacion futura) erroneas.
- **Recomendacion**: registrar `agent_runs` desde el worker al cerrar cada job (con `owner_id`,
  tokens, status), o documentar explicitamente que el uso autonomo solo se observa via `GET /v1/jobs`.

### H-05 (MEDIA) -- `credential_id` sin FK: tareas/triggers/recetas quedan colgando de credenciales borradas y encolan jobs condenados a fallar

- **Confianza**: alta.
- **Ubicacion**: `V008:36`, `V009:32`, `V012:42`, `V013:47` (columna `credential_id uuid not null` **sin
  `references`**, decision documentada en V008:29-31); `provider-credential-repository.ts:127-134`
  (`deleteForOwner` no verifica referencias); `apps/worker/src/execution.ts:257` (resolveCredential).
- **Evidencia**: `credential_id` es una referencia SUELTA a `provider_credentials` en las 4 tablas. Al
  borrar una credencial no hay FK que cascadee ni bloquee, ni el codigo revalida las tareas/triggers/
  recetas que la usan.
- **Escenario**: el usuario borra una credencial que una `scheduled_task` activa usa. `pg_cron`
  (V010 `enqueue_due_scheduled_tasks`) sigue encolando un job por horario. Cada job falla en
  `resolveCredential` (getDecryptedKeyForOwner devuelve null -> resolveStoredCredential lanza 404 ->
  fallo transitorio -> 3 reintentos -> `failed`, execution.ts:257 + handleFailure:487). Una tarea diaria
  genera un job fallido por dia **indefinidamente**, sin ninguna limpieza ni señal de "esta tarea esta
  rota" mas alla del email de fallo definitivo (alertas.ts).
- **Impacto**: acumulacion silenciosa de jobs `failed` y ejecucion perpetua de tareas irreparables. El
  manejo del fallo puntual es gracioso (el worker no crashea); el problema es de INTEGRIDAD REFERENCIAL:
  el diseño acepta referencias colgantes a cambio de "fallar limpio".
- **Recomendacion**: al borrar una credencial, o (a) bloquear si esta referenciada, o (b) desactivar
  (`is_active=false`) las scheduled_tasks/triggers/recipes que la usan, o (c) FK `ON DELETE SET NULL` +
  validacion antes de encolar. Como minimo, una query operativa periodica que detecte colgantes (seccion 9).

### H-06 (MEDIA) -- CHECK criticos definidos INLINE en `create table if not exists`: podrian faltar en la base real

- **Confianza**: media (depende del estado real en Supabase; ver query de verificacion).
- **Ubicacion**: `V012:61-64` (`triggers_auth_material_check`) y `V013:68-70` (`recipes_steps_non_empty`),
  ambos definidos DENTRO del `create table if not exists`.
- **Evidencia**: como las tablas se crearon A MANO en prod (V005:11-13 documenta el patron), un `create
  table if not exists` es NO-OP si la tabla ya existe -- y **no agrega un constraint que le falte a la
  tabla preexistente**. V007 hace lo correcto para el tier (patron idempotente `drop constraint if exists`
  + `add constraint`, V007:21-22), pero V012/V013 dejan sus CHECK inline. Si la tabla `triggers` o
  `recipes` se creo a mano SIN esos CHECK, la migracion no los fuerza.
- **Escenario**: `triggers` existe en prod sin `triggers_auth_material_check`. Un bug de codigo (o un
  INSERT directo) crea un trigger `hmac` con `hmac_secret_encrypted` null: nadie podria firmarlo, y el
  endpoint entrante lo trata como material ausente (-> 401 siempre). O una receta con `steps=[]` que el
  `rowToSteps` mapea a `[]` y dispara el fail-fast de recipes.ts:273.
- **Impacto**: el invariante de coherencia de auth (#8) o de pasos (#9) de la matriz podria no existir a
  nivel DB pese a estar en la migracion. La defensa Zod del backend sigue en pie, pero la "defensa en
  profundidad" prometida por el CHECK puede ser ilusoria.
- **Recomendacion**: correr la query de verificacion (seccion 9) para confirmar que los CHECK existen en
  la base real; considerar reescribir V012/V013 al patron idempotente de V007 (`add constraint` separado)
  para que sean auto-aplicables a una tabla preexistente.

### H-07 (MEDIA) -- Migraciones a mano sin runner ni tabla de versiones: orden fragil y sin deteccion

- **Confianza**: alta (riesgo operativo, no un bug de codigo).
- **Ubicacion**: todo `apps/backend/migrations/`; dependencias de orden en V011 (necesita V009+V010),
  V016 (necesita V015), V004 (necesita V001), V007 (constraint sobre profiles de V005).
- **Evidencia**: no hay runner (V005:11-13, V008:16-18: "ni el backend ni CI las ejecutan"), ni tabla
  `schema_migrations`, ni ninguna guardia (`raise exception if not exists ...`) que detecte una migracion
  saltada o fuera de orden. La aplicacion es manual en el SQL Editor.
- **Escenario**: el operador aplica V011 (`cron.schedule` de `enqueue_due_scheduled_tasks`) antes de V010
  (que define la funcion) -> error de "funcion inexistente" en el mejor caso; o salta V017 (indice por
  owner) y el historial de jobs degrada a scan sin que nadie lo note; o aplica V007 en una base sin la
  tabla `profiles` de V005.
- **Impacto**: el esquema real puede diverger del versionado sin deteccion hasta que algo rompe (el daño
  mas silencioso: datos/consultas incorrectas que se acumulan).
- **Recomendacion**: una tabla `schema_migrations(version, applied_at)` minima + un checklist de orden
  verificado, o adoptar un runner idempotente. La bateria de queries de verificacion (seccion 9) es la
  deteccion manual mientras tanto.

### H-08 (BAJA) -- Sin constraint de coherencia temporal (finished_at / started_at / created_at)

- **Confianza**: alta.
- **Ubicacion**: `jobs` (V008); grep de constraints temporales en migraciones: 0.
- **Evidencia**: no existe `CHECK (finished_at is null or started_at is null or finished_at >=
  started_at)` ni similar. El codigo setea ambos con `now()` (jobs-repository.ts:220,227,235), monotono
  en la practica.
- **Escenario**: solo alcanzable por escritura directa (rol de servicio saltando la API) o un bug futuro
  que setee `finished_at` sin `started_at`. La retencion de jobs terminales se blinda con `finished_at is
  not null` (bien), asi que un terminal sin `finished_at` nunca se purga (queda, no se pierde).
- **Impacto**: bajo; invariante temporal sin red a nivel DB.
- **Recomendacion**: CHECK opcional como defensa en profundidad.

### H-09 (BAJA) -- `attempts` sin CHECK (>= 0)

- **Confianza**: alta.
- **Ubicacion**: `V008:46` (`attempts integer not null default 0`, sin CHECK).
- **Evidencia**: solo se incrementa `attempts = attempts + 1` en el claim (jobs-repository.ts:200);
  nunca se decrementa via API, asi que no puede ser negativo en operacion normal.
- **Escenario**: un INSERT/UPDATE directo con `attempts` negativo romperia la logica de reintentos
  (`job.attempts >= MAX_ATTEMPTS`, execution.ts:487).
- **Impacto**: bajo (solo escritura directa).
- **Recomendacion**: `CHECK (attempts >= 0)`.

### H-10 (BAJA) -- FK de registro sin ON DELETE + el erasure no cubre perfil/consents

- **Confianza**: alta.
- **Ubicacion**: `V005:36,50,61` (org_id/profile_id sin ON DELETE); `retention-repository.ts:83-110`
  (erasure de datos OPERATIVOS unicamente).
- **Evidencia**: `subscriptions.profile_id`/`usage_counters.profile_id` referencian `profiles` con
  `RESTRICT` implicito; no hay borrado de perfil/org en el codigo (grep: 0). El erasure explicitamente NO
  toca perfil, credenciales, agentes, `consents` ni `data_subject_requests` (documentado como "manual,
  mayor impacto").
- **Escenario**: un borrado manual futuro de un perfil (parte del erasure "manual") queda BLOQUEADO por
  las FK de subscriptions/usage_counters si no se borran primero -- hay un orden de borrado obligatorio no
  documentado. Ademas, un "erasure" ejecutado deja vivos datos personales del titular en `consents`
  (con `ip_address`/`user_agent`) y `data_subject_requests` (con `details`).
- **Impacto**: bajo para integridad (las FK previenen orfandad); relevante para completitud del erasure
  (fuera del foco de integridad, se anota como salvedad).
- **Recomendacion**: documentar el orden de borrado manual (usage_counters/subscriptions -> profile);
  decidir si consents/data_subject_requests entran en el erasure.

### H-11 (BAJA) -- Doble fuente de verdad en defaults (max_tokens=1024, description='')

- **Confianza**: alta.
- **Ubicacion**: `V001:5,9` (migracion) vs `agent-repository.ts:80,100,148` (create/update/updateForOwner).
- **Evidencia**: `max_tokens default 1024` y `description default ''` estan en la migracion Y como
  literales en el repo (`?? 1024`, `?? ''`). Coinciden hoy.
- **Escenario**: si un dia se cambia el default en un solo lado, divergen silenciosamente segun el camino
  de escritura.
- **Impacto**: higiene; sin efecto actual.
- **Recomendacion**: una sola fuente (dejar el default a la DB omitiendo la columna cuando el input es
  ausente, o documentar el acople).

### H-12 (BAJA) -- Payload jsonb sin versionado de shape (compat hacia atras informal)

- **Confianza**: alta.
- **Ubicacion**: `jobs.payload` (V008), `scheduled_tasks.payload` (V009), `triggers.payload_template`
  (V012), snapshot de receta (recipe-payload.ts). Validacion en `execution.ts:125` (`JobPayloadSchema`) y
  `parseRecipeJobPayload`.
- **Evidencia**: ningun payload lleva un campo `version`. El worker valida el shape al ejecutar con Zod y
  captura el fallo (parsePayloadMessages lanza -> handleFailure, execution.ts:143,305).
- **Escenario**: una version futura del worker cambia el shape requerido; los jobs `pending` ya encolados
  con el shape viejo fallan la validacion -> transitorio -> 3 reintentos infructuosos -> `failed`. No
  crashea (compat defensiva), pero mata en silencio los jobs en vuelo durante el deploy.
- **Impacto**: bajo; hay validacion + captura, pero no hay migracion de shape ni versionado.
- **Recomendacion**: un campo `version` en el payload para ramificar por version, o drenar la cola antes
  de deploys que cambien el shape.

### H-13 (BAJA) -- `owner_id` es text mientras `profiles.id`/`auth.users` es uuid (inconsistencia de tipo latente)

- **Confianza**: alta.
- **Ubicacion**: `owner_id text` en V001:12, V006:19, V008, V009, V012, V013, V014; `profiles.id uuid`
  V005:35.
- **Evidencia**: `owner_id` guarda el mismo `sub` del JWT que `profiles.id`, pero como `text`. Es
  consistente ENTRE las tablas operativas (todos `text` -> joins operativos OK). No hay ningun join SQL
  entre `owner_id` y `profiles.id` en el codigo (cada query filtra por su propia columna, verificado).
- **Escenario**: si alguna vez se escribe `... join profiles on profiles.id = jobs.owner_id`, Postgres
  requeriria un cast `uuid = text` que puede fallar o degradar. Ademas, `owner_id text` no valida formato
  uuid a nivel DB (el `sub` viene del JWT verificado, asi que en la practica es un uuid valido).
- **Impacto**: bajo, latente.
- **Recomendacion**: anotar la inconsistencia; si se une con profiles, castear explicitamente.

### H-14 (BAJA) -- Comentario stale en cron.ts (horizonte "366 dias" vs 1461 real)

- **Confianza**: alta.
- **Ubicacion**: `apps/backend/src/scheduling/cron.ts:188` (docstring "horizonte de 366 dias") vs `:56`
  (`HORIZON_MINUTES = 1461 * 24 * 60`, correcto y coincidente con V010:146 "1461 days").
- **Evidencia**: el codigo es correcto (1461 dias / 4 anios, para cubrir el 29-feb); solo el comentario
  de `nextCronRun` quedo desactualizado.
- **Impacto**: nulo funcional (solo documentacion).
- **Recomendacion**: corregir el comentario.

---

## 6. Atomicidad de operaciones multi-paso (detalle)

Resumen del analisis transaccional. La UNICA operacion con `sql.begin` es el registro.

| Operacion | Escrituras | Atomica? | Estado malo alcanzable |
|---|---|---|---|
| `registerIndividual` / `registerOrganization` | profile + subscription + usage (o org + profile) | **SI** (`sql.begin`, registration-repository.ts:191,235) | Ninguno: todo-o-nada + idempotente por PK + captura 23505 |
| **Erasure ARCO** (`eraseOwnerOperationalData` + `updateStatus`) | 6 DELETE + 1 UPDATE | **NO** | Supresion parcial + solicitud `pending` + nota imprecisa (**H-01**) |
| **Trigger entrante** (`createJob` + `markTriggered`) | 2 INSERT/UPDATE | **NO** | Job duplicado ante reintento del emisor (**H-02**) |
| **Receta run** (`createJob` + `markRunNow`) | 2 INSERT/UPDATE | **NO** | Job duplicado ante reintento (**H-02**) |
| `purgeExpired` (retencion) | 2 DELETE (agent_runs, jobs) | **NO**, pero independientes | Ninguno relevante: cada purga es consistente por si sola; un fallo entre ambas solo pospone una al proximo ciclo |
| **Scheduler** `enqueue_due_scheduled_tasks` | UPDATE...RETURNING (CTE) + INSERT SELECT | **SI** (un solo statement) | Ninguno: atomico y sin duplicados bajo concurrencia (lock de fila; V010:164-169) |
| **Claim** `claimNextJob` | UPDATE con subquery `FOR UPDATE SKIP LOCKED` | **SI** (un solo statement) | Ninguno: dos workers nunca toman el mismo job (jobs-repository.ts:196-215) |

**Conclusion**: el nucleo de la cola (encolar por horario, reclamar) es correctamente atomico a nivel de
un solo statement SQL. Los huecos son las secuencias de 2+ statements en el backend HTTP (H-01, H-02) que
NO se envuelven en transaccion, teniendo el patron disponible (lo usa el registro).

---

## 7. Idempotencia de las migraciones (V001-V017)

Revision statement por statement de re-aplicabilidad:

- **Re-aplicables sin error** (la gran mayoria): `create table if not exists` (V001,V003,V005,V006,V008,
  V009,V012,V013,V014), `alter table ... add column if not exists` (V004,V005,V007), `create index if not
  exists` (todas), `create or replace function` (V010,V015), `drop policy if exists`+`create policy`
  (V002,V003,V006,V008,...), `create extension if not exists` (V004,V006,V011,V016), el patron `drop
  constraint if exists`+`add constraint` de V007, y los bloques `do $$ ... unschedule ...` de V011/V016.
- **CHECK inline en `create table if not exists`** (V012 `triggers_auth_material_check`, V013
  `recipes_steps_non_empty`, y todos los CHECK de enum/rango de V001/V003/V006/V008/V014): re-aplicar es
  NO-OP (la tabla ya existe), **pero no se agregan a una tabla preexistente creada sin ellos** (**H-06**).
  A diferencia de V007, que si es auto-aplicable.
- **`webhook_secret` con default volatil** (V004:5-7): `add column if not exists` es NO-OP en re-aplicacion
  (bien); solo si se corriera en una base SIN la columna, cada fila recibiria su propio secreto (el
  comentario lo documenta a proposito). Sin riesgo en re-aplicacion.
- **Dependencias de orden** (V011->V009+V010, V016->V015, V004->V001, V007->V005): correctas si se aplican
  en orden, pero sin deteccion si se saltan (**H-07**).

**Conclusion**: las migraciones son mayormente idempotentes y estan bien comentadas al respecto. Los dos
riesgos son (a) los CHECK inline que no se auto-aplican a tablas preexistentes (H-06) y (b) la ausencia de
control de orden/version (H-07), ambos amplificados por la aplicacion a mano.

---

## 8. Manejo gracioso de referencias rotas (verificado)

Se confirmo que el worker NO crashea ante estados degradados (todos caen en fallo transitorio/permanente,
nunca en excepcion no capturada del loop):

- **Agente inexistente** (`loadAgent` devuelve null): `throw` -> transitorio -> reintenta -> `failed`
  (execution.ts:251-254, 305).
- **Credencial irresoluble/borrada** (`resolveCredential` lanza 404): transitorio -> reintenta -> `failed`
  (execution.ts:257).
- **Provider mismatch** (credencial de un proveedor, agente de otro): `throw` (execution.ts:261-265).
- **Payload malformado**: Zod lanza -> transitorio (execution.ts:143-147).
- **Apagado a media ejecucion**: `ShutdownAbortError` -> vuelve a `pending` sin gastar intento como
  permanente (execution.ts:467-471).
- **Agente borrado con un job `running` en vuelo**: el cascade borra la fila `jobs`; `markCompleted`/
  `markFailed` afectan 0 filas en silencio (sin error). El job "desaparece" -- aceptable (su agente ya no
  existe), pero es una perdida silenciosa a anotar (H-02b, sub-caso).

---

## 9. Queries de verificacion del esquema real (para correr en Supabase)

Como las migraciones se aplican a mano, el esquema REAL puede diferir. Estas queries son **read-only** y
las corre el usuario en el SQL Editor de Supabase para confirmar que el estado real == las migraciones.
**No ejecutar contra produccion desde esta auditoria.**

**A. Columnas, tipos, nullability y defaults de cada tabla:**

```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('agents','agent_runs','jobs','scheduled_tasks','triggers','recipes',
                     'provider_credentials','organizations','profiles','subscriptions','usage_counters',
                     'consents','data_subject_requests','processing_records')
order by table_name, ordinal_position;
```

**B. CHECK constraints (confirmar los INLINE de H-06 y los enums):**

```sql
select conrelid::regclass as tabla, conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where contype = 'c' and connamespace = 'public'::regnamespace
order by tabla, conname;
-- Debe listar: triggers_auth_material_check, recipes_steps_non_empty, profiles_tier_check,
-- agents_provider_id_check, jobs_status_check, agent_runs_status_check,
-- data_subject_requests_status_check / _request_type_check, agents_max_tokens_check, etc.
```

**C. Foreign keys y su ON DELETE (confirmar CASCADE en agent_id y AUSENCIA de FK en credential_id):**

```sql
select conrelid::regclass as tabla, conname,
       pg_get_constraintdef(oid) as definicion,
       confdeltype as on_delete  -- 'c'=CASCADE, 'a'=NO ACTION, 'r'=RESTRICT, 'n'=SET NULL
from pg_constraint
where contype = 'f' and connamespace = 'public'::regnamespace
order by tabla;
-- Esperado: *.agent_id -> agents CASCADE (5 tablas); processing_records.agent_id CASCADE;
-- profiles.org_id, subscriptions.profile_id, usage_counters.profile_id -> NO ACTION;
-- NINGUNA fk sobre jobs.credential_id / scheduled_tasks.credential_id / triggers.credential_id /
-- recipes.credential_id (confirma H-05).
```

**D. Indices (confirmar los de V008/V009/V012/V014/V015/V017):**

```sql
select tablename, indexname, indexdef from pg_indexes
where schemaname = 'public' order by tablename, indexname;
```

**E. Jobs de pg_cron (confirmar scheduler y retencion opt-in):**

```sql
select jobid, jobname, schedule, command, active from cron.job
where jobname in ('enqueue-due-scheduled-tasks','retention-purge-expired');
```

**F. Deteccion de estados invalidos / orfandad (deben devolver 0 filas, salvo donde se indica):**

```sql
-- Credenciales colgantes (H-05): tareas/triggers/recetas/jobs cuya credencial ya no existe (>0 = colgantes).
select 'scheduled_tasks' t, count(*) from scheduled_tasks s
  where not exists (select 1 from provider_credentials c where c.id = s.credential_id)
union all select 'triggers', count(*) from triggers tg
  where not exists (select 1 from provider_credentials c where c.id = tg.credential_id)
union all select 'recipes', count(*) from recipes r
  where not exists (select 1 from provider_credentials c where c.id = r.credential_id)
union all select 'jobs_pending', count(*) from jobs j
  where j.status in ('pending','running')
    and not exists (select 1 from provider_credentials c where c.id = j.credential_id);

-- Jobs terminales sin finished_at (H-08/#18): deberia ser 0 (el codigo siempre lo setea).
select count(*) from jobs where status in ('completed','failed') and finished_at is null;

-- Incoherencia temporal (H-08): deberia ser 0.
select count(*) from jobs where finished_at is not null and started_at is not null
  and finished_at < started_at;

-- attempts negativo (H-09): deberia ser 0.
select count(*) from jobs where attempts < 0;

-- Contador de uso "muerto" (H-03): con runs_used siempre 0, esto deberia ser 0 hasta que se implemente.
select count(*) from usage_counters where runs_used > 0;

-- Duplicados de contador/suscripcion por profile (#24): deberia ser 0.
select profile_id, count(*) from usage_counters group by profile_id having count(*) > 1;
select profile_id, count(*) from subscriptions  group by profile_id having count(*) > 1;

-- Orfandad de agent_id (deberia ser 0 por la FK; confirma que la FK esta aplicada de verdad):
select count(*) from jobs j where not exists (select 1 from agents a where a.id = j.agent_id);
```

---

## 10. Lo que SI esta bien (breve)

- **Concurrencia de la cola**: `claimNextJob` usa `FOR UPDATE SKIP LOCKED` -> dos workers nunca toman el
  mismo job (atomico, un solo statement).
- **Scheduler sin duplicados**: `enqueue_due_scheduled_tasks` es un solo statement (CTE `UPDATE ...
  RETURNING` + `INSERT ... SELECT`) con lock de fila -> idempotente y sin catch-up atronador.
- **Registro transaccional**: `sql.begin` + idempotencia por PK + captura de `unique_violation` (23505)
  -> perfil+suscripcion+contador todo-o-nada.
- **Consent idempotente**: `ON CONFLICT DO NOTHING` sobre el unique `(owner,type,version)`.
- **Orfandad de agente imposible**: FK `ON DELETE CASCADE` en las 6 tablas hijas de `agents`.
- **Columnas siempre explicitas** (nunca `select *`/`returning *`): si a la base le falta una columna,
  Postgres falla ruidoso en vez de devolver `undefined` en silencio.
- **Timestamps tolerantes**: `toIso` en todos los `rowTo*` degrada un timestamp null/invalido a null/epoch
  en vez de tumbar el endpoint con `RangeError`.
- **Enums y rangos blindados a nivel DB**: `status` (x3), `provider_id`, `tier`, `auth_mode`,
  `request_type`, `document_type`, `max_tokens`, `temperature`, mas los unique de consent y url_token_hash
  y el CHECK de material de auth y de pasos (sujeto a H-06).
- **Retencion conservadora**: `purgeTerminalJobs` filtra por `status in ('completed','failed')` +
  `finished_at is not null` -> jamas borra `pending`/`running`.
- **Manejo gracioso** de agente/credencial/payload/apagado en el worker (seccion 8): nunca crashea.
- **Cron gemelo verificado**: la funcion SQL `scheduler_cron_next` (V010) y `nextCronRun` (cron.ts)
  comparten gramatica y horizonte (1461 dias) -- coherentes.

---

## 11. Cobertura y alcance

- **Migraciones**: las 17 (V001-V017) leidas linea por linea.
- **Codigo de datos**: todos los repositorios (`agent`, `run`, `provider-credential`, `registration`,
  `scheduled-tasks`, `triggers`, `recipes`, `retention`, `consent`, `data-subject-request`,
  `processing-record`, `jobs` de `packages/shared`), el cliente `db/client.ts`/`worker/db.ts`, el worker
  (`execution.ts`, `worker.ts`, `index.ts`), y las rutas con multi-escritura (`data-requests`, `recipes`,
  `incoming-triggers`, `scheduled-tasks`, `retention`, `registration`).
- **Tests revisados** (para invariantes probados): `jobs-repository.test.ts` (claim atomico, columnas
  explicitas), `retention-repository.test.ts` (6 DELETE del erasure, purga conservadora),
  `registration-repository.test.ts` (transaccion todo-o-nada, idempotencia).
- **Metodo**: modelo del esquema -> confirmacion contra codigo -> grafo -> matriz de invariantes ->
  analisis de atomicidad -> verificacion adversarial. Read-only; no se ejecuto DDL/DML, no se toco codigo,
  migraciones ni la base, no se consulto produccion.
- **Explicitamente fuera de foco** (cubierto por otras auditorias): RLS y permisos/exposicion PostgREST
  (auditoria #5); concurrencia del worker y semantica de reintentos (auditoria #6); cifrado de la boveda
  (auditoria #3). Se referencian donde tocan integridad, no se re-auditan.
- **Salvedad**: como las migraciones se aplican a mano, varios hallazgos (H-06, H-07) dependen del estado
  REAL en Supabase; la seccion 9 da las queries para confirmarlo sin ejecutarlas contra produccion desde
  aqui.

---

## 12. Backlog consolidado (para el backlog de las 12 auditorias)

| ID | Sev | Titulo | Accion sugerida (NO aplicada aqui) |
|---|---|---|---|
| H-01 | ALTA | Erasure ARCO no atomico | Envolver los 6 DELETE + updateStatus en `sql.begin` |
| H-02 | MEDIA | createJob + mark* no transaccional -> job duplicado | Transaccion o mark best-effort + idempotency key |
| H-03 | MEDIA | runs_used nunca se incrementa (gate muerto) | Incrementar en cada run o retirar el contador |
| H-04 | MEDIA | Worker no registra agent_runs | Registrar el run desde el worker o documentar el gap |
| H-05 | MEDIA | credential_id sin FK -> colgantes que fallan siempre | Bloquear/desactivar al borrar credencial; query de deteccion |
| H-06 | MEDIA | CHECK inline podrian faltar en prod | Verificar (query B) + reescribir V012/V013 al patron de V007 |
| H-07 | MEDIA | Migraciones a mano sin orden/version | Tabla schema_migrations o runner idempotente |
| H-08 | BAJA | Sin CHECK de coherencia temporal | CHECK opcional |
| H-09 | BAJA | attempts sin CHECK >= 0 | CHECK (attempts >= 0) |
| H-10 | BAJA | FK de registro sin ON DELETE + erasure no cubre perfil/consents | Documentar orden de borrado; revisar alcance del erasure |
| H-11 | BAJA | Doble default (max_tokens/description) | Una sola fuente de verdad |
| H-12 | BAJA | Payload jsonb sin versionado | Campo version o drenar cola en deploys |
| H-13 | BAJA | owner_id text vs profiles.id uuid | Anotar; castear si se une |
| H-14 | BAJA | Comentario stale en cron.ts | Corregir "366 dias" -> 1461 |
