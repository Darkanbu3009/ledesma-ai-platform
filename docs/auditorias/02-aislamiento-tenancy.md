# Auditoria de seguridad #2 de 12 -- Aislamiento multi-tenant (tenancy)

- **Alcance**: capa de APLICACION (backend + worker + packages/shared). Verifica que TODO acceso a
  datos filtre por el `owner_id` del token verificado. El aislamiento RLS a nivel DB lo cubre la
  auditoria #5; aqui el foco es el filtrado explicito `WHERE owner_id = <sub del token>` en el codigo.
- **Commit auditado**: `6cd042f` (main, PR #105).
- **Fecha**: 2026-07-02.
- **Metodo**: lectura del codigo real de cada repositorio y cada ruta; trazado del `owner_id` desde
  `requireUser` (el `sub` del JWT) hasta cada query; grep de patrones peligrosos (`where id = ...` sin
  `owner_id`); revision de tests de aislamiento. Read-only: no se modifico codigo, tests ni datos.
- **Tipo**: auditoria adversarial. Pregunta central en cada punto: *"si soy el owner A, hay ALGUNA forma
  de tocar datos del owner B?"*.

---

## 1. Resumen ejecutivo

**Veredicto (una frase): AISLA.** La capa de aplicacion impone correctamente el aislamiento por
`owner_id` en TODA operacion de un usuario autenticado: no se encontro ninguna via por la que un owner
normal (via `requireUser`) pueda leer, editar, borrar o ejecutar datos de otro owner. La joya de la
corona -- las credenciales cifradas -- esta blindada de punta a punta (backend y worker): una credencial
ajena jamas se resuelve ni se descifra.

Hallazgos por severidad:

| Severidad | Cantidad | Naturaleza |
|-----------|----------|------------|
| CRITICA   | 0        | -- |
| ALTA      | 0        | -- |
| MEDIA     | 1        | Superficie publica BYOK por diseno: la config de un agente es ejecutable por UUID (riesgo residual si el UUID se filtra). |
| BAJA      | 3        | Defensa en profundidad / higiene (no explotable hoy). |

Ningun hallazgo es una fuga cross-tenant explotable por un usuario autenticado. El unico hallazgo de
severidad media (MEDIA-1) es una decision de diseno DOCUMENTADA (endpoint publico de integracion / widget),
que se reporta por completitud para que el backlog decida si el riesgo residual es aceptable.

---

## 2. Modelo de aislamiento (contexto)

El backend se conecta a Postgres con el **rol de servicio del pooler** (`DATABASE_URL`,
`apps/backend/src/db/client.ts:11`), que **IGNORA RLS**. Por tanto, en esta capa el aislamiento efectivo
depende 100% del filtro explicito `WHERE owner_id = <sub del token>` en cada query. Hay dos piezas que
deben coincidir siempre:

1. **El owner viene del TOKEN, no del cliente.** `requireUser` (`apps/backend/src/auth/require-user.ts:6`)
   verifica el Bearer JWT contra la JWKS de Supabase y devuelve `{ id, email }`, donde
   `id === payload.sub` (`apps/backend/src/auth/jwt-verifier.ts:27`). Ese `user.id` es el `owner_id`.
   Ninguna ruta de usuario acepta un `owner_id` del body/param/header: donde el body trae `ownerId`, se
   ignora explicitamente (ej. `apps/backend/src/routes/credentials.ts:49`,
   `apps/backend/src/routes/agents.ts:104`).
2. **El `owner_id` va en el WHERE.** El patron dominante es `getXForOwner` / `existsForOwner`: toda
   lectura/edicion/borrado por `:id` incluye `owner_id` en la clausula (`WHERE id = X AND owner_id = Y`),
   de modo que una fila ajena resuelve a `null`/`false` y la ruta responde `404` generico (no revela la
   existencia del recurso de otro).

El poder cross-owner por diseno (subir tier, aprobar org, resolver derechos, purgar retencion) esta
detras de `requireAdmin` (`apps/backend/src/auth/require-admin.ts:10`, header `x-admin-token` contra
`ADMIN_API_TOKEN`), nunca de `requireUser`.

---

## 3. Matriz recurso x operacion (corazon del informe)

Leyenda de la columna **owner del token**: SI = el `owner_id` que llega a la query sale del `sub` del JWT
verificado (o, en flujos server-side, de la fila ya resuelta). **owner en WHERE**: SI = la query acota por
`owner_id` (o es una operacion donde no aplica: insert con owner del token, o cola global de confianza).

### 3.1. Agente (`agents`)

| Operacion | Endpoint / origen | Guard | owner del token | owner en WHERE | Ubicacion |
|-----------|-------------------|-------|:---------------:|:--------------:|-----------|
| crear | POST /v1/agents | requireUser | SI | SI (insert, owner=token) | routes/agents.ts:105 |
| leer-lista | GET /v1/agents | requireUser | SI | SI | agents.ts:69 -> agent-repository.ts:121 |
| leer-uno | GET /v1/agents/:id | requireUser | SI | SI | agents.ts:75 -> agent-repository.ts:130 |
| editar | PUT /v1/agents/:id | requireUser | SI | SI | agents.ts:113 -> agent-repository.ts:140 |
| borrar | DELETE /v1/agents/:id | requireUser | SI | SI | agents.ts:150 -> agent-repository.ts:175 |
| rotar secreto | POST /v1/agents/:id/webhook-secret/rotate | requireUser | SI | SI | agents.ts:121 -> agent-repository.ts:162 |
| probar tool | POST /v1/agents/:id/tools/:tool/test | requireUser | SI | SI (getByIdForOwner) | agents.ts:130 |
| uso/metricas | GET /v1/agents/:id/usage | requireUser | SI | parcial (ver BAJA-1) | agents.ts:86 -> run-repository.ts:96 |
| ejecutar (BYOK) | POST /v1/run/:agentId | BYOK/JWT | n/a (ver MEDIA-1) | NO (getById) | run-agent-by-id.ts:182 |
| admin CRUD | /v1/admin/agents[/:id] | requireAdmin | n/a (admin) | NO (por diseno) | admin-agents.ts:43,49,72,81 |
| carga (worker) | processClaimedJob | interno | SI (job.ownerId gate) | NO (ver BAJA-2) | worker/execution.ts:251 |

### 3.2. Credencial (`provider_credentials`) -- la joya de la corona

| Operacion | Endpoint / origen | Guard | owner del token | owner en WHERE | Ubicacion |
|-----------|-------------------|-------|:---------------:|:--------------:|-----------|
| crear | POST /v1/credentials | requireUser | SI | SI (insert, owner=token) | credentials.ts:48 |
| leer-lista (metadata) | GET /v1/credentials | requireUser | SI | SI | credentials.ts:63 -> provider-credential-repository.ts:88 |
| borrar | DELETE /v1/credentials/:id | requireUser | SI | SI | credentials.ts:76 -> provider-credential-repository.ts:127 |
| resolver+descifrar | interno (configurador / run-by-id / worker) | server-side | SI | **SI** `id AND owner_id` | provider-credential-repository.ts:105 (WHERE :113) |
| comprobar pertenencia | interno (crear task/trigger/recipe) | server-side | SI | SI `id AND owner_id` | provider-credential-repository.ts:142 (WHERE :145) |

No existe ningun endpoint que devuelva la key (ni cifrada ni en claro): el SELECT de metadata jamas pide
`encrypted_key`. `getDecryptedKeyForOwner(ownerId, credentialId)` acota `WHERE id = credentialId AND
owner_id = ownerId`: **una credencial ajena resuelve a `null`, jamas a la key**.

### 3.3. Tarea programada (`scheduled_tasks`)

| Operacion | Endpoint / origen | Guard | owner del token | owner en WHERE | Ubicacion |
|-----------|-------------------|-------|:---------------:|:--------------:|-----------|
| crear | POST /v1/scheduled-tasks | requireUser + tier | SI | SI (insert, owner=token) | scheduled-tasks.ts:119 |
| leer-lista | GET /v1/scheduled-tasks | requireUser | SI | SI | scheduled-tasks-repository.ts:120 |
| leer-uno | (interno del PATCH) | requireUser | SI | SI | scheduled-tasks-repository.ts:132 |
| editar | PATCH /v1/scheduled-tasks/:id | requireUser | SI | SI | scheduled-tasks-repository.ts:148 |
| borrar | DELETE /v1/scheduled-tasks/:id | requireUser | SI | SI | scheduled-tasks-repository.ts:169 |
| disparar (scheduler) | pg_cron `enqueue_due_scheduled_tasks()` | interno DB | SI (de la fila) | SI (copia owner de la task) | migrations/V010:191-195 |

Al crear, se valida que **el agente Y la credencial referidos sean del owner** (`getByIdForOwner` +
`existsForOwner`, scheduled-tasks.ts:107 y :109); una referencia ajena -> `404`.

### 3.4. Trigger por evento (`triggers`)

| Operacion | Endpoint / origen | Guard | owner del token | owner en WHERE | Ubicacion |
|-----------|-------------------|-------|:---------------:|:--------------:|-----------|
| crear | POST /v1/triggers | requireUser + tier | SI | SI (insert, owner=token) | triggers.ts:148/168 |
| leer-lista | GET /v1/triggers | requireUser | SI | SI (sin material de auth) | triggers-repository.ts:169 |
| editar/rotar | PATCH /v1/triggers/:id | requireUser | SI | SI | triggers-repository.ts:198 |
| borrar | DELETE /v1/triggers/:id | requireUser | SI | SI | triggers-repository.ts:214 |
| disparar (webhook publico) | POST /webhooks/triggers/:triggerId | firma HMAC / url_token | SI (de la fila) | NO por id, SI por firma | incoming-triggers.ts:172 |

Al crear se valida pertenencia de agente y credencial (triggers.ts:137/139). El disparo publico resuelve
el trigger con `getByIdForDispatch` (unscoped, unica excepcion justificada: no hay usuario, la
autorizacion es el `:id` + la firma/token) y **encola el job con `owner_id`/`agent_id`/`credential_id`
tomados de la FILA del trigger** (incoming-triggers.ts:196-201), nunca del request. Ver seccion G.

### 3.5. Receta (`recipes`)

| Operacion | Endpoint / origen | Guard | owner del token | owner en WHERE | Ubicacion |
|-----------|-------------------|-------|:---------------:|:--------------:|-----------|
| crear | POST /v1/recipes | requireUser + tier | SI | SI (insert, owner=token) | recipes.ts:141 |
| leer-lista | GET /v1/recipes | requireUser | SI | SI | recipes-repository.ts:143 |
| leer-uno | GET /v1/recipes/:id | requireUser | SI | SI | recipes-repository.ts:155 |
| editar | PATCH /v1/recipes/:id | requireUser | SI | SI | recipes-repository.ts:171 |
| borrar | DELETE /v1/recipes/:id | requireUser | SI | SI | recipes-repository.ts:192 |
| ejecutar | POST /v1/recipes/:id/run | requireUser + tier | SI | SI (getRecipeForOwner; job owner=token) | recipes.ts:257,277 |

Al crear se valida pertenencia de agente y credencial (recipes.ts:136/138). El `run` encola el job con
`ownerId: user.id` y agente/credencial de la receta ya validada.

### 3.6. Job / cola de ejecucion (`jobs`)

| Operacion | Endpoint / origen | Guard | owner del token | owner en WHERE | Ubicacion |
|-----------|-------------------|-------|:---------------:|:--------------:|-----------|
| crear (indirecto) | scheduler / webhook / recipe-run | server-side | SI (de la fuente) | SI (insert, owner de la fuente) | jobs-repository.ts:112 |
| leer-lista (actividad) | GET /v1/jobs | requireUser | SI | **SI** `WHERE owner_id` antes de limit/offset | jobs.ts:90 -> jobs-repository.ts:166 |
| reclamar (worker) | claimNextJob() | interno | n/a (cola global) | NO (por diseno: consumidor de confianza) | jobs-repository.ts:196 |
| transiciones | markCompleted/Failed/PendingRetry/Running | interno | n/a (job ya reclamado) | NO por id (sin ruta de usuario) | jobs-repository.ts:218-259 |

**No hay endpoint de usuario para leer-uno / editar / borrar un job por id**: la unica superficie de
usuario es el LISTADO, acotado por owner. Las transiciones por id solo las invoca el worker sobre un job
que el mismo reclamo atomicamente (`FOR UPDATE SKIP LOCKED`).

### 3.7. Consentimiento (`consents`)

| Operacion | Endpoint | Guard | owner del token | owner en WHERE | Ubicacion |
|-----------|----------|-------|:---------------:|:--------------:|-----------|
| crear | POST /v1/consents | requireUser | SI | SI (insert, owner=token) | consents.ts:75 |
| leer-lista | GET /v1/consents/me | requireUser | SI | SI | consent-repository.ts:105 |

### 3.8. Solicitud de derechos del titular (`data_subject_requests`)

| Operacion | Endpoint | Guard | owner del token | owner en WHERE | Ubicacion |
|-----------|----------|-------|:---------------:|:--------------:|-----------|
| crear | POST /v1/data-requests | requireUser | SI | SI (insert, owner=token) | data-requests.ts:79 |
| leer-lista | GET /v1/data-requests | requireUser | SI | SI | data-subject-request-repository.ts:87 |
| exportar (ARCO access) | GET /v1/data-requests/export | requireUser | SI | SI (todo listByOwner) | data-requests.ts:91-96 |
| resolver | POST /v1/admin/data-requests/:id/resolve | **requireAdmin** | n/a (admin) | NO (por diseno) | data-requests.ts:121,131,143 |

`getRequestById` (unscoped) y `updateStatus` (por id) SOLO se usan en la ruta admin; el borrado por
erasure opera sobre `existing.ownerId` leido de la fila (data-requests.ts:138).

### 3.9. Registro de tratamiento (`processing_records`)

| Operacion | Endpoint | Guard | owner del token | owner en WHERE | Ubicacion |
|-----------|----------|-------|:---------------:|:--------------:|-----------|
| crear | POST /v1/processing-records | requireUser | SI | SI (insert, owner=token; ver BAJA-3) | processing-records.ts:44 |
| leer-lista | GET /v1/processing-records | requireUser | SI | SI | processing-record-repository.ts:74 |

### 3.10. Perfil / registro / tier (`profiles`, `organizations`, `subscriptions`, `usage_counters`) -- adyacente

| Operacion | Endpoint | Guard | owner del token | owner en WHERE | Ubicacion |
|-----------|----------|-------|:---------------:|:--------------:|-----------|
| leer estado propio | GET /v1/me | requireUser | SI (sub) | SI | registration.ts:80 -> registration-repository.ts:135 |
| registrar individuo/empresa | POST /v1/register/* | requireUser | SI (sub) | SI | registration.ts:56,68 |
| leer tier (gate) | interno (rutas y worker) | server-side | SI (user.id / job.ownerId) | SI (`WHERE id = sub`) | registration-repository.ts:291 |
| cambiar tier | POST /v1/admin/profiles/:id/tier | **requireAdmin** | n/a (admin) | NO (por diseno) | registration.ts:102 |
| aprobar org | POST /v1/admin/organizations/:id/approve | **requireAdmin** | n/a (admin) | NO (por diseno) | registration.ts:86 |

### 3.11. Retencion / borrado (`retention`) -- admin

| Operacion | Endpoint | Guard | owner del token | owner en WHERE | Ubicacion |
|-----------|----------|-------|:---------------:|:--------------:|-----------|
| purgar (global por tiempo) | POST /v1/admin/retention/purge | **requireAdmin** | n/a (admin) | NO (corte por fecha, todos los owners) | retention.ts:29 |
| erasure (por titular) | (desde resolve de data-request, admin) | requireAdmin | SI (owner de la solicitud) | SI (cada DELETE `WHERE owner_id`) | retention-repository.ts:83-101 |

### 3.12. Ejecucion sin config almacenada (`/v1/agent/run`)

`POST /v1/agent/run` (`routes/agent.ts`) es un **proxy BYOK puro sin acceso a DB**: usa solo la key del
header `x-provider-key`, la config del body y un registro de tools demo. No toca ninguna tabla de negocio:
sin superficie de tenancy.

---

## 4. Hallazgos

### MEDIA-1 -- La config de un agente es ejecutable por UUID en la superficie publica BYOK

- **Severidad**: MEDIA (por diseno; riesgo residual). **Confianza**: alta en el mecanismo; es una
  decision de diseno, no un defecto de codigo.
- **Ubicacion**: `apps/backend/src/routes/run-agent-by-id.ts:182` (`repo.getById(agentId)`),
  `apps/backend/src/routes/session-tokens.ts:33` (`repo.getById(parsed.data.agentId)`).
- **Evidencia**: `/v1/run/:agentId` y `/v1/session-tokens` resuelven el agente con `getById(agentId)`
  **sin acotar por owner**. Las dos ramas BYOK (`x-session-token`, `x-provider-key`) NO exigen JWT: quien
  conozca el UUID de un agente y aporte su propia key puede EJECUTAR la config de ese agente. En la
  ejecucion, las tools guardadas se corren por webhook firmadas con el `webhook_secret` **del owner del
  agente** (`run-agent-by-id.ts:214-224` -> `assembleAgentRun`), y el resultado de cada tool vuelve al
  llamador por SSE.
- **Explotabilidad (A -> datos de B)**: si el owner A conoce el UUID de un agente del owner B, A puede
  ejecutar el agente de B (aportando su propia key), lo que le permite (a) inferir el system prompt de B,
  (b) enumerar las tools de B y (c) invocar las webhooks de B firmadas con el secreto de B y leer sus
  salidas. **Depende de conocer el UUID**, que no es enumerable (UUIDv4, 122 bits) y NO se expone
  cross-tenant por ningun listado. PERO para agentes embebidos via widget, el `agentId` viaja en el HTML
  publico del sitio del cliente: alli el UUID es, en la practica, semipublico.
- **Por que es por diseno**: es el "plano de ejecucion" / contrato de integracion documentado
  (`run-agent-by-id.ts:126-128`): "la config del agente vive en la plataforma; el integrador solo manda
  mensajes + su key BYOK". La rama de credencial guardada (`x-credential-id` + JWT) SI esta aislada por
  owner (ver seccion 5). No hay fuga de credenciales almacenadas ni de datos de otras tablas.
- **Recomendacion (sin arreglar)**: documentar explicitamente el modelo de capacidad-por-UUID y su
  riesgo residual; evaluar (1) atar la ejecucion al owner autenticado cuando llega un JWT, (2) exigir el
  `x-session-token` (efimero, emitido server-side) para agentes con webhooks sensibles, o (3) tokens de
  ejecucion por-agente revocables en vez del UUID como capacidad. Coordinar con la auditoria de la
  superficie del widget.

### BAJA-1 -- `agent_runs` se consulta por `agent_id` sin `owner_id` en el WHERE

- **Severidad**: BAJA (defensa en profundidad). **Confianza**: alta (no explotable hoy).
- **Ubicacion**: `apps/backend/src/agents/run-repository.ts:96` (`totalsForAgent`), `:117`
  (`recentForAgent`), `:144` (`runsByDay`) -- todas `... from agent_runs where agent_id = ${agentId}`.
- **Evidencia**: estas tres lecturas de metricas acotan por `agent_id` pero **no** por `owner_id`.
- **Explotabilidad**: ninguna hoy. El unico llamador es `GET /v1/agents/:id/usage`
  (`routes/agents.ts:86`), que ANTES llama `getByIdForOwner(request.params.id, user.id)` y responde 404
  si el agente no es del owner; solo entonces consulta por `agent.id`. Es el patron "buscar-y-luego-
  chequear" resuelto correctamente en la ruta, pero el repositorio por si mismo no esta aislado: cualquier
  futuro llamador que pase un `agentId` sin el chequeo previo filtraria metricas ajenas.
- **Recomendacion**: agregar `and owner_id = ${ownerId}` a las tres queries (pasando el owner del token),
  para que el aislamiento no dependa de que cada llamador recuerde pre-validar.

### BAJA-2 -- El worker carga el agente con `getById` (sin owner) al ejecutar un job

- **Severidad**: BAJA (defensa en profundidad). **Confianza**: alta (no explotable via API).
- **Ubicacion**: `apps/worker/src/index.ts:62` (`loadAgent: (agentId) => agentRepo.getById(agentId)`),
  usado en `apps/worker/src/execution.ts:251` con `job.agentId`.
- **Evidencia**: el worker resuelve el agente por id sin acotar por `job.ownerId`. En cambio, la
  credencial SI se resuelve owner-scoped: `resolveCredential(job.ownerId, job.credentialId)`
  (`execution.ts:257` -> `getDecryptedKeyForOwner` con `WHERE id AND owner_id`), y el gate de tier usa
  `job.ownerId` (`execution.ts:245`).
- **Explotabilidad**: ninguna via API. Todos los caminos que encolan un job (scheduler, webhook,
  recipe-run) fijan `agent_id`, `owner_id` y `credential_id` de forma consistente desde una fila cuya
  pertenencia ya se valido al crearse. Un job con `owner_id`/`agent_id` de owners distintos solo seria
  posible por manipulacion directa de la DB; aun asi, la **credencial** (el secreto real) NO se podria
  descifrar (el filtro por owner devuelve `null` y el job falla), y el chequeo de proveedor
  (`execution.ts:261`) agrega otra barrera. El impacto residual se limita a ejecutar la *config* de un
  agente ajeno con la credencial propia del owner del job.
- **Recomendacion**: cargar el agente por `(id, ownerId)` (ej. `getByIdForOwner(job.agentId,
  job.ownerId)`) para cerrar tambien esta via en profundidad.

### BAJA-3 -- `processing_records` acepta un `agentId` del body sin validar pertenencia

- **Severidad**: BAJA (higiene / integridad de datos, no fuga). **Confianza**: alta.
- **Ubicacion**: `apps/backend/src/routes/processing-records.ts:44-49` (create) ->
  `processing-record-repository.ts:64`.
- **Evidencia**: al crear un registro de tratamiento, el `agentId` opcional del body se persiste sin
  comprobar que el agente sea del owner (a diferencia de scheduled_tasks/triggers/recipes, que si validan).
- **Explotabilidad**: no hay fuga cross-tenant. El `agentId` se guarda como referencia en la fila PROPIA
  del owner y **nunca se de-referencia para leer datos de otro owner** (el listado solo devuelve
  `listRecordsByOwner`). A lo sumo, un owner puede ensuciar su propio registro de accountability con un
  id que no le pertenece.
- **Recomendacion**: si el `agentId` viene informado, validar `existsForOwner`/`getByIdForOwner` antes de
  persistir, por consistencia con el resto de creaciones referenciales.

---

## 5. Lo que SI aisla bien (destacados)

- **Credenciales (critico)**: `getDecryptedKeyForOwner` y `existsForOwner` acotan `WHERE id AND owner_id`
  (`provider-credential-repository.ts:113,145`). El SELECT de metadata nunca pide `encrypted_key`. No
  existe endpoint que devuelva la key. **Ningun usuario puede descifrar la credencial de otro.**
- **Referencias cruzadas al crear (checklist D)**: crear task/trigger/recipe valida que el `agent_id` Y el
  `credential_id` sean del owner del token (`getByIdForOwner` + `existsForOwner`) antes de persistir;
  referencia ajena -> 404. El owner A no puede programar/disparar con el agente ni la credencial de B.
- **Worker (checklist E)**: la credencial se resuelve por `job.ownerId` y el tier se consulta por
  `job.ownerId`. Un job no puede cargar/descifrar la credencial de otro owner (mismatch -> `null` -> el
  job falla). Defensa adicional: match de proveedor credencial-agente (`execution.ts:261`).
- **Webhook publico y scheduler (checklist G)**: el job encolado HEREDA `owner_id`/`agent_id`/
  `credential_id` de la FILA del trigger (`incoming-triggers.ts:196-201`) o de la tarea programada
  (pg_cron `V010:191-195`), nunca del request. Un atacante que conozca la URL del webhook necesita ademas
  la firma HMAC / url_token (comparados en tiempo constante); aun autenticado, el job corre como el owner
  del trigger, no como el del atacante. Trigger inexistente o inactivo -> `404` generico (no filtra
  existencia).
- **Endpoint admin (checklist F)**: todo poder cross-owner (cambiar tier, aprobar org, resolver derechos,
  purgar/erasure) esta detras de `requireAdmin` (`x-admin-token`), separado de las rutas de usuario. No se
  encontro ningun endpoint de usuario que acepte un owner objetivo por body/param.
- **Rama de credencial guardada en run-by-id**: `POST /v1/run/:agentId` con `x-credential-id` exige JWT y
  resuelve la credencial con `resolveStoredCredential(repo, user.id, ...)` (`run-agent-by-id.ts:169-175`),
  ademas de validar match de proveedor (`:191`). Una credencial ajena/inexistente -> 404, jamas la key de
  otro (cubierto por test explicito).
- **Listados y paginacion (checklist H)**: `GET /v1/jobs` filtra `WHERE owner_id` ANTES de `limit/offset`
  (`jobs-repository.ts:174,182`); el `hasMore` es una heuristica sin `count()` global. Todos los `listBy*`
  (agentes, credenciales, tareas, triggers, recetas, consents, data-requests, processing-records) acotan
  por owner.
- **Fuga indirecta (checklist I)**: recurso ajeno o inexistente -> `404` uniforme (no distingue "no existe"
  de "no es tuyo"); el material de auth de triggers nunca se serializa en los listados; `last_error` se
  trunca en el listado de jobs; los correos de alerta van al owner correcto (`alertas.ts:184,194`,
  `leerEmailOwner` por `auth.users.id = job.ownerId`).
- **Alertas de fallo (worker)**: `notificarFallo` usa `job.ownerId` para el cooldown y para leer el email
  del owner; ningun cruce de owner (`apps/worker/src/alertas.ts:288`).

---

## 6. Cobertura de tests de aislamiento

Existe cobertura explicita de aislamiento por owner en la suite (todos read-only, con mocks del repo/JWT):

- **scheduled-tasks** (`apps/backend/test/scheduled-tasks-route.test.ts`): owner del token jamas del body
  (`ownerId: 'OTRO-MALICIOSO'` -> se ignora); agente de otro owner -> 404; credencial de otro owner -> 404;
  lista solo las del owner; tarea de otro owner -> 404 en get/patch/delete.
- **run-agent-by-id + boveda** (`run-agent-by-id-credential.test.ts`): "AISLAMIENTO: credencial
  ajena/inexistente -> 404, nunca la key de otro"; `x-credential-id` sin JWT -> 401; precedencia de
  fuentes de key; mismatch de proveedor -> 400.
- **credenciales** (`provider-credential-repository.test.ts`, `credentials-route.test.ts`),
  **triggers** (`triggers-repository.test.ts`, `triggers-route.test.ts`, `triggers-incoming-route.test.ts`),
  **recetas** (`recipes-repository.test.ts`, `recipes-route.test.ts`, `recipes-run-route.test.ts`),
  **jobs** (`packages/shared/test/jobs-repository.test.ts`, `jobs-route.test.ts`),
  **privacidad** (`consent-repository.test.ts`, `data-subject-request-repository.test.ts`,
  `processing-record-repository.test.ts` y sus rutas), **worker** (`execution.test.ts`, `alertas.test.ts`).

**Huecos de cobertura sugeridos** (no bloqueantes, alimentan el backlog):

1. Un test que fije el aislamiento a nivel de las metricas de `agent_runs` (BAJA-1): que
   `GET /v1/agents/:id/usage` sobre un agente ajeno responda 404 y no filtre totales (hoy protegido por la
   ruta, sin test dedicado al repo).
2. Un test del worker que verifique que un job con `agent_id` de otro owner no descifre la credencial
   ajena (BAJA-2), documentando la barrera de credencial owner-scoped.
3. Un test de `run-agent-by-id` que documente el modelo de capacidad-por-UUID de la rama BYOK (MEDIA-1):
   que la ejecucion con solo `x-provider-key` no exige propiedad del agente (comportamiento esperado, para
   que un cambio futuro no lo rompa sin querer).

---

## 7. Alcance, metodo y limites

- **Auditado**: `apps/backend` (todos los repositorios y rutas), `apps/worker` (ejecucion, wiring,
  alertas, db), `packages/shared` (JobsRepository), y el disparo del scheduler a nivel DB
  (`migrations/V010`). Se leyo el codigo real de cada archivo y se trazo el `owner_id` desde `requireUser`
  hasta cada query.
- **Verificacion cruzada**: ademas de la lectura manual (autoritativa), se corrio una bateria automatizada
  de agentes (mapeo por repositorio/ruta + red-team adversarial por angulo: IDOR, referencias cruzadas,
  worker, admin, webhook, paginacion/fuga indirecta) para reducir el riesgo de puntos ciegos. Cada
  hallazgo de este informe fue verificado contra el codigo real con `path:linea`.
- **Fuera de alcance (otras auditorias)**: RLS a nivel DB (#5); superficie del widget publico y su modelo
  de embedding; SSRF/anti-abuso de las webhook tools; fortaleza criptografica de `VAULT_SECRET`/
  `SESSION_TOKEN_SECRET`; rate-limiting. MEDIA-1 toca la frontera con la superficie del widget y conviene
  revisarlo junto con esa auditoria.
- **No se ejecuto nada contra produccion.** No se modifico codigo, tests ni datos.

---

## 8. Conclusion

En la capa de aplicacion, la plataforma **aisla correctamente por `owner_id`**: cada operacion de un
usuario autenticado deriva el owner del token verificado y lo lleva al `WHERE` de la query (o inserta con
el owner del token), y el poder cross-owner esta confinado tras `x-admin-token`. La ruta critica --
credenciales cifradas -- es hermetica en backend y worker. No se identifico ninguna via de fuga
cross-tenant explotable por un owner normal. Los cuatro hallazgos son de defensa en profundidad / diseno
documentado y se remiten al backlog consolidado sin arreglarlos aqui.
