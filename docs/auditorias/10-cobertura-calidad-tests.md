# Auditoria 10 (Bloque C): Cobertura y calidad de las pruebas

- **Fecha:** 2026-07-03
- **Alcance:** toda la suite de tests del monorepo (`apps/backend`, `apps/console`, `apps/worker`, `packages/shared`, `packages/widget`, `packages/widget-react`) mas el script de validacion e2e (`scripts/validacion-e2e`).
- **Tipo:** auditoria READ-ONLY. No se modifico ningun archivo (ni codigo, ni tests). Correr la suite local es seguro y se hizo.
- **Metodo:** se corrio la suite completa y la cobertura de lineas (v8) donde estaba disponible; se leyo la FUENTE del invariante Y el test que dice protegerlo para cada dominio critico; se aplico un pase de verificacion adversarial (intentar refutar cada hueco reclamado buscando el test que podria cubrirlo en todos los workspaces); y el auditor re-verifico de forma independiente los hallazgos de mayor severidad con evidencia `path:linea`.
- **Pregunta central de cada celda:** "si yo introdujera un bug REAL en este codigo, HABRIA un test que fallaria?". Un test que pasa no vale nada si no probaria el fallo.

---

## 1. Resumen ejecutivo

**Veredicto: la suite protege bien el CORE, con puntos ciegos concretos y de alto valor.**

La suite es grande, verde y, en su mayor parte, de calidad genuina: la criptografia, el worker/cola, el motor de ejecucion, la autenticacion por token de sesion, la firma de webhooks entrantes y el aislamiento multi-tenant de **8 de los 9 recursos** estan protegidos por tests que EJERCEN la logica real y que fallarian si se rompiera el invariante. No es una suite de fachada: no se encontro el patron clasico de "test de cifrado que mockea el cifrado".

Pero hay huecos que importan, y todos comparten una firma: **el invariante existe y HOY es correcto, pero ningun test fallaria si un refactor futuro lo rompiera** -- exactamente la erosion silenciosa que esta auditoria busca. El mas grave (unica CRITICA) es el filtro por `owner_id` del repositorio de **agents**: es el UNICO recurso sin test de aislamiento real (`removeForOwner` no tiene test alguno), y un refactor que caiga el `where owner_id` habilitaria un IDOR cross-tenant con la suite en verde. Le sigue, como ALTA, el **verificador de JWT real** (`createSupabaseJwtVerifier`), la raiz de confianza de la autenticacion, que no se ejercita en ningun test porque toda la suite inyecta un verificador falso (rebajado de CRITICA a ALTA por el pase adversarial: la cripto la hace `jose`).

### Numeros

| Workspace | Archivos de test | Tests | Cobertura de lineas (v8) |
| --- | ---: | ---: | --- |
| `apps/backend` | 85 | 841 | 95.01% stmt / 88.14% branch / 96.0% lines |
| `apps/console` | 25 | 240 | no instrumentada (sin config de coverage); 0 tests de componente |
| `apps/worker` | 4 | 60 | 73.31% stmt / 64.45% branch (bootstrap 0%) |
| `packages/shared` | 5 | 47 | 98.18% stmt / 85.45% branch |
| `packages/widget` | 5 | 38 | no instrumentada |
| `packages/widget-react` | 1 | 6 | no instrumentada (1 test de componente) |
| **Total** | **125** | **1232** | verde (1232 passing) |

La cobertura de lineas se reporta como CONTEXTO, no como veredicto: es alta (backend 95%/88%) pero una linea "cubierta" por un test que no assertea el invariante no esta protegida (ver seccion 4). El objetivo de esta auditoria es CONFIANZA en los caminos criticos, no % de lineas.

### Hallazgos por severidad

| Severidad | Cantidad | Que representa |
| --- | ---: | --- |
| CRITICA | 1 | Invariante de seguridad/correctitud sin ningun test que fallaria al revertir el fix |
| ALTA | 4 | Camino critico sin cubrir (verificador JWT real, guard DoS del webhook, cluster de UI, camino de error de repos) |
| MEDIA | 8 | Cobertura despareja, camino de error sin probar, fragilidad relevante, gemelos cron sin paridad |
| BAJA | 8 | Mejoras menores / ramas defensivas / consistencia de estilo |

*(El pase de verificacion adversarial -- un verificador por dominio que intento refutar cada hueco reclamado buscando el test que lo cubriera en todos los workspaces -- no refuto ningun hallazgo; rebajo el verificador JWT de CRITICA a ALTA (la cripto la hace `jose`) y la validacion de `aud` de MEDIA a BAJA.)*

---

## 2. Mapa de cobertura por dominio critico (el corazon del informe)

Leyenda: **OK** = cubierto de verdad (un test fallaria si se rompe el invariante) - **~** = parcial - **XX** = sin cubrir.

### A) Autenticacion / autorizacion

| Invariante | Estado | Evidencia (test o su ausencia) |
| --- | :--: | --- |
| Endpoint protegido rechaza 401 sin JWT, por familia de rutas | OK | 18 archivos `*-route.test.ts` asertan `401`; `scheduled-tasks-route.test.ts:89-103` (POST/GET/DELETE), `require-user.test.ts:18-26` (falta header / no-Bearer / verifier rechaza) |
| Gate de tier `autonomous` en la RUTA -> 403 | OK | `scheduled-tasks-route.test.ts:125-148`, `triggers-route.test.ts:137-160`, `recipes-route.test.ts:130-153` |
| Gate de tier en el WORKER (defensa en profundidad) | OK | `apps/worker/test/execution.test.ts:192-208` (free -> `markFailed`, no ejecuta), `:568-580` (receta) |
| Admin exige `x-admin-token` (registration) | OK | `registration-route.test.ts:185-200`, `:234-249` (falta / incorrecto / Bearer de usuario no sirve) |
| Admin `x-admin-token` en admin-agents (POST/PUT/DELETE) | ~ | `admin-agents-route.test.ts:51-60` solo prueba 401 para **GET**; los verbos de escritura no tienen test de rechazo |
| Admin en rutas destructivas de cumplimiento (retention purge, resolver ARCO) | ~ | `retention-route.test.ts:34-38`, `data-requests-route.test.ts:140-142` solo prueban "sin token -> 401"; no el token INCORRECTO |
| `session-token`: expiracion, agentId mismatch, tamper, sin fuga | OK | `session-token.test.ts:39-82` (crypto real, fake timers) |
| **jwt-verifier real: firma / expiracion / issuer / sub vacio** | **XX** | **ausente**: `grep createSupabaseJwtVerifier` en `apps/backend/test` = 0; toda ruta inyecta un `JwtVerifier` falso |
| `aud` (audiencia) validada por el verificador | XX | `jwt-verifier.ts:21` no pasa `audience`; sin test que lo fije |

### B) Aislamiento / tenancy (por recurso)

| Recurso | Aislamiento por owner (get/update/delete/list) | Evidencia |
| --- | :--: | --- |
| `provider_credentials` | OK | `provider-credential-repository.test.ts:121-133` (cross-owner A/B con `makeOwnerScopedSql`), `:155-163` (delete asserta `where ... owner_id`), `:184-188` (existsForOwner cross-owner) |
| `recipes` | OK | `recipes-repository.test.ts:129-133`, `:167-176` (A vs B -> null), CRUD acotado |
| `scheduled_tasks` | OK | `scheduled-tasks-repository.test.ts:127-131`, `:158-167` (A vs B) |
| `triggers` | OK | `triggers-repository.test.ts:119-190` (asserta `where id + owner_id` y valores) |
| `data_subject_requests` | OK | `data-subject-request-repository.test.ts:115-119` (cross-owner A/B -> null) |
| `jobs.listByOwner` | OK | `jobs-repository.test.ts:235-247` (asserta `where owner_id` + valores) |
| `consents` / `processing_records` | OK | `consent-repository.test.ts:103-121` (listados acotados por owner) |
| `agent_runs` (uso, tenencia TRANSITIVA via ruta) | ~ | `agents-usage-route.test.ts:57-69` (agente ajeno -> 404); `run-repository` consulta solo por `agent_id`, sin barrera propia |
| **`agents` (getByIdForOwner / updateForOwner / removeForOwner / listByOwner)** | **XX** | **`agent-repository.test.ts:100-121`** (el `it.each` solo asserta que el SQL contiene `webhook_secret`, NUNCA el `where ... owner_id`); `:80` es la unica asercion de `owner_id`, y solo para `rotateWebhookSecret`; `removeForOwner` no se invoca en ningun test |

**Veredicto de consistencia (punto G):** los recursos anadidos despues del nucleo comparten un patron de test robusto (mock `sql` owner-scoped + caso cross-owner A->fila / B->null). `agents` -- el recurso MAS viejo -- quedo con el patron antiguo (mock "tonto" que ignora los parametros) y es el hueco. Es el recurso donde mas facil se cuela un IDOR al extenderlo.

### C) Cripto / boveda de secretos

| Invariante | Estado | Evidencia |
| --- | :--: | --- |
| Cifrado en reposo (la key se persiste como ciphertext, nunca en claro) | OK | `credentials-route.test.ts:88-90` (la ruta cifra con `encryptToToken` REAL; el test descifra y compara) |
| IV unico por cifrado | OK | `aes-gcm.test.ts:69-75` (mismo plaintext -> tokens distintos, crypto real) |
| Tag invalido / truncado / secreto incorrecto -> rechazo sin fuga | OK | `aes-gcm.test.ts:84-118` (mensaje fijo, no contiene el secreto) |
| Redaccion de secretos en logs | OK | `logging-redaction.test.ts:5-32` (pino real + `loggerRedaction` real), `byok-sentinel.test.ts` |
| Aislamiento por owner de la boveda (key ajena -> null) | OK | `provider-credential-repository.test.ts:121-133` (cross-owner con mock owner-scoped) |
| Metadata nunca expone `encrypted_key` | OK | `provider-credential-repository.test.ts:77,97` |
| Provider mismatch (fix 5.4): cred de X no va a agente de Y | OK | `run-agent-by-id-credential.test.ts:177-195` (400, `runModel` NO llamado) |
| `resolve-stored-credential`: `credentialId` no-uuid -> 404 (no 500 de PG) | ~ | null->404 cubierto; la rama uuid-malformado (`resolve-stored-credential.ts:26`) no tiene test |
| Redaccion de cookies (`set-cookie`, `req.headers.cookie`) | XX | ausente (grep -> 0); es un invariante menor pero declarado |

### D) Worker / cola / concurrencia

| Invariante | Estado | Evidencia |
| --- | :--: | --- |
| **Claim atomico (`FOR UPDATE SKIP LOCKED`)** | **~** | `jobs-repository.test.ts:130-143` asserta el TEXTO del SQL (atrapa el borrado de la clausula) pero NO el comportamiento concurrente real (dos workers, mismo job) |
| Reintento no duplica (transitorio -> `markPendingRetry`, no nuevo job) | OK | `jobs-repository.test.ts:176-196`; `execution.test.ts:156-173` |
| Shutdown -> re-pending (aun con attempts agotados) | OK | `execution.test.ts:253-266`, `:312-325` |
| Ejecutor multi-paso de recetas (encadena output como historial) | OK | `execution.test.ts:378-431` (historial por paso), `:411-420` (acumula text_delta) |
| Fallo en paso intermedio corta y no encadena output erroneo | OK | `execution.test.ts:433-452`, `:471-496` (stop 'error') |
| Deadline por paso / limite de contexto acumulado | OK | `execution.test.ts:498-523`, `:540-555` |
| Frontera reintento vs failed definitivo (attempts >= MAX) | OK | `execution.test.ts:156-190` |
| Cooldown/dedup de alertas | OK | `alertas.test.ts:234-262` (dentro/fuera de ventana, por-owner) |
| Resiliencia del loop (job roto no lo tumba; DB caida corta la pasada) | OK | `worker.test.ts:65-120` |
| Valor/offset del backoff lineal de reintento | XX | `execution.test.ts:170` solo asserta `toBeInstanceOf(Date)`, no el offset |
| Lectores SQL de alertas (`leerEmailOwner` sobre `auth.users`) | XX | ausente: `alertas.test.ts` no ejercita `alertas.ts:288-318` |
| Rama defensiva "el run termino sin evento stop" | XX | ausente: `execution.ts:211` |

### E) Motor de ejecucion / proveedores

| Invariante | Estado | Evidencia |
| --- | :--: | --- |
| Timeout de pared corta el run (SSE) | OK | `sse-runner-timeout.test.ts:134` (provider retorna), `:155` (provider lanza), `:170` (timer limpiado) |
| Timeout de pared en el worker autonomo | OK | `execution.test.ts:233`, `:498` (por paso) |
| `token_cap` detiene el run al superar el acumulado | OK | `run-agent-token-cap.test.ts:37,68,120` |
| Mismatch de proveedor (fix 5.4) en ruta Y worker | OK | `run-agent-by-id-credential.test.ts:177` + `execution.test.ts:221` |
| Fallo del proveedor 4xx/5xx/stream cortado -> `ProviderError` normalizado | OK | `errors.test.ts:5-71` (todos los codigos) + `*-provider-errors.test.ts` (SDK fake, mapeo real) |
| Cliente desconectado (SSE) aborta el run | OK | `sse-runner-timeout.test.ts:204` (`triggerClientClose` con EventEmitter) |
| Adaptadores: se ejerce el mapeo REAL (map-request / translate-stream) | OK | los tests mockean el SDK en la frontera de red (`vi.mock('@anthropic-ai/sdk')`), no el mapeo -> NO self-confirming |
| Validacion de `maxTokens` invalido en `validateAgentRun` | XX | ausente: `validateAgentRun` (`limits.ts:71`) nunca se llama con `maxTokens` invalido |

### F) Webhook entrante / superficie de ataque

| Invariante | Estado | Evidencia |
| --- | :--: | --- |
| Firma HMAC valida -> 202 + job encolado | OK | `triggers-incoming-route.test.ts:90-113` (crypto REAL: `signWebhookPayload` + `encryptToToken`) |
| Firma HMAC invalida / body alterado -> 401 | OK | `:115-141` (firma de mismo largo; +1 byte al body) |
| Replay (timestamp fuera de +/-300s) -> 401 | OK | `:143-153` (reloj inyectado `clock=NOW+301`); unit `trigger-auth.test.ts` |
| `url_token` correcto/incorrecto/ausente (query y header) | OK | `:176-231` |
| Body malformado / no-JSON / vacio -> sin crash | OK | `:280-302`, `:200-209` (octet-stream) |
| SSRF: IPs privadas/loopback/metadata rechazadas | OK | `ip-guard.test.ts:8-170` (v4/v6 exhaustivo, fail-closed) |
| No enumeracion: inexistente/inactivo/no-uuid -> 404 uniforme | OK | `:234-269` |
| Secreto/firma nunca fuga en content/headers del ejecutor | OK | `webhook-tools.test.ts:73-83,238-307` (centinela sobre 18+ superficies) |
| **DoS: body > 64KB rechazado (413) antes de autenticar** | **XX** | **ausente**: `MAX_WEBHOOK_BODY_BYTES=65536` en `incoming-triggers.ts:158,161`, pero ningun test envia un body sobre-dimensionado |
| Truncado del contexto del evento (`MAX_EVENT_CONTEXT_CHARS=8000`, anti prompt-injection) | XX | ausente: `incoming-triggers.ts:44-46` trunca, sin test |
| Rama de auth: descifrado del secreto HMAC falla / material null -> 401 (no 500) | XX | ausente: `incoming-triggers.ts:93,95-99,109` |

---

## 3. Hallazgos por severidad

### CRITICA

#### C1. El filtro por `owner_id` del repositorio de `agents` no lo verifica ningun test; `removeForOwner` no tiene test alguno
- **Ubicacion:** `apps/backend/src/agents/agent-repository.ts:121` (`listByOwner`), `:130` (`getByIdForOwner`), `:140` (`updateForOwner`), `:175` (`removeForOwner`); tests: `apps/backend/test/agent-repository.test.ts:100-121`, `:80`; `apps/backend/test/agents-route.test.ts`.
- **Evidencia (verificada por el auditor y por el pase adversarial):** en `agent-repository.test.ts` el unico metodo cuyo SQL se asserta con `where id = <param> and owner_id = <param>` es `rotateWebhookSecret` (`:80`). El `it.each` de `:113-120` solo comprueba que cada SQL contiene `webhook_secret` y no `select *` -- **jamas** el `owner_id` del `where`. Dato cuantitativo: `grep "where owner_id" *repository*.test.ts` da **agents = 1** vs **5-6** en credentials/recipes/scheduled-tasks/triggers -- agents es, medido, el recurso menos protegido. `getByIdForOwner` solo se prueba para el mapeo de una fila (`:90-94`) con un mock (`makeSqlReturning`, `:26-30`) que **devuelve la fila pase lo que pase, ignorando los parametros**. `removeForOwner` no se invoca en ningun test de repositorio (solo el `remove` NO acotado por owner, `:65-67`). Y en `agents-route.test.ts` el repositorio esta mockeado, asi que el SQL real nunca corre: los tests confirman que la ruta PASA el `user.id` correcto al metodo (`:82`, `:88`, `:103`), pero no que el metodo FILTRE por el.
- **Por que es CRITICA:** es un invariante de aislamiento (IDOR) sin red en NINGUNA capa. Si un refactor quita `and owner_id = ${ownerId}` del `where` de `getByIdForOwner`/`updateForOwner`/`removeForOwner`, un usuario autenticado podria LEER (incluido el `webhook_secret`, que permite forjar la firma HMAC de los webhooks del agente ajeno), EDITAR o BORRAR agentes de OTRO owner, y `npm test` seguiria en verde. Es exactamente la clase de fix que se erosiona en silencio. Ademas es el UNICO de los 9 recursos en esta situacion: todos los demas tienen el caso cross-owner (A ve lo suyo / B ve `null`).
- **Recomendacion:** portar `agent-repository.test.ts` al patron `makeOwnerScopedSql` que ya usan `provider-credential`/`recipes`/`scheduled-tasks` (asertar el texto `where ... owner_id = <param>` + los valores, y un caso B->null) para `getByIdForOwner`, `updateForOwner`, `removeForOwner` y `listByOwner`. Sin tocar el codigo de produccion.

### ALTA

#### A1. El verificador de JWT real (`createSupabaseJwtVerifier`) no tiene NINGUN test: la suite mockea justo lo que autentica a cada usuario
*(Severidad rebajada de CRITICA a ALTA por el pase de verificacion adversarial: la verificacion criptografica la hace `jose`, biblioteca de confianza; el riesgo real es la CONFIGURACION -- issuer, algoritmo, `sub` -- que es codigo propio sin test.)*
- **Ubicacion:** `apps/backend/src/auth/jwt-verifier.ts:14-30`; ausencia total en `apps/backend/test/`.
- **Evidencia:** `jwt-verifier.ts:21` delega la verificacion a `jose` con `jwtVerify(token, jwks, { issuer })` y agrega el chequeo de `sub` no vacio (`:23-25`). NINGUN test invoca `createSupabaseJwtVerifier` (`grep` -> 0): todas las rutas protegidas inyectan un `JwtVerifier` falso (`scheduled-tasks-route.test.ts:22-28`, `triggers-route.test.ts:24-30`, `recipes-route.test.ts:22-28`), y donde el modulo entra en juego `jose` esta mockeado (`vi.mock('jose')` en agents-route, credentials-route, registration-route, run-agent-by-id-credential, tools-catalog-route). No existe `jwt-verifier.test.ts`.
- **Por que ALTA:** es la raiz de confianza de la autenticacion. Se prueba `requireUser` y los gates con un verificador mockeado, pero el mecanismo que decide si un token es AUTENTICO no se ejecuta jamas en tests. El binding `{ issuer }` es una linea que, si un refactor la quita, aceptaria tokens de CUALQUIER proyecto Supabase (bypass cross-tenant); igual la rama `sub` vacio (`:24`, no cubierta) o un cambio en la aceptacion de expiracion. Ninguno romperia un test. Acotado a ALTA (no CRITICA) porque la cripto en si la hace `jose` y la e2e cubre el happy path con un JWT real de Supabase, asi que HOY funciona.
- **Recomendacion:** un `jwt-verifier.test.ts` que arme un JWKS local (par ES256 en el test) y verifique: token valido -> `{id,email}`; issuer incorrecto -> rechaza; expirado -> rechaza; `sub` ausente -> lanza `token without sub`. Aprovechar para RESTRINGIR el algoritmo (`algorithms: ['ES256']`) -- hoy no se fija (hallazgo del pase adversarial, BAJA) -- y decidir explicitamente si `aud` debe validarse.

#### A2. El guard de tamano del webhook entrante (bodyLimit 64KB) no tiene test de regresion
- **Ubicacion:** `apps/backend/src/routes/incoming-triggers.ts:20,158,161`; `apps/backend/test/triggers-incoming-route.test.ts` (334 lineas, sin caso de sobre-tamano).
- **Evidencia:** `MAX_WEBHOOK_BODY_BYTES=65536` se aplica como `bodyLimit` en los DOS content-type parsers. El endpoint es PUBLICO y el cuerpo se buferiza ANTES de autenticar. El unico test de 413/bodyLimit del repo es `agent-route-limits.test.ts:56`, que prueba `/v1/agent/run` con el limite de 1MB, no este de 64KB.
- **Impacto:** un refactor que "simplifique" el registro de parsers quitando el objeto de opciones borra el limite sin que falle ningun test; la proteccion cae al default de Fastify (1MB) por request NO autenticado -> ~16x mas superficie de DoS. Es un invariante de seguridad sin regresion.
- **Recomendacion:** un caso que haga `inject` de un body > 64KB (`'x'.repeat(70_000)`) y espere 413, y otro para el truncado de `MAX_EVENT_CONTEXT_CHARS`.

#### A3. Cluster de FRONTEND: los limites de seguridad/correctitud de la UI no tienen cobertura de componente
- **Ubicacion:** `apps/console/src/components/ProtectedRoute.tsx:13`, `RegistrationGate.tsx:42`, `privacy/ConsentGate` (`ConsentGate.tsx:49`), `auth/AuthProvider.tsx:17`, `lib/mutations.ts` (POST de secretos), `packages/widget/src/element.ts:453` (runTurn 401-retry).
- **Evidencia:** `apps/console/test` no contiene NI UN archivo `*.test.tsx`; `vitest.config.ts:5` usa `environment: 'node'` y no hay `jsdom`/testing-library en `package.json`. Los 25 archivos de test de la consola importan solo `src/lib/*` (logica pura). Hay ~50 componentes React sin test. La DECISION pura esta cubierta (`classifyRegistration` en `registration.test.ts:50-88`, `hasPendingConsents` en `privacy.test.ts:24-48`) pero el CABLEADO que la usa (los gates, la composicion de rutas en `App.tsx`, el POST del secreto al endpoint correcto) no.
- **Impacto:** invertir `!session` en `ProtectedRoute`, hacer fail-open un gate (`if (hasPendingConsents)` negado, o dejar pasar en `isError`), un typo de path/metodo en `mutations.ts` que mande la apiKey al endpoint equivocado, o romper el reintento-unico del 401 del widget (bucle infinito) -- ninguno romperia `npm test`. Es "falsa sensacion de verde": los tests de lib pasan mientras el gate se rompe.
- **Mitigacion honesta:** el backend sigue exigiendo JWT en cada endpoint, asi que un `ProtectedRoute` roto expone el shell del dashboard pero no los datos (las llamadas API darian 401). Por eso el cluster se califica ALTA y no CRITICA. Aun asi, ConsentGate/RegistrationGate en fail-open tienen impacto de cumplimiento/UX real, y el mis-routing de un secreto es serio.
- **Recomendacion:** agregar `jsdom` + `@testing-library/react` a la consola y cubrir, en orden de valor: `ProtectedRoute`, `ConsentGate`/`RegistrationGate` (incluida la rama de error = no fail-open), el envio de `mutations.ts` (metodo+URL del secreto), y un test de integracion de `element.ts runTurn` para el 401-retry.

#### A4. El camino de error a nivel de repositorio casi no se prueba (desbalance error vs happy)
- **Ubicacion:** repos del backend en general; unico contraejemplo `registration-repository.test.ts:97-108`.
- **Evidencia:** casi todos los repos se testean con `makeSqlReturning`, que SIEMPRE resuelve. Solo `registration-repository` prueba un `sql` que rechaza. La mayoria de bugs de produccion viven en el camino de error (la DB lanza, una fila no aparece), y a nivel repo eso casi no se ejercita; el manejo se delega al error-handler global (que SI esta bien cubierto: `error-handler-fastify.test.ts` mapea 413/500/errores desconocidos a respuestas seguras sin fuga).
- **Impacto:** un repo que traga un error de `sql` o mapea mal una fila parcial no seria detectado. El riesgo esta acotado porque el error-handler global normaliza, pero la propagacion en si no se afirma. Caso concreto detectado por el pase adversarial: un fallo de DB en una transicion de CIERRE del worker (`markCompleted`/`markFailed` lanzan porque la DB cae justo al cerrar el job) no tiene test -- el loop la propaga y hace back-off por intervalo (`worker.ts drainQueue`), pero ese camino no se ejerce.
- **Recomendacion:** un par de tests de "el `sql` rechaza -> el repo propaga" en los repos criticos (credentials, jobs), la rama uuid-invalido de `resolveStoredCredential`, y un caso de `markCompleted` que rechaza -> el loop corta la pasada sin tumbar el worker.

### MEDIA

- **M1. Claim atomico solo verificado por el TEXTO del SQL, no por concurrencia real.** `jobs-repository.test.ts:130-143` atrapa el borrado de `for update skip locked`, pero nada prueba que dos workers no tomen el mismo job (requeriria Postgres real). Punto ciego compartido con la e2e (que corre un solo worker). Ver seccion 5.
- **M2. Truncado del contexto de evento entrante (`MAX_EVENT_CONTEXT_CHARS`) sin test.** El cuerpo no confiable que se anexa al prompt se trunca a 8000 chars (`incoming-triggers.ts:44-46`); ningun test lo verifica -> el guard anti prompt-injection por tamano puede caerse sin aviso.
- **M3. Endpoints admin de escritura sin test de rechazo.** `admin-agents.ts` (POST/PUT/DELETE) solo tiene el 401 probado en GET; retention/data-requests solo prueban "sin token", no el token INCORRECTO. El guard centralizado `requireAdmin` no tiene test directo.
- **M4. Ramas de denegacion del auth de webhooks sin test.** `incoming-triggers.ts:93,95-99,109` (secreto null, descifrado que lanza, hash null) -> deberian dar 401, no 500; ninguna se ejerce.
- **M5. Validacion de `maxTokens` invalido sin test.** `validateAgentRun` (`limits.ts:71`) nunca se llama con un `maxTokens` fuera de rango.
- **M6. Tenencia transitiva de `agent_runs` (uso).** `run-repository` consulta solo por `agent_id`; la unica barrera es el guard de ruta (`agents.ts:86`), cubierto solo a nivel de mock. Depende por completo de C1.
- **M7. Fragilidad: acoplamiento al TEXTO exacto del SQL.** Muchos repo-tests asertan substrings del SQL (`toContain('where owner_id = ')`). Es semi-necesario con un `sql` mockeado, pero un refactor inocuo (renombrar un alias, reordenar columnas, formatear el template) puede romperlos sin cambiar comportamiento. Patron a vigilar, no bug.
- **M8. Los gemelos de cron TS y SQL no tienen test de paridad.** `nextCronRun` (`cron.ts:195`, TS, usado al crear/editar una tarea para calcular el proximo disparo que ve el usuario) y `scheduler_cron_next` (`migrations/V010__scheduler_pgcron.sql`, SQL, usado por `pg_cron` para disparar de verdad) DEBEN coincidir -- el propio codigo lo documenta (`cron.ts:8,54,190`). `cron.test.ts` (20 tests) prueba solo el lado TS; ningun test compara ambos. La e2e solo usa `* * * * *` (fase 6), que no revelaria una divergencia en la regla Vixie (dom vs dow con OR, pasos `a-b/n`, `dow=7`=domingo, horizonte de 1461 dias). Una divergencia haria que la tarea dispare a una hora distinta de la que la UI muestra, sin que falle ningun test. **Recomendacion:** un test que corra una tabla de expresiones (incluida `dom/dow`, pasos, bisiesto) por ambas funciones y afirme que dan el mismo `next-run` (requiere un `sql` real o portar la funcion SQL a un fixture).

### BAJA

- **B1.** Valor/offset del backoff de reintento no se asserta (solo el tipo `Date`) -- `execution.test.ts:170`.
- **B2.** Lectores SQL de alertas (`leerEmailOwner`/`leerNombreAgente`, `alertas.ts:288-318`) sin test (best-effort, no critico).
- **B3.** Rama defensiva "run sin evento stop" (`execution.ts:211`) sin test.
- **B4.** Redaccion de cookies (`set-cookie`) sin test.
- **B5.** Tests negativos de config faltantes (SESSION_TOKEN_SECRET min32, ADMIN_API_TOKEN) -- `env.test.ts` cubre VAULT/WEB_WORKER pero no todos.
- **B6.** `requireAdmin` compara el token con `!==` (no `timingSafeEqual`), inconsistente con el resto de la base (que usa comparacion en tiempo constante). Ningun test lo detectaria; riesgo de timing bajo (token interno), pero es una inconsistencia.
- **B7.** `triggers`/`jobs.listByOwner` no tienen el caso cross-owner explicito (B->vacio) que si tienen los demas; pero sus tests SI asertan el `where owner_id` + valores, asi que atraparian un `owner_id` caido -- es solo inconsistencia de estilo.
- **B8.** `aud` (audiencia) no validada por el verificador (`jwt-verifier.ts:21` solo pasa `{ issuer }`) ni testeada. Rebajada a BAJA por el pase adversarial: no validar `aud` es un diseno aceptado en Supabase, cuyo ancla de confianza es issuer + firma. Ligado a A1.

---

## 4. Tests que se auto-confirman

**Conclusion: el patron clasico esta esencialmente AUSENTE, lo cual es un positivo genuino.** Se muestreo ampliamente y se verifico especificamente la preocupacion del prompt:

- El test de cifrado NO mockea el cifrado: `aes-gcm.test.ts` usa `node:crypto` real; `credentials-route.test.ts` cifra con `encryptToToken` real y descifra para comparar. No hay `vi.mock` sobre el modulo bajo prueba.
- El worker NO se auto-confirma: `execution.test.ts` ejercita `processClaimedJob`/`handleFailure`/`runRecipeJob` REALES; los mocks son de dependencias inyectadas (runAgent, jobs, resolveCredential), lo cual es la tecnica correcta.
- Los adaptadores de proveedor mockean el SDK en la FRONTERA DE RED y dejan correr el mapeo real (`map-request`/`translate-stream`), no al reves.

Dicho eso, hay tres patrones "self-confirming de costura" -- donde una pieza pura se prueba pero el CABLEADO que la usa no, dando un verde enganoso:

1. **(CRITICA, = C1)** Los tests de la ruta de agents mockean el repositorio y el test del repositorio no assertea el `owner_id`: el filtro de aislamiento pasa "verde" sin que ninguna capa lo ejerza.
2. **(ALTA, = A3)** `classifyRegistration`/`hasPendingConsents` estan bien probados, pero `RegistrationGate`/`ConsentGate` que los cablean no: el gate puede romperse con los tests en verde.
3. **(BAJA, fragil/estructural)** Existe un test que hace `grep` del CODIGO FUENTE de `trigger-auth` para "probar" que usa `timingSafeEqual` -- assertea sobre el texto del codigo, no sobre el comportamiento. Aporta poca proteccion real (un refactor a otra API constant-time equivalente lo romperia; y no probaria que la comparacion es realmente en tiempo constante).

---

## 5. El punto ciego entre unit y e2e

La e2e (`scripts/validacion-e2e`, 9 fases + limpieza contra produccion) y los unit tests son complementarios:

- **Solo la e2e cubre:** encolado real por `pg_cron`, cifrado real en la DB de produccion (`encrypted_key` sin la key en claro), SSE de punta a punta contra el modelo real, auditoria de migraciones V001..V016, HMAC/token reales contra el endpoint publico, y el gate de tier `free -> 403` en vivo.
- **Solo los unit cubren:** los caminos de error y ramas raras (reintentos, shutdown, mismatch de proveedor, timeouts, corte de recetas, fallos de proveedor 4xx/5xx/stream), imposibles de forzar de forma determinista en produccion.
- **Puntos ciegos de AMBOS (lo mas peligroso):**
  1. **Concurrencia real del claim:** el unit prueba el TEXTO del SQL y la e2e corre UN solo worker -> nada ejerce dos workers compitiendo por el mismo job. Si `FOR UPDATE SKIP LOCKED` se rompiera semanticamente (no solo textualmente), no lo detectaria ni una ni otra.
  2. **Verificador JWT real:** la e2e solo manda un JWT valido (happy path); los unit mockean el verificador. Las ramas de RECHAZO (firma mala, issuer incorrecto, expirado) no las cubre nadie (= A1).
  3. **La UI de la consola:** la e2e golpea el API directamente (`POST /v1/agents`...), NO conduce la consola; y no hay tests de componente. Los ~50 componentes React quedan sin red en NINGUNA de las dos (= A3).
  4. **bodyLimit del webhook y truncado de contexto:** ninguna de las dos envia un cuerpo > 64KB (= A2/M2).
  5. **Gemelos de cron TS vs SQL (`nextCronRun` / `scheduler_cron_next`):** el unit prueba solo el TS y la e2e solo el caso `* * * * *`; una divergencia en la regla Vixie no la ve nadie (= M8).
  6. **RLS como respaldo de tenancy:** la e2e usa la `service_role` de Supabase (que hace BYPASS de RLS) y los unit mockean el `sql`, asi que las POLITICAS RLS de Postgres nunca se ejercitan. El aislamiento depende enteramente del filtro `owner_id` de la capa de app -- que, ademas, en `agents` no esta bien afirmado (C1). Si ese filtro se cayera, RLS deberia ser la red -- pero esa red no la prueba nadie. (Se cruza con la auditoria 05.)
  7. **Idempotencia del scheduler bajo ticks concurrentes** (`enqueue_due_scheduled_tasks`) y la **cadena real de fallo de proveedor 5xx** (proveedor cae -> reintento con backoff -> agota MAX_ATTEMPTS -> `markFailed` + alerta): los unit prueban las piezas con mocks, la e2e usa el happy path -> el comportamiento integrado bajo fallo real no corre de punta a punta.

---

## 6. Lo que SI esta bien probado (honesto)

- **Criptografia (aes-gcm, session-token):** crypto real, IV unico, deteccion de tampering/truncado, sin fuga del secreto, compatibilidad byte-por-byte con el esquema viejo. Ejemplar.
- **Worker / cola / recetas:** cobertura densa y NO self-confirming; la logica de decision (reintento vs failed vs permanente vs shutdown, encadenamiento de pasos, deadlines, cooldown de alertas) corre de verdad.
- **Nucleo del webhook entrante:** HMAC valido/invalido/replay/token con crypto real y reloj inyectado; integridad del raw body; no-enumeracion; anti-SSRF exhaustivo (`ip-guard`).
- **Motor / proveedores:** timeout, token_cap, mismatch de proveedor (ambos lados), cliente desconectado, mapeo de errores 4xx/5xx/stream -- todos con el mapeo real ejercido.
- **Aislamiento de 8/9 recursos:** patron cross-owner robusto (A ve lo suyo, B ve null).
- **Gates de tier:** en la ruta Y en el worker (defensa en profundidad).
- **No-fuga de secretos:** redaccion de logs y centinelas sobre multiples superficies del ejecutor.
- **Logica pura del frontend:** schemas (agent/credential), parsing SSE, token-manager del widget (refresh por margen), historial transaccional (`turns`), precedencia de credencial -- genuinamente bien probada, aunque la UI no lo este.

---

## 7. Recomendacion: los tests de mayor valor a agregar (por riesgo/esfuerzo)

Ordenados por retorno (cada uno es esfuerzo bajo, riesgo alto):

1. **`agent-repository.test.ts`: caso cross-owner + assert de `owner_id`** para `getByIdForOwner`/`updateForOwner`/`removeForOwner`/`listByOwner` (cierra C1, el IDOR mas probable). Portar el patron `makeOwnerScopedSql` que ya existe. **~1-2 h, cubre la CRITICA de tenancy.**
2. **`jwt-verifier.test.ts` con JWKS local** (token valido / issuer malo / expirado / `sub` ausente) -> cierra A1, la raiz de confianza de auth.
3. **Test de 413 del webhook (body > 64KB) + truncado de contexto** -> cierra A2/M2 (guards DoS/prompt-injection publicos).
4. **`jsdom` + testing-library en la consola** y tests de `ProtectedRoute`, `ConsentGate`/`RegistrationGate` (incluida la rama de error = no fail-open) y el envio de secretos de `mutations.ts` -> cierra el nucleo de A3.
5. **Ramas de denegacion del auth de webhooks** (secreto null / descifrado que lanza -> 401) y **token admin incorrecto** en rutas destructivas -> cierra M3/M4.
6. **Un test de "el `sql` rechaza -> el repo propaga"** en credentials/jobs -> mejora el balance de camino de error (A3).

---

## 8. Cobertura y alcance de esta auditoria

- Se corrio la suite completa (1232 tests, todos verdes) y la cobertura de lineas v8 en backend/worker/shared.
- Se leyo la FUENTE del invariante y su test para cada dominio de A) a F), y se muestreo transversalmente para B) self-confirming, C) fragilidad/flakiness, D) balance de error y H) frontend.
- Los hallazgos de mayor severidad (C1, C2, A1, A2, M1) se re-verificaron de forma independiente con evidencia `path:linea`, ademas del pase de verificacion adversarial.
- **No se modifico ningun archivo.** No se ejecuto nada contra produccion. Correr la suite local es read-only respecto al sistema.
- **Flakiness/determinismo (punto I):** no se hallaron tests con dependencia de tiempo real sin control -- los que tocan tiempo usan `vi.useFakeTimers` y `afterEach` restaura; los timeouts se prueban con timers falsos y reloj inyectado. La suite es determinista.
- **Limitacion:** la cobertura de lineas de `apps/console` y los `packages/widget*` no esta instrumentada (sin config de coverage); el conteo de tests si es conocido y la ausencia de tests de componente se confirmo por inspeccion.
