# Auditoria de seguridad 01 - Autenticacion y Autorizacion

- **Alcance**: toda la plataforma (monorepo). `apps/backend` (rutas, auth, server), `apps/worker`
  (gate de tier en ejecucion), `packages/widget` (session token), `apps/console` (gates de UI).
- **Tipo**: auditoria adversarial, SOLO LECTURA. No se modifico codigo, tests ni configuracion.
- **Fecha**: 2026-07-02.
- **Metodo**: lectura del codigo real (rutas enumeradas desde `server.ts` y `routes/*`, no desde docs),
  verificacion de cada hallazgo contra `path:linea`, y una pasada de verificacion adversarial
  independiente. Cada hallazgo lleva su nivel de confianza explicito.

---

## 1. Resumen ejecutivo

La postura general de auth/authz es **solida en su nucleo**: el aislamiento por dueno (IDOR) esta
cerrado de forma consistente (el `owner_id` SIEMPRE sale del JWT verificado, nunca del body/param),
los gates de tier premium estan server-side en creacion Y en ejecucion (con re-gate en el worker como
defensa en profundidad), las credenciales nunca se devuelven en claro y la redaccion de secretos en
logs es completa. No se encontraron rutas protegidas registradas por error como publicas, ni bypass
del gate de tier, ni oraculos de enumeracion de usuarios en el flujo de login.

El hallazgo mas serio es una **SSRF sin autenticacion** en el endpoint publico `POST /v1/agent/run`
(y su variante autenticada): la guarda anti-SSRF (`ip-guard`) se aplica a las webhook tools pero **no**
al egress del proveedor de modelo, cuya `baseUrl` es controlable por el llamador. El resto son
debilidades reales de menor impacto: comparacion no constante del token de admin (contra la propia
politica del proyecto), ausencia de revocacion del session-token, un token de super-admin unico sin
atribucion de actor, y varias mejoras de higiene (hardening de JWT, CORS por defecto, fuga de detalles
de validacion, cobertura de tests).

**Conteo por severidad**: CRITICA 0 · ALTA 1 · MEDIA 5 · BAJA 10.

**Estado en una frase**: base de autenticacion y autorizacion bien construida y consistente, con una
SSRF no autenticada que debe cerrarse y un puñado de endurecimientos pendientes; ningun agujero que
permita a un usuario ejecutar autonomia sin tier o leer datos de otro dueño.

---

## 2. Inventario completo de endpoints

Rutas enumeradas desde `apps/backend/src/server.ts` y cada archivo de `apps/backend/src/routes/*`.
Auth: **PUBLICA** (sin identidad), **JWT** (`requireUser`, Bearer de Supabase), **admin**
(`x-admin-token`), **session-token** (widget), **HMAC/url_token** (webhook entrante de triggers).

| # | Metodo | Ruta | Ubicacion | Auth exigida | Correcta | Notas |
|---|--------|------|-----------|--------------|:---:|-------|
| 1 | GET | `/health` | `routes/health.ts:4` | PUBLICA | Si | Solo `{status:'ok'}`; no toca DB ni filtra config. |
| 2 | POST | `/v1/agent/run` | `routes/agent.ts:63` | PUBLICA (BYOK `x-provider-key`) | Si (publica por diseno) | Demo/playground. **SSRF** via `x-provider-base-url` (H-01). |
| 3 | POST | `/v1/run/:agentId` | `routes/run-agent-by-id.ts:142` | session-token O `x-provider-key` (PUBLICA) O `x-credential-id` (JWT) | Parcial | `getById` global, sin binding de dueno (H-02). |
| 4 | POST | `/v1/session-tokens` | `routes/session-tokens.ts:24` | PUBLICA (`x-provider-key`) | Si (con matiz) | Acuña token que cifra la key del propio llamador; sin binding de owner (H-15). |
| 5 | POST | `/webhooks/triggers/:triggerId` | `routes/incoming-triggers.ts:163` | HMAC o url_token | Si | Autentica antes de encolar; encola solo el job de SU trigger (F ok). |
| 6 | POST | `/v1/configurator/message` | `routes/configurator.ts:80` | JWT (+ gate tier solo si `mode='autonomous'`) | Si | Gate autonomo server-side antes de llamar al modelo. |
| 7 | GET | `/v1/tools/catalog` | `routes/tools.ts:16` | JWT | Si | Solo lectura. |
| 8 | GET | `/v1/agents` | `routes/agents.ts:67` | JWT (`listByOwner`) | Si | Owner del token. |
| 9 | GET | `/v1/agents/:id` | `routes/agents.ts:73` | JWT (`getByIdForOwner`) | Si | IDOR-safe. |
| 10 | GET | `/v1/agents/:id/usage` | `routes/agents.ts:82` | JWT (`getByIdForOwner`) | Si | Owner-scoped. |
| 11 | POST | `/v1/agents` | `routes/agents.ts:100` | JWT | Si | Fuerza `ownerId=user.id`, ignora body (`:105`). |
| 12 | PUT | `/v1/agents/:id` | `routes/agents.ts:109` | JWT (`updateForOwner`) | Si | Owner-scoped. |
| 13 | POST | `/v1/agents/:id/webhook-secret/rotate` | `routes/agents.ts:119` | JWT (owner-scoped) | Si | |
| 14 | POST | `/v1/agents/:id/tools/:toolName/test` | `routes/agents.ts:128` | JWT (`getByIdForOwner`) | Si | Usa ejecutor firmado con anti-SSRF. |
| 15 | DELETE | `/v1/agents/:id` | `routes/agents.ts:150` | JWT (`removeForOwner`) | Si | Owner-scoped. |
| 16 | POST | `/v1/credentials` | `routes/credentials.ts:41` | JWT | Si | Cifra la key antes de la DB; respuesta sin key. |
| 17 | GET | `/v1/credentials` | `routes/credentials.ts:61` | JWT | Si | Solo metadata, nunca la key. |
| 18 | DELETE | `/v1/credentials/:id` | `routes/credentials.ts:68` | JWT (`deleteForOwner`) | Si | Owner-scoped. |
| 19 | POST | `/v1/scheduled-tasks` | `routes/scheduled-tasks.ts:90` | JWT + gate tier `autonomous` | Si | Gate `:100`; valida pertenencia agente/credencial. |
| 20 | GET | `/v1/scheduled-tasks` | `routes/scheduled-tasks.ts:131` | JWT (`listTasksByOwner`) | Si | |
| 21 | PATCH | `/v1/scheduled-tasks/:id` | `routes/scheduled-tasks.ts:139` | JWT (owner-scoped) | Si | No re-gatea tier (worker re-gatea); ver H-09. |
| 22 | DELETE | `/v1/scheduled-tasks/:id` | `routes/scheduled-tasks.ts:187` | JWT (owner-scoped) | Si | |
| 23 | POST | `/v1/recipes` | `routes/recipes.ts:119` | JWT + gate tier `autonomous` | Si | Gate `:129`. |
| 24 | GET | `/v1/recipes` | `routes/recipes.ts:153` | JWT | Si | Resumen owner-scoped. |
| 25 | GET | `/v1/recipes/:id` | `routes/recipes.ts:160` | JWT (owner-scoped) | Si | |
| 26 | PATCH | `/v1/recipes/:id` | `routes/recipes.ts:176` | JWT (owner-scoped) | Si | |
| 27 | DELETE | `/v1/recipes/:id` | `routes/recipes.ts:213` | JWT (owner-scoped) | Si | |
| 28 | POST | `/v1/recipes/:id/run` | `routes/recipes.ts:240` | JWT + gate tier `autonomous` | Si | Gate `:251` ANTES de resolver la receta; encola job. |
| 29 | POST | `/v1/triggers` | `routes/triggers.ts:120` | JWT + gate tier `autonomous` | Si | Gate `:130`; secreto en claro una sola vez. |
| 30 | GET | `/v1/triggers` | `routes/triggers.ts:185` | JWT (`listByOwner`) | Si | Listado sin material de auth. |
| 31 | PATCH | `/v1/triggers/:id` | `routes/triggers.ts:194` | JWT (owner-scoped) | Si | Activa/rota; no re-gatea tier (ver H-09). |
| 32 | DELETE | `/v1/triggers/:id` | `routes/triggers.ts:249` | JWT (owner-scoped) | Si | |
| 33 | GET | `/v1/jobs` | `routes/jobs.ts:81` | JWT (`listByOwner`) | Si | Sin gate tier a proposito (lectura propia); owner del token. |
| 34 | POST | `/v1/register/individual` | `routes/registration.ts:50` | JWT | Si | |
| 35 | POST | `/v1/register/organization` | `routes/registration.ts:62` | JWT | Si | Org queda `pending` hasta aprobacion admin. |
| 36 | GET | `/v1/me` | `routes/registration.ts:78` | JWT | Si | Estado del propio usuario (incluye tier autoritativo). |
| 37 | POST | `/v1/consents` | `routes/consents.ts:64` | JWT | Si | owner del token; ip/ua como evidencia. |
| 38 | GET | `/v1/consents/me` | `routes/consents.ts:87` | JWT | Si | Owner-scoped. |
| 39 | POST | `/v1/data-requests` | `routes/data-requests.ts:73` | JWT | Si | owner del token. |
| 40 | GET | `/v1/data-requests/export` | `routes/data-requests.ts:89` | JWT | Si | Export self-service solo del propio titular. |
| 41 | GET | `/v1/data-requests` | `routes/data-requests.ts:110` | JWT | Si | Owner-scoped. |
| 42 | POST | `/v1/processing-records` | `routes/processing-records.ts:38` | JWT | Si | owner del token. |
| 43 | GET | `/v1/processing-records` | `routes/processing-records.ts:54` | JWT | Si | Owner-scoped. |
| 44 | GET | `/v1/admin/agents` | `routes/admin-agents.ts:41` | admin | Si | Comparacion no constante (H-04). |
| 45 | GET | `/v1/admin/agents/:id` | `routes/admin-agents.ts:47` | admin | Si | `getById` global (admin, correcto). |
| 46 | POST | `/v1/admin/agents` | `routes/admin-agents.ts:56` | admin | Si | Admin puede fijar `ownerId` (correcto). |
| 47 | PUT | `/v1/admin/agents/:id` | `routes/admin-agents.ts:66` | admin | Si | |
| 48 | DELETE | `/v1/admin/agents/:id` | `routes/admin-agents.ts:79` | admin | Si | |
| 49 | POST | `/v1/admin/organizations/:id/approve` | `routes/registration.ts:86` | admin | Si | Aprueba org; NO usa `requireUser` (correcto). |
| 50 | POST | `/v1/admin/profiles/:id/tier` | `routes/registration.ts:102` | admin | Si | Palanca manual de tier; validado con zod. |
| 51 | POST | `/v1/admin/data-requests/:id/resolve` | `routes/data-requests.ts:118` | admin | Si | `erase` opt-in y solo sobre `erasure`. |
| 52 | POST | `/v1/admin/retention/purge` | `routes/retention.ts:28` | admin | Si | `now` server-side, no acepta cortes del cliente. |

**Superficies no-HTTP relevantes al modelo de autorizacion:**

| Componente | Ubicacion | Rol en authz | Notas |
|---|---|---|---|
| `enqueue_due_scheduled_tasks` (pg_cron) | `migrations/V010__scheduler_pgcron.sql:193` | Encola jobs de tareas activas cada minuto | SIN gate de tier: solo INSERT; el worker re-gatea (ver H-09). |
| `processClaimedJob` (worker) | `apps/worker/src/execution.ts:243-248` | **RE-GATE server-side de tier** al ejecutar | Defensa critica: `tier !== 'autonomous'` -> fallo permanente. |

**Rutas publicas confirmadas (5):** `/health`, `/v1/agent/run`, `/v1/run/:agentId`,
`/v1/session-tokens`, `/webhooks/triggers/:triggerId`. Las cuatro ultimas son el plano de ejecucion
BYOK/widget/eventos, publico **por diseno**; ninguna expone datos de otros duenos ni opera sobre la
boveda. No se hallo ninguna ruta de usuario/admin registrada sin su guard por error.

---

## 3. Hallazgos

Severidad: **CRITICA** (explotable ya, expone datos/dinero) · **ALTA** (explotable con condiciones) ·
**MEDIA** (debilidad real sin explotacion directa) · **BAJA** (higiene).

### H-01 · ALTA · SSRF sin autenticacion via la baseUrl del proveedor de modelo

- **Confianza**: alta (mecanismo verificado); media (impacto: SSRF ciega).
- **Ubicacion**: `apps/backend/src/routes/agent.ts:64-77`,
  `apps/backend/src/providers/openai-compatible/openai-compatible-provider.ts:22-28`. Variante
  autenticada: `apps/backend/src/routes/agents.ts:53` (baseUrl de agente) y
  `apps/backend/src/routes/credentials.ts:19` (baseUrl de credencial).
- **Evidencia**: en `agent.ts`, el endpoint PUBLICO toma la baseUrl de un header controlado por el
  cliente y la pasa como credencial del proveedor:
  ```ts
  const baseUrlHeader = request.headers['x-provider-base-url'];
  const baseUrl = typeof baseUrlHeader === 'string' && baseUrlHeader.trim() !== '' ? baseUrlHeader : undefined;
  // ...
  const credentials: ProviderCredentials = { apiKey, ...(baseUrl !== undefined ? { baseUrl } : {}) };
  ```
  El proveedor openai-compatible conecta a esa URL SIN ninguna guarda de egress:
  ```ts
  const baseURL = input.credentials.baseUrl;
  // ...
  const client = new OpenAI({ apiKey: input.credentials.apiKey, baseURL });
  const stream = await client.chat.completions.create(params, { signal: input.signal });
  ```
  La guarda anti-SSRF existe (`apps/backend/src/tools/ip-guard.ts`: `resolvesToForbiddenIp`,
  bloquea loopback/privadas/link-local incluida metadata de nube) pero un grep confirma que **solo**
  se usa en `apps/backend/src/tools/webhook-tools.ts`, nunca en la ruta del proveedor.
- **Explotabilidad**: un atacante SIN autenticacion hace
  `POST /v1/agent/run` con `providerId: "openai-compatible"`, un `x-provider-key` cualquiera y
  `x-provider-base-url: http://169.254.169.254` (o `http://127.0.0.1:<puerto>`, o un host interno).
  El backend emite un `POST {baseURL}/chat/completions` con `Authorization: Bearer <key>` desde la red
  del servidor. Es una SSRF ciega (el metodo es POST a un sufijo fijo y la respuesta debe parsear como
  stream OpenAI o falla), pero el evento `error` del SSE y las diferencias de tiempo/tipo de error
  (conexion rechazada vs timeout vs respuesta HTTP) forman un oraculo util para escanear puertos y
  alcanzar servicios internos que acepten POST. La misma primitiva es alcanzable de forma autenticada
  guardando un agente/credencial con `baseUrl` interna y corriendo el agente.
- **Recomendacion**: aplicar la MISMA guarda `resolvesToForbiddenIp` (fail-closed) a la baseUrl del
  proveedor antes de conectar, en la capa de providers/factory, cubriendo los tres caminos (header de
  `/v1/agent/run`, baseUrl de agente y baseUrl de credencial). Exigir ademas esquema `https://` a la
  baseUrl de agente/credencial (hoy `z.string().url()` acepta `http://`). Considerar una allowlist de
  hosts de proveedores conocidos.

### H-02 · MEDIA · Ejecucion de agentes sin binding de propiedad dispara las webhook tools del dueno

- **Confianza**: alta (mecanismo); baja (si es abuso o diseno aceptado).
- **Ubicacion**: `apps/backend/src/routes/run-agent-by-id.ts:182` (usa `repo.getById(agentId)`, no
  `getByIdForOwner`); emision del token en `apps/backend/src/routes/session-tokens.ts:33`.
- **Evidencia**: `const agent = await repo.getById(agentId);` — el agente se resuelve por UUID global,
  sin comprobar que quien ejecuta sea su dueno. Al ejecutar, `assembleAgentRun` firma las webhook tools
  del agente con `agent.webhookSecret` (secreto que la plataforma custodia).
- **Explotabilidad**: cualquiera que conozca el UUID de un agente (los agentes del widget son publicos
  por diseno) puede ejecutar su configuracion server-side, incluidas sus webhook tools, provocando que
  la plataforma emita llamadas FIRMADAS con el secreto del dueno hacia los endpoints webhook del dueno.
  Incluso el camino autenticado por credencial (`x-credential-id`, que exige JWT) corre contra un
  `agentId` arbitrario: un usuario A, con su propia credencial, puede disparar las webhook tools del
  agente de un usuario B. El dano concreto depende de lo que hagan esas tools (dominio de la auditoria
  4 de webhooks). No expone la key del dueno ni su `webhookSecret` (no se retornan).
- **Recomendacion**: decidir explicitamente el modelo. Si la ejecucion publica por UUID es intencional
  (widget), documentarlo y asegurar que las webhook tools jamas alcancen recursos sensibles del dueno
  sin su propio control (rate limit por agente, allowlist de destinos). Para el camino autenticado por
  credencial, considerar exigir que el agente pertenezca al usuario (`getByIdForOwner`). Cruzar con la
  auditoria 4.

### H-03 · MEDIA · Token de super-admin unico y compartido, sin atribucion de actor ni rotacion

- **Confianza**: alta.
- **Ubicacion**: `apps/backend/src/auth/require-admin.ts:10` y los 9 endpoints admin (tabla, #44-52).
- **Evidencia**: toda operacion admin se autoriza con un unico secreto estatico (`ADMIN_API_TOKEN`)
  comparado en tres guards identicos. No hay identidad de operador, ni scoping por accion, ni registro
  de quien ejecuto.
- **Explotabilidad**: el token concentra poderes destructivos (borrar agentes, cambiar tier de
  cualquier usuario, aprobar organizaciones, purgar retencion, resolver/borrar datos ARCO de cualquier
  titular con `erase`). Una sola fuga (log, variable de entorno, CI, un operador que rota) otorga
  control total sin trazabilidad: no se puede saber que actor humano ejecuto un borrado, ni revocar a
  un operador sin rotar el secreto de toda la plataforma. Es un riesgo de gobernanza/insider y de
  ampliacion de impacto ante cualquier fuga.
- **Recomendacion**: mover el plano admin a identidades por-operador (p.ej. un claim/rol admin en el
  JWT de Supabase, o tokens por-actor firmados y revocables), registrar actor+accion en un audit log
  append-only, y separar poderes de lectura de los destructivos. Como minimo, rotacion documentada y
  alerta ante uso.

### H-04 · MEDIA · La comparacion del token de admin no es de tiempo constante (contradice la politica del proyecto)

- **Confianza**: alta (el codigo usa `!==`); baja (explotacion remota practica).
- **Ubicacion**: `apps/backend/src/auth/require-admin.ts:12`,
  `apps/backend/src/routes/admin-agents.ts:32`, `apps/backend/src/routes/registration.ts:34`.
- **Evidencia**:
  ```ts
  if (typeof token !== 'string' || token !== config.ADMIN_API_TOKEN) {
    throw new AppError('UNAUTHORIZED', 401, 'Invalid or missing admin token');
  }
  ```
  El operador `!==` sobre strings hace short-circuit y filtra por timing. El propio proyecto establece
  lo contrario para los triggers: `apps/backend/src/triggers/trigger-auth.ts:58-62`
  (`timingSafeEqualHex` con `crypto.timingSafeEqual`) y tiene un test estructural que PROHIBE `===`
  sobre el hash. El plano admin se desvia de esa politica.
- **Explotabilidad**: canal lateral de timing en la comparacion del secreto. En la practica, explotar
  esto de forma remota contra un token aleatorio de 16+ caracteres es inviable (el jitter de red domina
  la señal y el rate-limit global acota los intentos); el valor real es cerrar el canal y ser
  consistente con la propia politica del proyecto (defensa en profundidad).
- **Recomendacion**: comparar con `crypto.timingSafeEqual` (con chequeo de longitud previo), reusando
  el helper que ya existe para triggers, en un unico guard centralizado (ver H-13).

### H-05 · MEDIA · El session-token del widget no tiene revocacion

- **Confianza**: media.
- **Ubicacion**: `apps/backend/src/auth/session-token.ts:13-28` (stateless, sin store);
  emision en `apps/backend/src/routes/session-tokens.ts:24`.
- **Evidencia**: el comentario del modulo lo declara: *"La expiracion corta es la mitigacion ante fuga
  del token; no hay revocacion."* El token cifra (AES-256-GCM) la provider key del integrador atada al
  `agentId`, con TTL default 900s y maximo 3600s.
- **Explotabilidad**: si un session-token se filtra (esta pensado para viajar al navegador del sitio del
  cliente), su portador puede ejecutar el agente — gastando la provider key del integrador — hasta por
  1 hora, sin kill-switch. No hay forma de invalidar un token concreto ni todos los de un agente sin
  rotar `SESSION_TOKEN_SECRET` (que invalida TODOS a la vez). El alcance del portador esta bien
  acotado (solo ejecutar el agente atado, ver Seccion 4), pero el coste facturable es real.
- **Recomendacion**: aceptar el trade-off documentado pero ofrecer una palanca de revocacion:
  p.ej. una denylist de `jti` en cache corta, o un contador de version por agente que invalide tokens
  al rotarse desde la UI. Como minimo, reducir el TTL maximo por defecto y documentar el riesgo al
  emisor.

### H-06 · MEDIA · Amplificacion de coste / replay en el webhook entrante de triggers

- **Confianza**: media. **Cruce**: auditoria 4 (webhooks) lo cubre a fondo.
- **Ubicacion**: `apps/backend/src/routes/incoming-triggers.ts:196` (encola el job),
  `apps/backend/src/tools/webhook-signature.ts:17` (anti-replay solo por ventana temporal).
- **Evidencia**: la verificacion HMAC solo comprueba `Math.abs(now - timestamp) <= 300`; no hay nonce
  ni store de idempotencia. El endpoint solo aplica el rate-limit **global por IP**
  (`plugins/security.ts:48`), sin throttle por-trigger ni por-owner.
- **Explotabilidad**: quien posea el secreto del trigger (el integrador, o cualquiera que lo filtre)
  puede re-enviar el MISMO POST firmado dentro de la ventana de 300s y encolar jobs duplicados; cada job
  ejecuta el agente y consume la credencial/saldo del proveedor del owner. No es un abuso NO autenticado
  (sin secreto valido el endpoint responde 401 y no encola), pero si un vector de amplificacion de coste
  por replay y por un tenedor legitimo/comprometido del secreto.
- **Recomendacion**: añadir idempotencia (nonce firmado o hash del `(timestamp, body)` visto, con TTL
  igual a la ventana) y un rate-limit por-trigger/por-owner ademas del global. Detalle en auditoria 4.

### H-07 · BAJA · JWT: `jwtVerify` sin allowlist de `algorithms`

- **Confianza**: alta (falta el parametro); el ataque de confusion NO es explotable hoy.
- **Ubicacion**: `apps/backend/src/auth/jwt-verifier.ts:21`.
- **Evidencia**: `const { payload } = await jwtVerify(token, jwks, { issuer });` — no se pasa
  `algorithms: ['ES256']`.
- **Explotabilidad**: hardening. La confusion de algoritmo (p.ej. HS256 firmado con la clave publica, o
  `alg: none`) **no** es explotable en la practica porque `createRemoteJWKSet` de jose resuelve la clave
  por `kid` y su tipo (EC) y rechaza `none`; un HS256 no verifica contra una clave EC. Aun asi, pinnear
  el algoritmo elimina la dependencia de ese comportamiento implicito de la libreria.
- **Recomendacion**: pasar `{ issuer, algorithms: ['ES256'] }` a `jwtVerify`.

### H-08 · BAJA · JWT: no se valida `audience` (`aud`)

- **Confianza**: media.
- **Ubicacion**: `apps/backend/src/auth/jwt-verifier.ts:21`.
- **Evidencia**: solo se valida `issuer`; no se pasa `audience`.
- **Explotabilidad**: baja. Un token del MISMO proyecto Supabase emitido para otra audiencia (p.ej.
  otra API del mismo proyecto) seria aceptado. Mismo proyecto = mismo dominio de confianza, por lo que
  el impacto es marginal; es endurecimiento de la validacion.
- **Recomendacion**: validar `audience: 'authenticated'` (el `aud` estandar de los tokens de usuario de
  Supabase).

### H-09 · BAJA · Bajar el tier no desactiva triggers/tareas/recetas existentes; siguen encolando jobs

- **Confianza**: alta. La defensa en profundidad se sostiene (el worker re-gatea).
- **Ubicacion**: `apps/backend/src/routes/triggers.ts:194` y `scheduled-tasks.ts:139` (PATCH no
  re-gatea), `apps/backend/migrations/V010__scheduler_pgcron.sql:193` (pg_cron encola sin gate),
  `apps/backend/src/routes/incoming-triggers.ts:196` (webhook encola sin gate).
- **Evidencia**: `enqueue_due_scheduled_tasks()` inserta jobs para toda tarea activa vencida sin mirar
  el tier; el PATCH de triggers/tasks solo activa/rota. El gate de tier vive en la creacion (ruta) y en
  la ejecucion (`apps/worker/src/execution.ts:246`: `if (tier !== 'autonomous') throw Permanent...`).
- **Explotabilidad**: nula en cuanto a ejecucion no autorizada — el worker rechaza el job como fallo
  permanente. El efecto es churn: un usuario que fue `autonomous` y luego baja de plan sigue teniendo
  triggers/tareas que encolan jobs (via pg_cron y via webhook) que fallan y generan notificaciones de
  fallo al owner, ademas de ruido en la cola. No hay escalacion de privilegio.
- **Recomendacion**: al bajar el tier de un perfil, desactivar (o marcar) sus triggers/tareas/recetas
  activas para no encolar jobs destinados a fallar; o filtrar por tier en `enqueue_due_scheduled_tasks`.

### H-10 · BAJA · Los detalles de validacion (`error.validation`) se devuelven al cliente incluso en produccion

- **Confianza**: alta.
- **Ubicacion**: `apps/backend/src/errors/error-handler.ts:14-24`.
- **Evidencia**: la rama de validacion corre ANTES del enmascarado de produccion y siempre incluye
  `details: error.validation`:
  ```ts
  if (error.validation) {
    reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: error.message, details: error.validation }, ... });
    return;
  }
  ```
- **Explotabilidad**: fuga menor de estructura interna (nombres de campos, esquema esperado, keywords de
  JSON-Schema) util para un atacante que mapea la superficie. No expone secretos.
- **Recomendacion**: en produccion, omitir o resumir `details` de los errores de validacion (mantener
  el detalle solo en dev/test), consistente con el enmascarado que ya se aplica a 4xx/5xx mas abajo.

### H-11 · BAJA · CORS_ORIGINS por defecto `*` refleja cualquier origen

- **Confianza**: alta.
- **Ubicacion**: `apps/backend/src/config/env.ts:11` (`default('*')`),
  `apps/backend/src/plugins/security.ts:8-20` (un solo `*` => `origin: true`).
- **Evidencia**: si `CORS_ORIGINS` no se setea, la API refleja cualquier `Origin`.
- **Explotabilidad**: baja en el modelo actual — la API usa Bearer (no cookies ni credenciales
  ambientales) y CORS NO habilita `credentials: true`, asi que no hay CSRF ni robo de sesion via
  navegador. El riesgo es que el default permisivo llegue a produccion sin restringir. El widget requiere
  origen abierto por diseno, lo que justifica la opcion, pero deberia acotarse a los origenes reales.
- **Recomendacion**: setear `CORS_ORIGINS` explicito en produccion (dominios de la consola + el patron
  del widget si aplica) y documentar que el default `*` es solo para desarrollo.

### H-12 · BAJA · Enumeracion de existencia/actividad de triggers via 401 vs 404

- **Confianza**: alta.
- **Ubicacion**: `apps/backend/src/routes/incoming-triggers.ts:174` (404 si null/inactivo) vs `:181`
  (401 si auth invalida).
- **Evidencia**: un trigger inexistente O inactivo devuelve 404; uno existente y ACTIVO con auth invalida
  devuelve 401. El comentario del archivo afirma "no filtra la existencia de un trigger", pero la
  diferencia de codigo distingue "existe y activo" de "no existe / inactivo".
- **Explotabilidad**: baja. Con un `triggerId` (UUID) un atacante puede distinguir triggers activos de
  inexistentes/inactivos por el status. Requiere conocer/adivinar UUIDs (espacio enorme), por lo que el
  valor practico para el atacante es escaso, pero es un oraculo de enumeracion contra el comentario que
  promete lo contrario.
- **Recomendacion**: devolver un status uniforme (p.ej. 401/404 constante) para "auth fallida" e
  "inexistente/inactivo", o aceptar y documentar el trade-off corrigiendo el comentario.

### H-13 · BAJA · Guard de admin triplicado (tres copias divergentes)

- **Confianza**: alta.
- **Ubicacion**: `apps/backend/src/auth/require-admin.ts:10`,
  `apps/backend/src/routes/admin-agents.ts:30`, `apps/backend/src/routes/registration.ts:32`.
- **Evidencia**: la misma funcion `requireAdmin` esta copiada tres veces (los comentarios lo admiten:
  "Se replica aqui en vez de importarlo"). Existe ya un modulo centralizado (`auth/require-admin.ts`)
  que las otras dos no reusan.
- **Explotabilidad**: no directa. Es deuda: un arreglo de seguridad (p.ej. el de H-04) hay que aplicarlo
  en tres sitios; una copia que se olvide diverge silenciosamente.
- **Recomendacion**: dejar un unico `requireAdmin` (el de `auth/require-admin.ts`) e importarlo en
  `admin-agents.ts` y `registration.ts`.

### H-14 · BAJA · Sin rate limiting especifico anti-fuerza-bruta para el token de admin

- **Confianza**: media.
- **Ubicacion**: `apps/backend/src/plugins/security.ts:48-57` (solo rate-limit global por IP).
- **Evidencia**: los endpoints admin comparten el tope global (`RATE_LIMIT_MAX`, default 100/min por IP);
  no hay lockout ni tope reforzado tras fallos de `x-admin-token`.
- **Explotabilidad**: baja (el token es aleatorio y >=16 chars; el espacio de fuerza bruta es enorme y
  el rate-limit global ya acota). Es endurecimiento.
- **Recomendacion**: aplicar un rate-limit mas estricto (o backoff/lockout por IP) a las rutas
  `/v1/admin/*` y alertar ante rafagas de 401 admin.

### H-15 · BAJA · La emision de session-token no verifica identidad ni pertenencia del agente

- **Confianza**: alta (mecanismo); la severidad es baja por el modelo BYOK.
- **Ubicacion**: `apps/backend/src/routes/session-tokens.ts:24-45`.
- **Evidencia**: el endpoint solo exige `x-provider-key` y un `agentId` que EXISTA
  (`repo.getById`); no valida JWT ni que el agente sea del llamador.
- **Explotabilidad**: baja. Cualquiera con cualquier `x-provider-key` puede acuñar un token para
  cualquier `agentId` existente — pero el token cifra la key del PROPIO llamador (no la de otro) y solo
  sirve para ejecutar ese agente. No otorga privilegios ajenos ni filtra secretos. El riesgo relevante
  (disparar las webhook tools del dueno) ya se captura en H-02; aqui es mint sin identidad, coherente con
  el plano publico del widget.
- **Recomendacion**: aceptar el modelo pero documentarlo explicitamente (test incluido, ver H-16.e). Si
  se desea reducir la superficie, exigir que el `agentId` acepte session-tokens (flag por agente) o un
  origin allowlist para la emision.

### H-16 · BAJA · Huecos de cobertura de tests en el nucleo de auth

- **Confianza**: alta (verificado leyendo los tests existentes).
- **Ubicacion / evidencia**:
  - (a) **No existe `apps/backend/test/jwt-verifier.test.ts`**: `createSupabaseJwtVerifier` (la
    verificacion real de JWKS/ES256, issuer, `sub`) no tiene ningun test. `require-user.test.ts:11`
    mockea el verifier, asi que exp vencido, algoritmo manipulado, issuer erroneo y `sub` ausente/vacio
    no se ejercen a nivel de integracion.
  - (b) **Ningun test afirma que la comparacion del admin token sea de tiempo constante** — al contrario
    de los triggers, que si tienen un test estructural que exige `timingSafeEqual`
    (`test/trigger-auth.test.ts`). El codigo admin usa `!==` (H-04) sin red que lo detecte.
  - (c) `test/admin-agents-route.test.ts:57-60` prueba el token invalido solo con `'malo'` (longitud muy
    distinta): no cubre un token de la misma longitud ni un prefijo del valido.
  - (d) La rama `Bearer ` vacio de `requireUser` (`require-user.ts:12-14`) no esta cubierta en
    `test/require-user.test.ts`.
  - (e) `test/session-tokens-route.test.ts` no documenta con un test el modelo de auth abierto de
    `/v1/session-tokens` (H-15): que cualquier `x-provider-key` acuña para cualquier agentId existente.
- **Explotabilidad**: indirecta — la ausencia de estos tests deja que regresiones en el corazon de la
  auth (JWT, admin) pasen sin deteccion.
- **Recomendacion**: añadir un `jwt-verifier.test.ts` (con JWKS fake) que cubra exp/alg/iss/sub; un test
  estructural que exija comparacion constante del admin token; casos de token admin de misma
  longitud/prefijo; el caso `Bearer ` vacio; y un test que fije el contrato de emision del session-token.

---

## 4. Lo que SI esta bien (controles verificados)

Revisado y correcto — da confianza de que la base es solida:

- **IDOR cerrado de forma consistente**: el `owner_id` SIEMPRE sale del token verificado
  (`requireUser`), nunca del body/param. `POST /v1/agents` fuerza `ownerId=user.id` e ignora el body
  (`agents.ts:104-105`); igual el configurador (`configurator.ts:184`) y credenciales
  (`credentials.ts:49`). Todos los repos filtran por `id = ? AND owner_id = ?` en SQL parametrizado;
  PATCH/DELETE cargan `getForOwner/...ForOwner` antes de mutar. Cubierto por tests cross-owner
  (user-2 -> 404).
- **Gate de tier premium, server-side y en dos capas**: verificado en las cuatro creaciones premium
  (`scheduled-tasks.ts:100`, `recipes.ts:129`, `triggers.ts:130`, `configurator.ts:98`) y en la
  ejecucion manual (`recipes.ts:251`), SIEMPRE leyendo `profiles.tier` antes de tocar la DB o el modelo.
  El **worker re-gatea** (`apps/worker/src/execution.ts:243-248`) como defensa critica: ningun camino
  (webhook, pg_cron, /run) ejecuta autonomia sin tier. `fail-closed` (`tier !== 'autonomous'`). No se
  hallo via alterna para ejecutar autonomia sin plan.
- **Webhook entrante bien defendido**: publico sin JWT pero autentica CADA POST antes de encolar —
  HMAC en tiempo constante (`timingSafeEqual`) con ventana anti-replay, o url_token comparado en tiempo
  constante; material de auth ausente/descifrado fallido -> `false` (default-deny); el job se encola
  SIEMPRE con `agentId/ownerId/credentialId` de la fila del trigger, nunca de params manipulables; usa
  el rawBody para la firma; `bodyLimit` de 64KB. Confirma el punto F: no da acceso mas alla de encolar
  el job de SU trigger.
- **Session-token bien acotado**: `verifySessionToken` (`session-token.ts:35`) exige `payload.a ===
  agentId` (binding fuerte al agente), tipo string de la key y expiracion; integridad garantizada por el
  auth tag AES-256-GCM; IV aleatorio por cifrado; TTL acotado en dos capas (<=3600s); `SESSION_TOKEN_SECRET`
  separado de `VAULT_SECRET`; errores genericos sin oraculo. El portador solo puede ejecutar el agente
  atado (no escala a otros agentes ni a otros endpoints). En el widget la key nunca llega al navegador:
  `token-manager.ts` hace POST al backend DEL CLIENTE, que es quien llama a `/v1/session-tokens`.
- **JWT correcto en lo esencial**: expiracion aplicada (jose rechaza `exp` vencido por defecto, sin
  `clockTolerance` laxo), issuer validado, `sub` vacio/no-string rechazado (`jwt-verifier.ts:23-25`),
  parsing estricto de `Authorization`, y sin oraculo (`require-user.ts:17-19` responde 401 generico
  "Invalid or expired token" ante cualquier fallo, sin distinguir invalido de expirado).
- **Admin fail-closed en la config**: `ADMIN_API_TOKEN` es `z.string().min(16)` REQUERIDO sin default
  (`env.ts:15`): `parseEnv()` lanza en el arranque si falta o es corto — no hay bypass por token vacio.
  Los guards chequean `typeof token === 'string'` antes de comparar. Planos admin y usuario bien
  separados; ninguna ruta de usuario expone operaciones admin.
- **Credenciales**: no existe ningun endpoint que devuelva la API key; create/list/delete solo manejan
  metadata; la key se cifra (AES-256-GCM/`VAULT_SECRET`) antes de tocar la DB; el match de proveedor
  evita mandar la key de un proveedor al endpoint de otro (`run-agent-by-id.ts:191`, `execution.ts:261`).
- **Fuga de informacion controlada**: mensajes de auth genericos sin enumeracion de usuarios; en
  produccion se enmascaran los mensajes internos de 4xx/5xx (`error-handler.ts:47,57`); redaccion de
  secretos en logs completa (`logger.ts`: `authorization`, `x-admin-token`, `x-provider-key`,
  `x-session-token`, `x-trigger-token`, `apiKey`, y el `?token=` de la URL); el SSE traduce
  `ProviderError` sin filtrar credenciales.
- **Headers de seguridad**: `helmet` global con defaults (HSTS, CSP `script-src 'self'`, etc.); la
  relajacion de CORP a cross-origin y `ACAO:*` esta ENCAPSULADA a `/widget/*` (`server.ts:57-66`), no se
  filtra al resto de la app; CORS sin `credentials: true`.
- **Consola = espejo, defensa real server-side**: `ProtectedRoute`/`RegistrationGate`/`ConsentGate` son
  mirrors puros de enrutado; los gates premium de la UI (`canUseAutonomous`, `isAutonomous`) tienen su
  defensa real server-side confirmada (configurador, triggers, tareas, recetas); el JWT se envia por
  `Authorization` y no es override-able (`api.ts:31-37`); `tier` es server-autoritativo (via `/v1/me`);
  sin secretos hardcodeados (solo la anon key publica de Supabase).
- **Cobertura de tests fuerte donde existe**: `session-token.test.ts` (roundtrip, expirado -> 401, token
  de otro agente -> 401), `trigger-auth.test.ts` (test estructural de tiempo constante),
  `triggers-incoming-route.test.ts` (firma valida/invalida, body alterado, replay fuera de ventana),
  `byok-sentinel.test.ts` (la key/secretos nunca aparecen en logs/SSE/errores), tests IDOR cross-owner,
  gates de tier (`pro`/`null` -> 403), y `cors-wildcard.test.ts` (origen no listado sin ACAO).

---

## 5. Cobertura de la auditoria (honestidad de alcance)

**Revisado a fondo (lectura linea a linea):**

- `apps/backend`: los 19 archivos de `routes/*` (todas las rutas HTTP enumeradas desde `server.ts`),
  `auth/*` (jwt-verifier, require-user, require-admin, session-token), `plugins/security.ts`,
  `errors/*`, `logger.ts`, `config/env.ts`, `crypto/aes-gcm.ts`, `triggers/trigger-auth.ts`,
  `tools/ip-guard.ts`, `tools/webhook-signature.ts`, `execution/index.ts`,
  `providers/openai-compatible/*`, y `migrations/V010` (pg_cron).
- `apps/worker`: `execution.ts` (re-gate de tier, aislamiento de credencial), flujo de `processClaimedJob`.
- `packages/widget`: `token-manager.ts` (flujo del session-token en el cliente).
- `apps/console`: `AuthProvider`, `ProtectedRoute`, gates, `lib/api.ts`, `lib/supabase.ts` (verificado
  que son espejo de UI y que la defensa real es server-side).
- Tests de auth: `require-user`, `session-token`, `trigger-auth`, `admin-agents-route`,
  `registration-route`, `session-tokens-route`, `triggers-*`, `recipes-run-route`, `cors*`, `security`,
  `byok-sentinel`.

**Fuera de alcance / delegado a otras auditorias:**

- **SSRF / egress y comportamiento de las webhook tools a fondo** (H-01, H-02): se identifica la
  superficie desde el angulo de auth (endpoint publico + baseUrl no guardada), pero la explotacion
  completa de las tools y del `signed-tool-fetch` corresponde a la **auditoria 4 (webhooks)**.
- **Anti-replay/idempotencia del webhook entrante** (H-06): analisis profundo en la auditoria 4.
- **RLS de Postgres**: las migraciones incluyen `V002__agents_rls.sql`; NO se audito la efectividad de
  las politicas RLS a nivel de base (defensa complementaria a la de aplicacion). Recomendado para una
  auditoria de datos/DB.
- **Criptografia de la boveda y rotacion de `VAULT_SECRET`**: se verifico el uso correcto de AES-256-GCM;
  el diseno de rotacion/gestion de llaves queda para la auditoria de gestion de secretos.
- **Dependencias (npm audit)**: explicitamente excluido (auditoria de dependencias).
- **Autenticacion de Supabase (OTP, gestion de sesiones, refresh)**: se confia en Supabase como IdP; su
  configuracion (expiracion de refresh tokens, MFA) no se audito aqui.

**Nota sobre falsos negativos**: no se hallo ninguna ruta protegida mal clasificada como publica, ni
bypass del gate de tier, ni IDOR. Estas conclusiones se verificaron leyendo cada handler y cada acceso a
repo; aun asi, la ausencia de RLS-review deja abierta la pregunta de la defensa a nivel DB.
