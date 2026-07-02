# Auditoria de seguridad #4 — El webhook publico y la superficie de ataque entrante

**Fecha:** 2026-07-02
**Alcance:** el UNICO endpoint de la plataforma que acepta peticiones SIN JWT de usuario:
`POST /webhooks/triggers/:triggerId` (Fase 5.4). Autenticacion (HMAC-SHA256 / url_token), anti-replay,
rate limiting, manejo de entrada malformada, DoS / abuso de recursos, prompt injection via el cuerpo
del evento, enumeracion/fuga, y la herencia de identidad del job encolado. Incluye el inventario
completo de rutas publicas de la app y los headers/CORS que devuelve la ruta.
**Tipo:** revision de codigo read-only, adversarial, desde el rol de un atacante EXTERNO sin
credenciales que descubrio la URL del webhook. No se modifico codigo. No se ejecuto NADA contra el
endpoint real (disparar el webhook de produccion contaminaria la cola de jobs): solo analisis estatico.
**Metodo:** lectura del codigo real de la ruta entrante y todo su camino (resolucion del trigger ->
autenticacion -> composicion del payload -> encolado del job -> ejecucion en el worker); simulacion
mental de una peticion maliciosa en cada caso de entrada malformada, rastreando el `rawBody`; barrido
de patrones (`keyGenerator`, `rateLimit`, `trustProxy`, `addContentTypeParser`, `nonce`/`idempotenc`);
lectura de los tests del endpoint. Cada hallazgo esta verificado contra `path:linea` real y sometido a
verificacion adversarial (un panel de sub-agentes que intento REFUTAR cada hallazgo contra el codigo, y
cazadores de completitud con foco en DoS, entrada malformada y fuga de informacion). El nivel de
confianza es explicito en cada hallazgo.

> **Nota de redaccion:** este informe NO transcribe ningun secreto real. Donde aparece un valor
> sensible se referencia por ubicacion y tipo, redactado.

---

## 1. Resumen ejecutivo

**Veredicto: la superficie entrante es DEFENDIBLE contra su amenaza central (bypass de autenticacion y
disparo de ejecuciones ajenas), pero tiene HUECOS DE ABUSO reales — sin severidad critica — en el eje
de DoS / agotamiento de recursos e idempotencia, mas varias inconsistencias de higiene.**

La joya de la corona se sostiene: **no se encontro ninguna via para que un atacante externo sin el
secreto/token dispare la ejecucion de un trigger ajeno, evada la firma HMAC, ni manipule que agente o
credencial se usa.** La verificacion HMAC es correcta (HMAC-SHA256 en tiempo constante, sobre el RAW
body exacto, con chequeo de longitud; firma vacia/malformada rechazada; sin divergencia por doble
parseo), la comparacion del url_token es en tiempo constante, la identidad del job (`owner_id` /
`agent_id` / `credential_id`) sale EXCLUSIVAMENTE del trigger y nunca del cuerpo, y el material de auth
jamas se serializa a HTTP. Un atacante anonimo recibe 401/404 y no consigue disparar nada.

Lo que NO esta cubierto es el abuso *una vez que existe un secreto valido* (poseido o filtrado) y el
*agotamiento de recursos por trafico no autenticado*:

- **No hay ningun limite por trigger, por owner ni por credencial.** El unico freno es el rate-limit
  GLOBAL por IP. Un tenedor de un url_token/secreto valido puede martillar el endpoint y encolar miles
  de jobs que queman la credencial (coste de proveedor) del owner victima y saturan la cola FIFO
  compartida, degradando a otros tenants (H-01, ALTA).
- **El trabajo caro (SELECT + descifrado) corre ANTES de autenticar, sobre un pool DB de 5
  conexiones compartido con las rutas autenticadas.** Un atacante SIN credenciales (basta un UUID con
  formato valido) puede saturar el pool y tumbar toda la app (H-05, MEDIA).
- **No hay proteccion anti-replay real (solo una ventana de frescura de 300s, sin nonce).** Una
  peticion HMAC firmada capturada es reejecutable dentro de la ventana; un url_token capturado es
  replayable sin limite de tiempo (H-02, MEDIA).
- **Sin timeouts de request/conexion** en la unica ruta publica -> slowloris/cuerpos lentos (H-06,
  MEDIA), y **prompt injection acotado** via el cuerpo del evento (H-04, MEDIA).

| Severidad | Cant. | Hallazgos |
| --- | --- | --- |
| CRITICA | 0 | — |
| ALTA | 1 | H-01 sin limite por-trigger/owner: flooding que quema la credencial del owner y satura la cola FIFO multi-tenant |
| MEDIA | 5 | H-02 replay dentro de la ventana (sin nonce) + url_token sin ventana temporal; H-03 rate-limit sin `trustProxy`/`keyGenerator` (DoS colateral tras proxy); H-04 prompt injection via el cuerpo del evento; H-05 trabajo caro pre-auth sobre pool DB de 5 conexiones; H-06 sin timeouts de request/conexion (slowloris) |
| BAJA | 5 | H-07 oraculo 401-vs-404 (existencia/estado-activo de un UUID conocido); H-08 redactor de logs evadible con la clave `token` percent-encoded; H-09 el `notFoundHandler` refleja `?token=` en el cuerpo 404; H-10 `slice()` parte pares surrogate -> jsonb rechaza -> 500 no manejado; H-13 template corrupto -> job con solo el mensaje del atacante (solo via corrupcion DB) |
| INFORMATIVO | 3 | H-11 timestamp futuro aceptado (+300s) y `Number("")===0`; H-12 `requestId` secuencial como canal lateral de volumen; H-14 `JSON.stringify` del contexto fuera del try/catch |

Ninguna de estas debilidades permite, por si sola, disparar un trigger ajeno sin el secreto ni evadir
la autenticacion. El grueso son vectores de DoS/abuso condicionados a poseer o capturar material de
auth, o a la topologia de despliegue, mas higiene de redaccion.

---

## 2. Inventario de rutas publicas (sin JWT de usuario)

Barrido de `apps/backend/src/server.ts` y de cada `routes/*.ts`, distinguiendo el mecanismo de
autorizacion. "Publica" = no exige `requireUser` (JWT de Supabase).

| Ruta | Metodo | Auth | Quema recursos de un owner? | Notas |
| --- | --- | --- | --- | --- |
| `/webhooks/triggers/:triggerId` | POST | HMAC / url_token POR TRIGGER | **Si** (credencial del owner del trigger) | **El objetivo de esta auditoria.** Encola un job que el worker ejecuta con la credencial guardada del owner. |
| `/health` | GET | ninguna | No | Devuelve `{ status: 'ok' }` estatico (`routes/health.ts:4-6`). NO consulta la DB, NO expone version, estado de DB ni internals. **No filtra nada util.** |
| `/widget/*` | GET | ninguna | No | Assets estaticos del widget embebible (JS publico). CORP `cross-origin` + `Access-Control-Allow-Origin: *` SOLO en este contexto encapsulado (`server.ts:57-66`), por diseno (embebido cross-origin). |
| `/v1/session-tokens` | POST | trae-tu-propia key (`x-provider-key`) | No | Intercambia la provider key del integrador por un token efimero (`routes/session-tokens.ts:24-46`). No usa credenciales guardadas del owner; resuelve el agente por id sin owner-scope (fuera de alcance; ver auditoria #1). |
| `/v1/run/:agentId` | POST | `x-session-token` o `x-provider-key` (BYOK); `x-credential-id` SI exige JWT | Solo con JWT (rama `x-credential-id`) | Plano de ejecucion del widget. Las ramas BYOK no tocan credenciales guardadas; la rama de credencial guardada exige `requireUser` (`routes/run-agent-by-id.ts:149-169`). `bodyLimit` propio. |
| `/v1/agent/run` | POST | BYOK (`x-provider-key`) | No | Ejecucion directa con key al momento; no credenciales guardadas. `bodyLimit` propio (`routes/agent.ts:63`). |
| `/v1/admin/organizations/:id/approve`, `/v1/admin/profiles/:id/tier` | POST | `x-admin-token` (super-admin) | No | No es JWT de usuario pero exige el `ADMIN_API_TOKEN` (`routes/registration.ts:32-37`). No publica. |

Todo el resto del CRUD (`/v1/triggers`, `/v1/agents`, `/v1/credentials`, `/v1/scheduled-tasks`,
`/v1/jobs`, `/v1/me`, consentimientos, etc.) exige `requireUser`. **La unica ruta sin auth de ninguna
clase que consume la credencial de un owner es `/webhooks/triggers/:triggerId`** — de ahi que sea la
superficie critica. `/health` y `/widget/*` no operan sobre datos de usuario; `/v1/session-tokens`,
`/v1/run/:agentId` y `/v1/agent/run` son "trae-tu-propia-key" y no gastan credenciales guardadas salvo
la rama con JWT.

---

## 3. Modelo de amenaza (atacante externo)

**Actor:** cualquiera en internet que descubrio la URL `POST /webhooks/triggers/:triggerId`. Dos
subtipos: (a) el anonimo puro, sin secreto ni token; (b) el que POSEE o CAPTURO material de auth valido
(un url_token filtrado por logs/Referer, un secreto HMAC de un integrador comprometido, o una peticion
firmada interceptada).

| Objetivo del atacante | Como lo para el sistema | Resultado |
| --- | --- | --- |
| **Disparar un trigger ajeno sin secreto** | Auth HMAC/url_token en tiempo constante; el trigger se resuelve por `:id` y se exige firma/token valido antes de encolar (`incoming-triggers.ts:180`). | **Parado.** Sin material valido -> 401. (no CRITICA) |
| **Evadir la firma HMAC** (firma vacia, no-hex, `v1=` vacio, doble parseo, header duplicado) | `timingSafeEqual` con chequeo de longitud sobre el digest de 32 bytes; el `rawBody` firmado es el mismo string que se procesa; parser encapsulado. | **Parado** (H-01/F8/F9 confirman defensa correcta). |
| **Manipular que agente/credencial se usa** via el cuerpo | `owner_id`/`agent_id`/`credential_id` salen del trigger, no del body; `maxIterations` sale del template. | **Parado** (F10). |
| **Replay de una peticion firmada capturada** | Solo una ventana de frescura de 300s; sin nonce/idempotencia. | **Parcial.** Reejecutable dentro de la ventana; url_token sin limite temporal (H-02). |
| **Encolar miles de jobs (quemar credencial / saturar cola)** con un secreto valido | Solo el rate-limit GLOBAL por IP; sin limite por-trigger/owner. | **Debil.** Flood viable rotando IP (H-01). |
| **Tumbar la app sin credenciales** (agotar pool DB / sockets) | Trabajo caro (SELECT + descifrado) corre pre-auth sobre un pool de 5 conexiones; sin timeouts de request. | **Debil** (H-05, H-06). |
| **Secuestrar el prompt del agente** via el cuerpo | El cuerpo va como mensaje `user` con delimitador debil, solo truncado a 8000 chars. | **Parcial**, acotado al owner (H-04). |
| **Enumerar triggers validos** | UUIDv4 (~122 bits) hace inviable el barrido; pero 401-vs-404 revela existencia+activo de un UUID ya conocido. | **Practicamente parado**; fuga marginal (H-07). |

---

## 4. Hallazgos

Cada hallazgo: **severidad**, **ubicacion** (`path:linea`), **evidencia**, **explotabilidad** (el
escenario concreto del atacante externo), **impacto** y **recomendacion** (sin arreglar aqui — alimenta
el backlog consolidado).

### H-01 (ALTA) — Sin limite por-trigger/owner: un secreto valido permite quemar la credencial del owner y saturar la cola FIFO multi-tenant

- **Ubicacion:** `apps/backend/src/plugins/security.ts:48-57` (unico rate-limit, global, sin
  `keyGenerator` -> default por IP); `apps/backend/src/config/env.ts:12-13` (defaults `100` / `'1
  minute'`); `apps/backend/src/routes/incoming-triggers.ts:163-205` (toda la ruta autentica y encola
  sin ningun throttle por trigger/owner/credencial); `apps/backend/src/triggers/triggers-repository.ts:241-246`
  (`markTriggered` solo escribe `last_triggered_at = now()`, no cuenta ni limita);
  `packages/shared/src/jobs/jobs-repository.ts:112-126` (`createJob` es un INSERT incondicional, sin
  clave unica ni idempotencia); `apps/worker/src/execution.ts:245-248` y `:257` (el gate por tier es un
  check de plan, no un limitador; luego `resolveCredential` descifra y consume la credencial del owner
  en CADA job).
- **Evidencia:** el unico limitador de la plataforma es `@fastify/rate-limit` registrado global en
  `security.ts:48`. No hay `keyGenerator`, por lo que la libreria keyea por `request.ip`. En toda la
  ruta entrante no existe ningun contador por trigger/owner/credencial. `createJob` inserta una fila
  nueva sin restriccion unica; `markTriggered` solo actualiza un timestamp. Crucial: crear un trigger
  ya exige `tier === 'autonomous'` (`triggers.ts:130-133`), asi que el gate por tier que el worker
  re-aplica al ejecutar (`execution.ts:246`) **siempre pasa para el owner del trigger** — no frena el
  flood, solo confirma el plan. Cada job encolado llega a `resolveCredential` (`execution.ts:257`) y
  ejecuta el agente con la API key guardada del owner. La cola es FIFO compartida (`claimNextJob`
  ordena por `created_at`), asi que un flood de un trigger retrasa jobs de OTROS owners.
- **Explotabilidad:** atacante que POSEE o filtro un url_token/secreto HMAC valido. El url_token viaja
  en la query string (`incoming-triggers.ts:73-74`), propenso a fuga por logs/Referer/proxies. Con ese
  material, POSTea en bucle a `/webhooks/triggers/:triggerId`; cada peticion autentica y encola un job
  que el worker ejecuta. El rate-limit global por IP (100/min) frena UNA fuente a ~6.000/hora, pero es
  por IP y global (no por trigger): rotando IPs el flood es practicamente ilimitado, y ni siquiera
  aisla el abuso al trigger atacado.
- **Impacto:** agotamiento economico (quema de tokens/coste del proveedor del owner victima),
  ejecuciones no deseadas del agente con sus tools/efectos secundarios, y **DoS multi-tenant** por
  saturacion de la cola FIFO (degrada a owners no relacionados). No es bypass de auth (requiere secreto
  valido), por eso ALTA y no CRITICA.
- **Recomendacion:** limite POR TRIGGER y/o POR OWNER (token bucket con `keyGenerator` por
  `trigger.id`/`owner_id`, o una cuota de jobs pendientes por owner antes de encolar), ademas de una
  clave de idempotencia opcional. Considerar un tope de profundidad de cola por owner.
- **Confianza:** ALTA (verificado en cada cita; el propio `docs/auditorias/01-...md:244` ya reconoce
  "sin throttle por-trigger ni por-owner").

### H-02 (MEDIA) — Anti-replay solo por ventana de frescura: replay dentro de 300s (HMAC) y sin limite temporal (url_token)

- **Ubicacion:** `apps/backend/src/tools/webhook-signature.ts:17` (unica barrera:
  `Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds`, `tol=300`); firma sobre
  `"{timestamp}.{body}"` SIN nonce (`webhook-signature.ts:5`, `trigger-auth.ts:104-110`);
  `incoming-triggers.ts:196-202` (`createJob` + `markTriggered` sin dedup);
  `jobs-repository.ts:112-126` (INSERT plano, sin clave unica). Para url_token: `trigger-auth.ts:70-73`
  (comparacion de hash sin ningun componente temporal).
- **Evidencia:** el barrido `nonce|idempotenc|jti|dedup|replay` no revela ningun store de
  deduplicacion. La firma HMAC cubre solo `"{timestamp}.{body}"`, sin componente unico. Por tanto una
  peticion firmada valida, reenviada dentro de los 300s, encola un job nuevo en cada replay. El
  comentario "ventana anti-replay" (p.ej. `trigger-auth.ts:84`) **sobrevende**: es una ventana de
  frescura, no anti-replay real. El modo url_token es un bearer estatico: no tiene ni siquiera ventana,
  asi que un token capturado es replayable sin limite de tiempo hasta rotarlo.
- **Explotabilidad:** atacante SIN el secreto que captura UNA peticion firmada valida (interceptacion
  TLS, proxy corporativo, o una traza/log filtrada) puede reenviarla tal cual durante <=300s; cada
  reenvio pasa la verificacion (timestamp aun fresco, firma valida sobre el mismo body) y encola un job
  duplicado. Con un url_token capturado, sin limite temporal. Acotado por el rate-limit global por IP
  (mitigable rotando IP).
- **Impacto:** ejecuciones DUPLICADAS del agente (amplificacion de coste, efectos secundarios de tools
  repetidos) con el MISMO payload capturado. No permite elegir contenido nuevo; no aporta capacidad a
  quien ya posee el secreto (ese ya puede forjar peticiones frescas).
- **Recomendacion:** clave de idempotencia (p.ej. un `jti`/nonce firmado registrado con TTL = ventana),
  o una restriccion unica sobre `(trigger_id, signature)` durante la ventana. Documentar el url_token
  como bearer estatico (rotacion como unica mitigacion ante fuga).
- **Confianza:** ALTA en la mecanica; el propio repo la clasifica como H-06 MEDIA en la auditoria #1.

### H-03 (MEDIA) — Rate-limit sin `trustProxy` ni `keyGenerator`: tras un proxy, un solo bucket compartido = DoS colateral de toda la app

- **Ubicacion:** `apps/backend/src/server.ts:35-42` (`Fastify({ logger })`, sin `trustProxy`);
  `apps/backend/src/plugins/security.ts:48-57` (`rateLimit` sin `keyGenerator`);
  `apps/backend/src/config/env.ts:25-30` (`PUBLIC_BASE_URL` opcional, con comentario "detras de un
  proxy/CDN"); `apps/backend/src/routes/consents.ts:79` (comentario "request.ip ... respeta trustProxy
  si esta configurado" -> confirma que NO lo esta).
- **Evidencia:** el grep global halla un solo `Fastify()`, un solo `register(rateLimit)`, cero
  `keyGenerator` y cero `trustProxy`. Sin `trustProxy`, `request.ip` es la IP del socket (el proxy/LB),
  no la del cliente. Como el rate-limit es GLOBAL y por IP, si todo el trafico entra por una IP de
  proxy comparte UN solo bucket.
- **Explotabilidad:** condicional a la topologia (inferida por `PUBLIC_BASE_URL`, no confirmada en el
  repo). Si el backend corre detras de un proxy/LB que presenta una IP unica, un atacante externo NO
  autenticado envia ~`RATE_LIMIT_MAX` peticiones por ventana desde una sola maquina y agota el bucket
  compartido; el resto de clientes de TODA la plataforma recibe 429 (DoS colateral). Sin `trustProxy`
  el atacante NO puede spoofear `X-Forwarded-For` para evadir el limite (Fastify lo ignora): el riesgo
  es el bucket compartido, no la evasion.
- **Impacto:** disponibilidad (429 a terceros). Auto-capado al propio rate-limit; con un CDN de pool
  grande de IPs el efecto se diluye (buckets frescos) en vez de colapsar.
- **Recomendacion:** configurar `trustProxy` acorde al despliegue y un `keyGenerator` que use la IP real
  del cliente; idealmente un limite dedicado para la ruta publica separado del cupo de las rutas
  autenticadas.
- **Confianza:** ALTA en el codigo (ausencia de `trustProxy`/`keyGenerator`); MEDIA en el impacto
  (depende del despliegue).

### H-04 (MEDIA) — Prompt injection via el cuerpo del evento (acotado al owner)

- **Ubicacion:** `apps/backend/src/routes/incoming-triggers.ts:62-63` (`messages.push` de un mensaje
  `{ role: 'user', content: "Evento entrante:\n" + context }`); truncado unico a
  `MAX_EVENT_CONTEXT_CHARS = 8_000` (`:24`, aplicado en `:44-46`); `eventContext` `:33-47` (JSON.parse
  -> JSON.stringify compacto, sin sanitizar el contenido). El worker solo valida `role`/`content`
  (`execution.ts:143-156`).
- **Evidencia:** el cuerpo no confiable se anexa como mensaje `user` con un delimitador de texto plano
  debil ("Evento entrante:\n"), sin framing/escape que separe lo confiable de lo no confiable; el unico
  limite es el truncado a 8.000 chars. No hay sanitizacion contra prompt injection en toda la ruta
  (verificado en `eventContext`, `buildJobPayload` y el parseo del worker). Matiz: NO es "verbatim" —
  el cuerpo se normaliza por `JSON.parse` + `JSON.stringify` y un cuerpo no-JSON/vacio se descarta
  (`:35`, `:39-42`); pero el atacante controla los VALORES string, donde caben instrucciones en
  lenguaje natural.
- **Explotabilidad:** un upstream legitimamente confiado con el secreto del webhook (el servicio que el
  owner configuro, o el propio owner) se ve comprometido y, en vez de datos del evento, envia un JSON
  cuyos valores string contienen instrucciones ("ignora lo anterior y ..."). Tras autenticar, esas
  instrucciones llegan al agente del owner, ejecutado por el worker con las credenciales del owner y sus
  tools nativas.
- **Impacto:** secuestro del comportamiento del agente (gasto de tokens, uso indebido de tools, posible
  exfiltracion de datos accesibles al agente). Confinado a los recursos del PROPIO owner (sin escalada
  cross-tenant): la identidad del job sale del trigger. Requiere secreto/token valido (un externo
  anonimo recibe 401).
- **Recomendacion:** framing mas robusto del contexto no confiable (delimitadores no falsificables /
  estructura clara "datos no confiables"), instruccion de sistema que trate el bloque como datos y no
  como ordenes, y considerar exponer el evento como campo estructurado en vez de texto concatenado al
  prompt.
- **Confianza:** ALTA en el mecanismo; es una limitacion inherente a alimentar datos externos a un LLM.

### H-05 (MEDIA) — Trabajo caro pre-auth (SELECT + descifrado AES-GCM) sobre un pool DB de 5 conexiones compartido

- **Ubicacion:** `apps/backend/src/routes/incoming-triggers.ts:172` (`getByIdForDispatch` ANTES de
  `authenticate` en `:180`); `apps/backend/src/triggers/trigger-auth.ts:96-100` (`decryptFromToken`
  ANTES de que `verifyIncomingHmac` valide la presencia de las cabeceras en `:97`);
  `apps/backend/src/db/client.ts:11` (`postgres(..., { max: 5 })`, singleton compartido por TODA la
  app).
- **Evidencia:** el handler ejecuta un SELECT (`getByIdForDispatch`) antes de autenticar — necesario,
  porque hace falta el trigger para conocer su secreto. Para triggers `hmac`, `authenticate` DESCIFRA
  el secreto (`trigger-auth.ts:96`) antes de que `verifyIncomingHmac` compruebe siquiera la presencia
  de las cabeceras de firma (`:97`): una peticion SIN ninguna cabecera igual paga un SELECT + un
  descifrado AES-GCM. Ese SELECT compite por las mismas 5 conexiones del pool singleton
  (`db/client.ts:11`) que usan las rutas AUTENTICADAS.
- **Explotabilidad:** atacante externo SIN credenciales (basta un UUID con formato valido, que ademas
  no revela nada — 404) inunda `POST /webhooks/triggers/:triggerId`; cada peticion consume una conexion
  del pool para el `getByIdForDispatch` pre-auth. Bajo suficiente concurrencia (facilitada por la
  ausencia de `trustProxy`, H-03, o un ataque distribuido) el pool de 5 se satura y las rutas legitimas
  (`/v1/agents`, `/v1/run`, ...) se quedan sin conexiones.
- **Impacto:** DoS de TODA la app, amplificado (peticion barata -> query DB + descifrado costoso)
  ejecutado ANTES de autenticar y disparable desde la ruta publica sin secreto.
- **Recomendacion:** comprobar la presencia/forma de las cabeceras de firma ANTES de descifrar (fail
  cheap); dimensionar/separar el pool para el trafico no autenticado; cachear negativamente los
  `:id` inexistentes; aplicar el limite dedicado de la ruta publica (H-03) para acotar la concurrencia
  pre-auth.
- **Confianza:** MEDIA (el pool de 5 y el orden pre-auth estan verificados; el umbral exacto de
  saturacion depende del entorno).

### H-06 (MEDIA) — Sin timeouts de request/conexion en la unica ruta publica: slowloris / cuerpos lentos

- **Ubicacion:** `apps/backend/src/server.ts:35` (`Fastify({ logger })` sin
  `requestTimeout`/`connectionTimeout`/`keepAliveTimeout`); `apps/backend/src/routes/incoming-triggers.ts:153-161`
  (parsers `parseAs:'string'` que bufferizan el cuerpo ANTES del handler);
  `apps/backend/src/plugins/security.ts:48-57` (rate-limit en `onRequest`, cuenta peticiones completas,
  no vigila la velocidad del cuerpo).
- **Evidencia:** `buildServer` no fija ninguna opcion de timeout de Fastify; el grep no halla
  `requestTimeout`/`connectionTimeout`/`keepAliveTimeout`. Fastify v5 deja `requestTimeout` y
  `connectionTimeout` en 0 (desactivados). Los parsers con `parseAs:'string'` (`:153-161`) leen el
  cuerpo del socket ANTES de resolver el trigger o autenticar; el rate-limit ya conto la peticion en
  `onRequest` y no interviene en cuerpos lentos.
- **Explotabilidad:** atacante SIN credenciales ni triggerId valido (el cuerpo se bufferiza antes de la
  auth) abre N conexiones a `POST /webhooks/triggers/<uuid-cualquiera>`, manda las cabeceras y dribbla
  el cuerpo a 1 byte cada varios segundos. Acumulando conexiones se agotan sockets/descriptores.
- **Impacto:** degradacion de disponibilidad de toda la app. **Backstop parcial:** Node 20 (ver
  `.nvmrc`) aplica un `http.Server.requestTimeout` por defecto de ~300s y `headersTimeout` ~60s, que
  obligan a reciclar conexiones periodicamente pero no impiden el agotamiento sostenido.
- **Recomendacion:** fijar `requestTimeout`/`connectionTimeout`/`keepAliveTimeout` explicitos en el
  constructor de Fastify (especialmente estrictos para la ruta publica) y un tope de conexiones
  concurrentes en el proxy.
- **Confianza:** ALTA en la ausencia de timeouts; MEDIA en el impacto (mitigado por el backstop de Node).

### H-07 (BAJA) — Oraculo 401-vs-404: un 401 confirma que el trigger existe y esta activo

- **Ubicacion:** `apps/backend/src/routes/incoming-triggers.ts:167-170` (uuid malformado -> 404 sin
  DB); `:172-176` (inexistente O inactivo -> 404, tras el SELECT); `:180-182` (401 SOLO se alcanza tras
  pasar el gate de existencia+activo); `apps/backend/src/triggers/trigger-auth.ts:85-111`
  (`authenticate` devuelve `false` sin lanzar si falta/falla el secreto -> 401 alcanzable SIN secreto).
- **Evidencia:** el 404 se emite en tres puntos (uuid malformado, trigger `null`, trigger inactivo)
  ANTES de `authenticate()`. Por tanto un 401 implica necesariamente **trigger existente Y activo**, y
  es alcanzable por un atacante sin secreto (una firma ausente/invalida -> `authenticate` devuelve
  `false` -> 401). Esto contradice el comentario "404 generico que no revela existencia"
  (`:118-119`, `:173`): la uniformidad solo se cumple ENTRE los casos 404, no frente al 401.
- **Explotabilidad:** atacante que YA conoce (o sospecha) un triggerId valido envia un POST con
  firma/token ausente: un 401 revela "existe y activo", un 404 revela "inexistente/borrado/desactivado".
  **NO permite descubrir IDs:** `z.string().uuid()` (`:26`, ~122 bits) hace inviable la enumeracion por
  barrido. El angulo de timing no aporta: un trigger inactivo tambien da "404 con DB" (`:174`), identico
  al inexistente; el unico discriminante practico es el status code.
- **Impacto:** fuga de informacion marginal (activo vs no) condicionada a conocimiento previo del UUID.
  Sin impacto en autenticacion, sin disparo ajeno, sin DoS.
- **Recomendacion:** responder de forma uniforme (mismo status y coste) para inexistente/inactivo/
  activo-sin-auth — p.ej. 404 tambien cuando la auth falla, o 401 uniforme para cualquier `:id` con
  formato valido — como defensa en profundidad.
- **Confianza:** ALTA en el mecanismo; severidad BAJA por la inviabilidad de enumerar UUIDs.

### H-08 (BAJA) — El redactor de logs se evade con la clave `token` percent-encoded: url_token en claro en los logs

- **Ubicacion:** `apps/backend/src/logger.ts:40` (`if (!query.includes('token=')) return url;`, sobre
  `request.url` CRUDO); serializer en `logger.ts:65`; parser del token en
  `apps/backend/src/routes/incoming-triggers.ts:72-76`.
- **Evidencia:** `sanitizeLoggedUrl` hace un chequeo de substring literal sobre la URL sin decodificar:
  `'...%74oken=SECRET'.includes('token=')` es `false`. En cambio `extractUrlToken` lee
  `request.query.token` (`:73-74`), y Fastify DECODIFICA la clave de la query — verificado en este
  entorno: `querystring.parse('%74oken=SECRET')` -> `{ token: 'SECRET' }`. El serializer de pino
  loguea `sanitizeLoggedUrl(request.url)` (`logger.ts:65`) en la linea "incoming request" que Fastify
  emite por defecto (LOG_LEVEL default `'info'`, sin `disableRequestLogging`).
- **Explotabilidad:** una peticion `POST /webhooks/triggers/<id>?%74oken=<url_token>` (o cualquier
  grafia percent-encoded de la clave: `t%6fken`, `tok%65n`, ...) autentica correctamente pero se loguea
  con el token en CLARO, anulando la garantia declarada "jamas en logs". Quien tenga acceso a logs
  (SaaS de logs, SIEM, ops, brecha del almacen) obtiene un token de webhook vivo.
- **Impacto:** fuga de una credencial de webhook a los logs. **Caveat honesto:** un cliente legitimo
  envia `?token=` plano (que SI se redacta), asi que los tokens que aterrizan por esta via son los de
  un emisor naive/mal configurado o de un atacante logueando su propio token; el impacto directo entre
  tenants es limitado, pero es una evasion real y trivial de un control que por tanto NO puede
  considerarse fiable.
- **Recomendacion:** redactar sobre la query ya parseada/decodificada (comparar la CLAVE, no un
  substring de la URL cruda), o normalizar/decodificar antes del chequeo.
- **Confianza:** ALTA (bypass verificado por ejecucion del decodificador de query).

### H-09 (BAJA) — El `notFoundHandler` refleja `req.url` crudo (incluyendo `?token=`) en el cuerpo 404

- **Ubicacion:** `apps/backend/src/errors/error-handler.ts:6-11` (el `message` interpola
  `"Route " + req.method + " " + req.url + " not found"`, sin sanitizar, sin `Cache-Control`).
- **Evidencia:** a diferencia del logger (que enruta la URL por `sanitizeLoggedUrl`), el
  `notFoundHandler` interpola `req.url` verbatim, incluyendo `?token=<url_token>`. La respuesta no fija
  `Cache-Control`.
- **Explotabilidad:** para un trigger url_token, cualquier peticion que no matchee ruta/metodo con el
  token en la query hace eco del secreto: p.ej. un `GET https://api/webhooks/triggers/<id>?token=SECRET`
  (la ruta es POST-only -> 404) responde un JSON con el token en claro. Ese cuerpo (sin `Cache-Control`)
  puede quedar cacheado por CDN/proxies o capturado por APM.
- **Impacto:** reexposicion del url_token que la redaccion de logs intentaba proteger. El receptor
  directo es el propio emisor (que ya posee el token), por lo que el impacto entre tenants es limitado;
  el hallazgo es la inconsistencia que socava el control de redaccion (y el riesgo de cacheo).
- **Recomendacion:** no reflejar la query string en el cuerpo 404 (mensaje generico o solo el path
  sanitizado); fijar `Cache-Control: no-store` en las respuestas de error de rutas con secretos en la
  URL.
- **Confianza:** ALTA.

### H-10 (BAJA) — `slice()` de `eventContext` parte pares surrogate UTF-16 -> jsonb rechaza el INSERT -> 500 no manejado

- **Ubicacion:** `apps/backend/src/routes/incoming-triggers.ts:44-46` (`serialized.slice(0, 8000)`);
  crash en `:196` (`createJob`) via `packages/shared/src/jobs/jobs-repository.ts:119` (`sql.json`);
  columna `jobs.payload jsonb not null` (`apps/backend/migrations/V008__jobs.sql`).
- **Evidencia:** `eventContext` corta el JSON re-serializado con `slice(0, 8000)` por code units
  UTF-16, asi que puede partir EN MEDIO de un par surrogate (un emoji / caracter no-BMP en el limite),
  dejando la cadena terminada en un surrogate SUELTO. Ese `content` va a `payload.messages` y luego a
  `createJob` -> `sql.json(...)` (`jobs-repository.ts:119`), que serializa con `JSON.stringify`: el
  "well-formed stringify" de Node convierte el surrogate suelto en el escape `\udXXX`. `jsonb` RECHAZA
  escapes de surrogate incompletos. `createJob` lanza; el handler NO tiene try/catch (`:196`), asi que
  `error-handler.ts:53-60` responde 500 `INTERNAL_ERROR` (con `error.message` de Postgres si
  `NODE_ENV != production`).
- **Explotabilidad:** atacante que posee un secreto/token valido envia un cuerpo JSON valido cuya forma
  re-serializada supere 8.000 chars y donde un caracter no-BMP quede alineado exactamente en el corte
  (rellenando con padding). Resultado: 500 en vez de 202; el job NO se encola, `markTriggered` NO
  corre (evento perdido en silencio), y en no-produccion se filtra el texto del error de Postgres.
  Tambien puede dispararse accidentalmente por un integrador legitimo con contenido emoji/CJK cerca del
  limite.
- **Impacto:** denegacion puntual + evento perdido silencioso + fuga del mensaje de error de la DB en
  entornos no productivos.
- **Recomendacion:** truncar de forma segura respecto a surrogates (no cortar pares; usar
  `Array.from`/segmentacion por code points o recortar un code unit si el ultimo es un surrogate alto
  suelto) y envolver la composicion/encolado en try/catch que degrade a 4xx controlado.
- **Confianza:** MEDIA (verificado por razonamiento sobre el comportamiento de `jsonb`; no ejecutado —
  auditoria read-only).

### H-13 (BAJA) — Template corrupto (messages no-array) + cuerpo JSON valido -> job con solo el mensaje del atacante

- **Ubicacion:** `apps/backend/src/routes/incoming-triggers.ts:57-64` (`messages = Array.isArray(...)
  ? [...] : []`, luego `push` del evento); `:189-192` (fail-fast solo si `messages.length === 0`);
  `apps/backend/src/routes/triggers.ts:31-37` (`PayloadTemplateSchema` `messages.min(1)` al crear);
  `triggers-repository.ts:198-211` (`updateForOwner` NO escribe `payload_template`); default
  `payload_template jsonb not null default '{}'` (`migrations/V012__triggers.sql:52`).
- **Evidencia:** si `base.messages` no es array, `messages` queda `[]`; con un cuerpo JSON valido se
  hace `push` de UN mensaje, de modo que el fail-fast de `:189` no dispara y se encola un job cuyo unico
  mensaje es el contexto del atacante (con el prefijo fijo "Evento entrante:\n", truncado a 8000). NO
  es alcanzable via la API: `PayloadTemplateSchema` exige `messages.min(1)` al crear, el PATCH no edita
  el payload y `updateForOwner` ni siquiera toca `payload_template`; solo una escritura DIRECTA a la DB
  (o el default `{}` por un INSERT manual) puede dejar `messages` no-array.
- **Explotabilidad:** requiere DOS precondiciones ajenas al atacante HTTP: (a) corrupcion de datos a
  nivel DB, y (b) un secreto/token valido. Quien pueda escribir la DB ya tiene capacidades muy
  superiores; y un atacante autenticado ya inyecta su contexto como mensaje `user` en el flujo normal
  (H-04), asi que este bug solo SUPRIME los mensajes base de la plantilla, sin capacidad nueva.
- **Impacto:** incremental practicamente nulo sobre H-04. Confirma que el hallazgo LOW de la revision
  5.4a (payload_template corrupto) quedo bien acotado: el fail-fast cubre el caso `length === 0`; el
  caso "solo evento" es benigno (job valido para el worker) y solo alcanzable por corrupcion.
- **Recomendacion:** validar el shape del `payload_template` tambien en el camino de dispatch (no solo
  en creacion), o exigir que al menos un mensaje provenga SIEMPRE del template.
- **Confianza:** ALTA en la mecanica; severidad BAJA/informativa por la precondicion de corrupcion DB.

### H-11 (INFORMATIVO) — Timestamp futuro aceptado hasta +300s; `Number("")===0` pasa la validacion de forma

- **Ubicacion:** `apps/backend/src/tools/webhook-signature.ts:17` (ventana simetrica con `Math.abs`);
  `apps/backend/src/triggers/trigger-auth.ts:100-101` (`Number(timestampHeader)` + `Number.isFinite`).
- **Evidencia:** el chequeo `Math.abs(now - ts) > tol` es simetrico, luego un timestamp futuro dentro
  de +300s pasa (ventana total real de 600s). `Number("")` es `0` y `Number.isFinite(0)` es `true`, asi
  que un header de timestamp vacio supera la validacion de forma y se trata como `0` — pero la ventana
  lo rechaza igual (`abs(now-0)` ~1.75e9 > 300).
- **Explotabilidad:** NO explotable sin el secreto: ambos casos ocurren DENTRO de `verifyWebhookSignature`,
  que exige una firma HMAC valida. Quien posee el secreto ya puede forjar cualquier timestamp; ampliar
  la ventana futura no le concede nada nuevo. `nowSeconds` sale del reloj del server (`:180`), no
  manipulable.
- **Impacto:** nulo (endurecimiento). La aceptacion de deriva futura es una tolerancia de reloj
  razonable; conviene documentar que la ventana efectiva es de 600s.
- **Recomendacion:** opcional — rechazar timestamps con `>` unos pocos segundos en el futuro si el
  ecosistema no lo necesita, y validar la forma del timestamp (rechazar cadena vacia explicitamente).
- **Confianza:** ALTA.

### H-12 (INFORMATIVO) — `requestId` secuencial expuesto en los cuerpos de error de la ruta publica: canal lateral de volumen

- **Ubicacion:** `apps/backend/src/errors/error-handler.ts:9,19,33,48,58` (`requestId: req.id`);
  `server.ts:35-42` (sin `genReqId` ni `requestIdHeader` -> default de Fastify v5).
- **Evidencia:** ambos handlers incluyen `requestId: req.id` en el body. Sin `genReqId` custom, Fastify
  v5 usa un contador por-proceso monotonico (`req-<N>` en base36). Ese id viaja en las respuestas
  401/404/500 de `POST /webhooks/triggers/:triggerId` sin JWT.
- **Explotabilidad:** un atacante no autenticado que golpea la ruta publica lee `requestId=req-<N>`;
  muestreando dos peticiones en el tiempo deduce cuantas proceso TODO el servidor entre ambas — un
  canal lateral de volumen de trafico (inteligencia de negocio) y ayuda a correlacionar.
- **Impacto:** bajo/informativo; no expone datos de usuario.
- **Recomendacion:** usar un `genReqId` no adivinable (UUID/random) si se quiere cerrar el canal.
- **Confianza:** MEDIA.

### H-14 (INFORMATIVO) — `JSON.stringify` del contexto fuera del try/catch que protege `JSON.parse`

- **Ubicacion:** `apps/backend/src/routes/incoming-triggers.ts:37-43` (`JSON.parse` dentro del try
  `:37-41`; `JSON.stringify(parsed)` en `:43`, FUERA).
- **Evidencia:** `JSON.parse` esta envuelto en try/catch (fallo -> `undefined`), pero
  `JSON.stringify(parsed)` (`:43`) queda fuera. Si un cuerpo con anidamiento muy profundo (dentro de
  64KB) fuera aceptado por `parse` pero no serializable por `stringify` (asimetria parse/stringify por
  limite de pila), se lanzaria un `RangeError` no capturado -> 500. La misma linea de defensa vale para
  H-10 (la ruta post-parse no esta protegida).
- **Explotabilidad:** condicional a que exista tal asimetria en el runtime desplegado (no confirmado —
  V8 moderno tiende a implementaciones iterativas). Requiere ademas secreto valido.
- **Impacto:** un 500 puntual, no manejado, en el peor caso.
- **Recomendacion:** envolver la serializacion/composicion del contexto (y el encolado) en try/catch,
  degradando a una respuesta controlada.
- **Confianza:** BAJA (estructural real, explotacion no confirmada).

---

## 5. Lo que SI esta bien defendido

Verificado contra el codigo real y confirmado por el panel adversarial (que intento y NO logro
refutar estas propiedades):

- **Verificacion HMAC correcta y sin bypass** (`webhook-signature.ts:17-21`, `trigger-auth.ts:95-111`):
  HMAC-SHA256 en tiempo constante (`timingSafeEqual`) con chequeo de longitud PREVIO (el `&&` de la
  `:21` garantiza que nunca se compara con longitudes distintas). Una firma vacia, no-hex, o `v1=` sin
  hex produce un buffer corto -> `length mismatch` -> `false`. Alcanzar 32 bytes exige 64 hex validos
  que deben coincidir byte a byte con el digest real: sin el secreto no hay colision. Headers de firma
  duplicados no dan bypass (el timestamp duplicado -> `Number("t1, t2")=NaN` -> `false`).
- **La firma es sobre el RAW body exacto, sin divergencia por doble parseo** (`incoming-triggers.ts:178`
  captura el `rawBody` UNA vez; `:180` autentica y `:184` compone el payload sobre el MISMO string). El
  `JSON.parse` de `eventContext` es solo para el contexto del prompt, nunca para auth ni para la
  identidad. El content-type parser (`parseAs:'string'`, `:153-161`) esta ENCAPSULADO (registro sin
  `fastify-plugin` en `server.ts:80`): las demas rutas conservan su parseo JSON (probado en el test de
  la ruta hermana `/sibling`). Cualquier content-type se captura crudo (`application/json` override +
  catch-all `*`).
- **Tamano del cuerpo acotado** (`bodyLimit: 65_536` en ambos parsers, `:158`/`:161`): un cuerpo
  >64KB da 413 ANTES del handler; el `rawBody` se materializa como string acotado, sin tope infinito.
- **La identidad del job NO es manipulable por el atacante** (`incoming-triggers.ts:196-201`):
  `owner_id`/`agent_id`/`credential_id` salen del trigger resuelto por `:id`; `maxIterations` sale del
  template (`buildJobPayload:67`), no del body. No hay via (ni prototype-pollution) para redirigir a
  otro agente/credencial ni inflar iteraciones. El worker toma la identidad de las COLUMNAS de la fila
  `jobs`, no del payload (`execution.ts:245,257`).
- **Comparacion del url_token en tiempo constante** (`trigger-auth.ts:58-73`): `hash(presentado)` vs
  hash guardado con `timingSafeEqual`; token ausente/vacio -> hash de `''` -> `false`, sin ramas
  early-return que distingan "ausente" de "incorrecto".
- **El material de auth nunca se serializa a HTTP** (`triggers-repository.ts`: `getByIdForDispatch` es
  la unica lectura que trae el secreto/hash, exclusivamente server-side; el CRUD y los `RETURNING`
  usan columnas de metadata explicitas). RLS solo expone SELECT (`V012`).
- **404 generico** para `:id` malformado (sin tocar la DB, `:167-170`), inexistente e inactivo — con la
  salvedad del 401-vs-404 de H-07.
- **Defensa en profundidad del worker**: re-gatea por tier al ejecutar (`execution.ts:245-248`) — aunque
  no frena el flood (H-01), corta jobs de owners que perdieron el plan.
- **Redaccion del url_token para la forma canonica** (`logger.ts:34-45`, header `x-trigger-token` en
  `loggerRedaction`): funciona para `?token=` plano; la brecha es la variante percent-encoded (H-08).

---

## 6. Cobertura y alcance

**Archivos leidos:** `routes/incoming-triggers.ts`, `triggers/trigger-auth.ts`,
`tools/webhook-signature.ts`, `triggers/triggers-repository.ts`, `routes/triggers.ts`,
`plugins/security.ts`, `server.ts`, `config/env.ts`, `errors/error-handler.ts`, `logger.ts`,
`routes/health.ts`, `routes/registration.ts`, `routes/session-tokens.ts`, `routes/run-agent-by-id.ts`,
`db/client.ts`, `packages/shared/src/jobs/jobs-repository.ts`, `apps/worker/src/execution.ts`,
`migrations/V012__triggers.sql`, y los tests `test/triggers-incoming-route.test.ts` y
`test/trigger-auth.test.ts`.

**Cobertura de los tests del endpoint entrante** (`triggers-incoming-route.test.ts`,
`trigger-auth.test.ts`):

- *Cubierto:* firma valida -> 202 + encolado; firma invalida -> 401; body alterado tras firmar -> 401;
  replay por timestamp FUERA de la ventana -> 401; faltan headers -> 401; token correcto (query y
  header) -> 202; token incorrecto/ausente -> 401; content-type no-json (octet-stream) sigue dando raw
  -> 202; trigger inactivo/inexistente -> 404; `:id` no-uuid -> 404 sin tocar la DB; cuerpo
  vacio/no-JSON -> solo template; template sin mensajes -> 500 fail-fast; encapsulacion del raw parser;
  aceptacion de `v1=`; headers duplicados (array) -> false.
- *NO cubierto (huecos de test que este informe destaca):* flooding / ausencia de limite por-trigger
  (H-01); replay DENTRO de la ventana / falta de nonce (H-02); comportamiento del rate-limit tras proxy
  (H-03); prompt injection del cuerpo (H-04); saturacion del pool DB pre-auth (H-05); slowloris/
  timeouts (H-06); distincion 401-vs-404 como oraculo (H-07); redaccion con clave percent-encoded
  (H-08); reflejo del `?token=` en el 404 (H-09); body con surrogates en el limite del truncado (H-10);
  timestamp futuro / vacio (H-11); rechazo real de un body >64KB con 413.

**Limites de la auditoria:** read-only y estatica. NO se ejecuto nada contra el endpoint real (disparar
el webhook de produccion contaminaria la cola). Los hallazgos dependientes del runtime/DB (H-05 umbral
de saturacion, H-06 backstop de Node, H-10 rechazo de `jsonb`, H-14 asimetria parse/stringify) estan
razonados contra el comportamiento documentado de las librerias y marcados con su confianza; convendria
confirmarlos con una prueba controlada en staging. La topologia de red (H-03) no consta en el repo y se
infiere de `PUBLIC_BASE_URL`. No se corrio `npm audit` (dependencias quedan para otra auditoria).

**Criterio de exito:** cumplido. Se produjo el modelo de amenaza de la superficie entrante y se
verificaron, contra codigo real, las vias de abuso (flooding que quema credenciales, replay, DoS de
recursos pre-auth y por falta de timeouts, DoS colateral del rate-limit, prompt injection, fugas de
higiene) y se confirmo — con verificacion adversarial — que **la propiedad central (no disparar
ejecuciones ajenas ni evadir la autenticacion sin el secreto) se sostiene**. La superficie entrante es
**defendible con mitigaciones pendientes**: sin hallazgos criticos, un hallazgo ALTA de abuso de
recursos y cinco MEDIA que conviene cerrar antes de exponer el endpoint a alto volumen.
