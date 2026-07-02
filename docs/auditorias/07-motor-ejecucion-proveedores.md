# Auditoria #7 de 12 -- El motor de ejecucion y la resiliencia ante proveedores de IA

- **Alcance**: el MOTOR DE EJECUCION de agentes y su tolerancia a proveedores externos que se portan
  mal. `apps/backend/src/agent/` (loop agentico `run-agent.ts`, `limits.ts`), `apps/backend/src/execution/`
  (`assemble-agent-run.ts`), la capa de proveedor `apps/backend/src/providers/`
  (anthropic / openai / openai-compatible + `errors.ts`), el transporte HTTP/SSE
  (`routes/run-agent-by-id.ts`, `routes/sse-runner.ts`), las tools (`tools/*`) y el camino worker
  (`apps/worker/src/execution.ts`: `runAgentWithDeadline`, `handleFailure`, recetas). Modelo BYOK:
  cada cliente trae su modelo/key/baseUrl, asi que el motor debe tolerar TODA la variedad de
  comportamientos de proveedor.
- **Tipo**: auditoria adversarial de integraciones externas, **SOLO LECTURA**. No se modifico codigo,
  tests ni configuracion. No se ejecutaron runs reales contra proveedores ni produccion.
- **Commit auditado**: `f2ad95b` (rama `audit/07-motor`, base `main` @ `1b641c9`).
- **Fecha**: 2026-07-02.
- **Metodo**: lectura del codigo real de cada camino (no de docs), trazado de cada modo de fallo del
  proveedor (4xx / 5xx / timeout / stream cortado / respuesta vacia o malformada) y de cada limite
  (timeout, token_cap, iteraciones) hasta su manejo o su hueco, con `path:linea`. Verificacion
  adversarial independiente de cada hallazgo candidato (panel de sub-agentes que intento refutar cada
  uno) y un barrido por dimension (A-J del checklist) que busco huecos nuevos. Cada hallazgo lleva su
  nivel de confianza explicito. Pregunta central: *"que pasa cuando el proveedor de IA falla de esta
  forma especifica?"*.

> **Backlog consolidado**: este informe NO arregla nada. Alimenta el backlog. La SSRF via `baseUrl`
> (H-01) ya fue senalada por la auditoria #1 (auth/authz) sobre `POST /v1/agent/run`; aqui se
> **confirma que persiste** identica en `POST /v1/run/:agentId` y en el worker, y se re-encuadra como
> defecto del canal de proveedor del motor.

---

## 1. Resumen ejecutivo

**Veredicto: el motor degrada con gracia ante los fallos "normales" de proveedor (4xx/5xx/timeout/
desconexion), pero es FRAGIL ante proveedores openai-compatible no canonicos y ante entradas de
tamano no acotado; ademas tiene divergencias reales entre el camino HTTP y el camino worker.**

Lo solido primero: el nucleo de resiliencia esta bien pensado. Los errores del SDK se normalizan a un
`ProviderError` que **nunca retiene el objeto crudo** (no filtra la apiKey), el corte por timeout de
pared cierra limpio y distingue "cliente se fue" de "timeout" de "el proveedor corto", los timers se
limpian siempre (verificado en tests), las tools de webhook NUNCA tumban el run (devuelven `isError`)
y tienen una defensa anti-SSRF seria (https + IP-guard con resolucion DNS + `redirect: manual`), y el
match credencial-vs-proveedor esta cerrado en ambos caminos.

Lo fragil: (1) una **SSRF autenticada** por el `baseUrl` de openai-compatible, que NO recibe el mismo
saneamiento que los webhooks; (2) el loop **descarta silenciosamente las tool calls** cuando un
endpoint compatible cierra con un `finish_reason` no canonico (Groq/Together/vLLM/Ollama), rompiendo
el tool-calling entero; (3) **falta de backpressure** en el SSE: un proveedor que inunda `text_delta`
puede agotar la memoria del backend; y varios modos de fallo de proveedor (respuesta vacia, stream
truncado, JSON de tool malformado) que se reportan como **exito** o matan el run sin auto-correccion.
El **token_cap es evadible** por cualquier endpoint que no reporte `usage`, y el camino worker no
aplica el presupuesto de caracteres que el HTTP si exige.

Hallazgos por severidad:

| Sev | # | Hallazgos |
|-----|---|-----------|
| **CRITICA** | 0 | -- (ninguno verificado; la SSRF quedo en ALTA por vector constrenido) |
| **ALTA** | 3 | H-01 SSRF via `baseUrl`; H-02 tool_use descartadas con `finish_reason` no canonico; H-03 SSE sin backpressure (OOM) |
| **MEDIA** | 9 | H-04 worker ignora `retryable`; H-05 respuesta vacia = exito; H-06 output vacio encadenado en recetas; H-07 lectura no acotada del body de tool (OOM); H-08 token_cap evadible sin `usage`; H-09 SSRF de adjuntos (HTTP); H-10 worker no aplica `maxTotalContentChars`; H-11 deadline de receta por-paso, no por-job; H-12 SSE sin heartbeat |
| **BAJA** | 11 | H-13..H-23 (clasificacion 408/`statusCode`, single-turn token_cap, JSON de tool malformado, cancelacion no preempta tools, retries del SDK, stream truncado, id de tool, ventana clientGone, log de desconexion, maxIterations sin cap en worker) |
| **INFO** | 2 | H-24 guarda `stopReason==='error'` inerte; H-25 `reply.raw.end()` sin guarda |
| **REFUTADO** | 1 | R-01 "sobreconteo de input tokens" -- es el conteo correcto de facturacion (ver Apendice A) |

---

## 2. Matriz de modos de fallo de proveedor (el corazon del informe)

Cada fila es una forma en que un proveedor BYOK puede portarse mal; la columna dice como responde el
motor **hoy**, verificado contra codigo.

| # | El proveedor... | Manejo del motor | Veredicto |
|---|-----------------|------------------|-----------|
| 1 | Devuelve **401/403** (auth invalida) | `classify` -> `AUTHENTICATION` (no retryable). HTTP: evento `error` sin filtrar key. Worker: **lo reintenta 3x igual** (ignora `retryable`, H-04) | Parcial |
| 2 | Devuelve **429** (rate limit) | `classify` -> `RATE_LIMIT` (retryable). HTTP: evento `error`. Worker: reintenta con backoff. Correcto | **OK** |
| 3 | Devuelve **404** (modelo inexistente) | `classify` -> `MODEL_NOT_FOUND` (no retryable). Worker reintenta 3x igual (H-04) | Parcial |
| 4 | Devuelve **400/422** (request invalido) | `classify` -> `INVALID_REQUEST` (no retryable). Worker reintenta 3x igual (H-04) | Parcial |
| 5 | Devuelve **5xx** | `classify` -> `PROVIDER_UNAVAILABLE` (retryable). Reintento correcto | **OK** |
| 6 | Devuelve **408** (request timeout via HTTP) | Cae a `UNKNOWN` no-retryable (no hay rama 408, H-13) | Hueco (BAJA) |
| 7 | Adjunta el status como **`statusCode`/`.response.status`** (proxies, wrappers) | `getStatus` solo lee `.status` -> `UNKNOWN` no-retryable (H-14). Relevante en openai-compatible | Hueco (BAJA) |
| 8 | **Timeout de red / cuelga** sin emitir bytes | El SDK lanza `APITimeout*`/`APIConnection*` -> `TIMEOUT`/`PROVIDER_UNAVAILABLE`. El deadline de pared (AbortController + setTimeout) aborta y cierra limpio | **OK** |
| 9 | **Corta la conexion a mitad del stream** | El SDK lanza error de conexion -> `PROVIDER_UNAVAILABLE`. HTTP: evento `error` con tokens parciales; worker: reintenta | **OK** |
| 10 | Emite **JSON de tool sintacticamente invalido** en un bloque completo | `JSON.parse` lanza `SyntaxError` -> `toProviderError` -> `UNKNOWN` -> mata el run. NO se reinyecta `tool_result isError` para auto-correccion (H-15) | Hueco (BAJA) |
| 11 | Emite **tool_calls pero cierra con `finish_reason` no canonico** (`stop`/`length`/null/propietario) | El loop ve `stopReason !== 'tool_use'` y **descarta las tools** ya emitidas; el run cierra `end_turn` "exitoso" (H-02) | **Hueco (ALTA)** |
| 12 | Responde **200 con stream vacio** (sin content ni finish_reason) | Se reporta `stop end_turn`, 0 tokens, run `completed`, sin `errorCode` (H-05). En recetas encadena assistant vacio | Hueco (MEDIA) |
| 13 | **Trunca** el stream sin enviar `finish_reason` | Se mapea a `end_turn` (fin limpio), enmascarando la interrupcion (H-16) | Hueco (BAJA) |
| 14 | Emite **tool_use con `id` vacio o duplicado** | El loop reinyecta `tool_result` correlacionando por ese `id` sin validar unicidad/no-vacio (H-17) | Hueco (BAJA) |
| 15 | **No reporta `usage`** (o lo pone en 0/negativo) | Los acumuladores quedan en 0 -> el **token_cap nunca dispara** (H-08). Comun en vLLM/Ollama | Hueco (MEDIA) |
| 16 | **Ignora `max_tokens`** y stremea salida gigante en UN turno | El token_cap solo se evalua ENTRE iteraciones; el turno unico solo lo acota el timeout de pared (H-19). Sin backpressure, ademas, OOM (H-03) | Hueco (BAJA/ALTA) |
| 17 | Devuelve texto con **unicode/emojis/caracteres especiales** | Se re-emite tal cual; `JSON.stringify` en SSE lo escapa bien; no se corrompe | **OK** |
| 18 | Es un **`baseUrl` interno** (169.254.x, 10.x, localhost) | El motor hace `POST {baseUrl}/chat/completions` SIN guarda anti-SSRF (H-01) | **Hueco (ALTA)** |
| 19 | Responde **muy lento al primer token** (gap largo) | No hay heartbeat SSE; un proxy intermedio puede cerrar la conexion idle y abortar el run (H-12) | Hueco (MEDIA) |

**Lectura de la matriz**: los fallos "de manual" (filas 1-9, 17) se manejan bien -- el motor los
captura, clasifica, propaga sin filtrar la key y no cuelga. Los huecos se concentran en (a) proveedores
openai-compatible **no canonicos** (filas 7, 11, 12, 13, 14, 15) -- exactamente el caso BYOK que el
motor promete soportar -- y (b) la ausencia de cotas de recursos a media respuesta (filas 16, 18, 19).

---

## 3. Hallazgos detallados

Formato: **SEVERIDAD | CONFIANZA** -- Ubicacion -- Evidencia -- Escenario -- Impacto -- Recomendacion.

### ALTA

#### H-01 -- SSRF autenticada via el `baseUrl` de openai-compatible
- **ALTA | alta**
- **Ubicacion**: `apps/backend/src/routes/agents.ts:53`, `apps/backend/src/routes/credentials.ts:19`,
  `apps/backend/src/providers/openai-compatible/openai-compatible-provider.ts:22-28`,
  `apps/backend/src/execution/assemble-agent-run.ts:135-142`.
- **Evidencia**: `agents.ts:53` `baseUrl: z.string().url().nullable().optional()` y `credentials.ts:19`
  `baseUrl: z.string().url().optional()` -- **solo validan URL sintactica**: se admite `http://`,
  cualquier host, IPs privadas y el endpoint de metadata (`169.254.169.254`). El provider hace
  `new OpenAI({ apiKey, baseURL })` con el unico chequeo de no-vacio. Contraste directo: la URL de las
  webhook tools SI fuerza `.startsWith('https://')` (`agents.ts:27`) y pasa por
  `resolvesToForbiddenIp` (`webhook-tools.ts:66`) con `ip-guard.ts` (bloquea `169.254.0.0/16`,
  `10/8`, `127/8`, etc.). Ese guard **no cubre el `baseUrl`** del proveedor.
- **Escenario**: cualquier usuario autenticado crea un agente/credencial openai-compatible con
  `baseUrl` apuntando a la red interna y ejecuta `POST /v1/run/:agentId` (o encola un job). El backend
  emite la peticion saliente hacia el host interno.
- **Impacto**: SSRF **ciego/semi-ciego**. El SDK de OpenAI hace `POST` a la ruta FIJA
  `${baseURL}/chat/completions`, asi que el atacante **no** controla metodo ni path: no hay lectura
  arbitraria ni GET a IMDS. Lo que SI queda: sondeo de puertos/servicios internos, `POST` a endpoints
  internos, `http://` plano permitido, y fuga parcial de la respuesta interna via los mensajes de
  error normalizados (`toProviderError` copia el `message`). La apiKey enviada en `Authorization` es
  la BYOK del propio atacante (no un secreto cross-tenant), lo que acota el dano. Por eso ALTA, no
  CRITICA.
- **Recomendacion**: aplicar al `baseUrl` el MISMO control que a los webhooks -- forzar `https` y
  correr `resolvesToForbiddenIp`/`ip-guard` sobre el host -- en `agents.ts`, `credentials.ts`,
  `configurator.ts` y `admin-agents.ts`, e idealmente tambien en runtime justo antes de instanciar el
  cliente (defensa contra DNS-rebinding y contra filas de DB pre-existentes).

#### H-02 -- El loop descarta las tool calls cuando el proveedor cierra con `finish_reason` no canonico
- **ALTA | alta**
- **Ubicacion**: `apps/backend/src/agent/run-agent.ts:108` (decision) y `:87-91` (yield de tool_use);
  `apps/backend/src/providers/openai/translate-stream.ts:60-74`;
  `apps/backend/src/providers/openai/map-finish-reason.ts:16-17`.
- **Evidencia**: `run-agent.ts:108`
  `if (stopReason !== 'tool_use' || toolCalls.length === 0) { yield {type:'stop',...}; return; }` --
  la decision de EJECUTAR las tools depende UNICAMENTE de `stopReason`, no de que existan `toolCalls`.
  Pero `translate-stream.ts:65-74` **siempre** emite los `tool_use` acumulados, independiente del
  `finishReason`, y `map-finish-reason.ts:16-17` cae al `default: return 'end_turn'` para cualquier
  valor no reconocido (`length`->`max_tokens`, `stop`->`end_turn`).
- **Escenario**: muchos endpoints openai-compatible (Groq, Together, vLLM, Ollama, OpenRouter) emiten
  los `tool_calls` por delta pero cierran el `choice` con `finish_reason` = `stop`, `null` o un valor
  propietario en vez de `tool_calls`. Tambien un tool call truncado por `length`.
- **Impacto**: el cliente recibe eventos `tool_use` por SSE **sin su `tool_result` correlativo**
  (contrato `AgentEvent` roto), la tool que el modelo pidio **jamas se ejecuta**, y el run se cierra
  como `end_turn`/`max_tokens` "completado" en silencio. Para un agente BYOK con tools sobre un
  proveedor compatible no-canonico, el tool-calling simplemente **no funciona** y el fallo es dificil
  de diagnosticar (no hay error).
- **Recomendacion**: decidir la ejecucion por `toolCalls.length > 0` (no por `stopReason`), o
  normalizar en los adaptadores: si se emitieron bloques tool_use, forzar `stopReason = 'tool_use'`.

#### H-03 -- SSE sin backpressure: un proveedor que inunda `text_delta` agota la memoria (OOM/DoS)
- **ALTA | alta**
- **Ubicacion**: `apps/backend/src/routes/sse-runner.ts:16-21` (`sseWrite`) y `:118-129` (loop).
- **Evidencia**: `sseWrite` hace `reply.raw.write(...)` **ignorando el booleano de retorno**, y el
  `for await` re-emite cada evento sin esperar nunca el evento `'drain'` del socket. `runAgent`
  re-emite CADA `text_delta` (`run-agent.ts:84`) y ademas los acumula sin cota en `textParts`
  (`run-agent.ts:76,83,128`).
- **Escenario**: un endpoint BYOK (openai-compatible o anthropic) responde a un solo turno con un
  stream masivo o muy rapido de `text_delta` (megabytes) mientras el cliente SSE consume lento o no
  consume.
- **Impacto**: el buffer interno del socket del backend crece sin limite (Node acumula en heap todo
  lo no drenado). El token_cap se evalua solo ENTRE iteraciones (`run-agent.ts:116`) -- **no a media
  respuesta** -- y si el proveedor no reporta `usage` (H-08) nunca dispara; no hay corte intra-turno.
  Una sola respuesta de un proveedor malicioso/roto puede agotar la memoria del proceso backend (DoS
  que afecta a todos los tenants del mismo proceso).
- **Recomendacion**: respetar el backpressure (comprobar el retorno de `write()` y esperar `'drain'`),
  y/o imponer una cota dura de bytes acumulados por run que aborte el stream al superarse.

### MEDIA

#### H-04 -- El worker ignora `ProviderError.retryable`: reintenta 3x errores no-reintentables
- **MEDIA | alta**
- **Ubicacion**: `apps/worker/src/execution.ts:460-508` (`handleFailure`); flag en
  `apps/backend/src/providers/errors.ts:54`.
- **Evidencia**: `errors.ts:18-22` define `RETRYABLE_CODES = {RATE_LIMIT, TIMEOUT, PROVIDER_UNAVAILABLE}`
  y `errors.ts:54` `this.retryable = RETRYABLE_CODES.has(params.code)`. `handleFailure` **solo**
  distingue `ShutdownAbortError` y `PermanentExecutionError`; TODO lo demas cae al branch transitorio
  (`:486-501`) que reintenta mientras `attempts < MAX_ATTEMPTS(3)`. Un grep confirma que `retryable`/
  `.code` NO se referencian en ningun path de produccion de `apps/worker/src`.
- **Escenario**: una key BYOK invalida/revocada (401/403), un modelo inexistente en la config del
  agente (404) o un request invalido (400/422): errores permanentes que nunca se resuelven solos.
- **Impacto**: se desperdician 2 reintentos extra (attempts 2 y 3) con backoff 5s+10s golpeando al
  proveedor con la misma condicion, retrasando ~15s el fallo definitivo y su alerta, y ocupando un
  slot de worker. En **recetas** es peor: el reintento re-corre DESDE EL PASO 1 (`execution.ts:332`),
  re-ejecutando pasos previos exitosos -> gasta cuota/costo de la key BYOK del owner hasta 3 veces por
  un fallo que jamas se arreglara. Ademas para recetas el `ProviderError` queda sepultado en un
  `new Error(...)` plano (`execution.ts:403`), perdiendo el tipo. (No es fuga de secreto: `errors.ts`
  solo copia escalares.)
- **Recomendacion**: en `handleFailure`, tratar `error instanceof ProviderError && !error.retryable`
  como fallo permanente (a `failed` directo, sin consumir reintentos), analogo a
  `PermanentExecutionError`.

#### H-05 -- Respuesta vacia del proveedor se reporta como run EXITOSO (no como error)
- **MEDIA | alta**
- **Ubicacion**: `apps/backend/src/providers/openai/translate-stream.ts:76-80`;
  `apps/backend/src/providers/anthropic/anthropic-provider.ts:39,92`.
- **Evidencia**: si el stream no emite ningun chunk con content/finish_reason, `translate-stream`
  igual hace `yield { type:'stop', reason: mapFinishReason(null)='end_turn', usage: {0,0} }`.
  `anthropic-provider` arranca `stopReason='end_turn'` y emite ese stop si el stream cierra sin
  `message_delta`. `runAgent` lo ve como `end_turn` sin toolCalls -> stop `end_turn` sin error.
- **Escenario**: un endpoint openai-compatible autohospedado (vLLM/Ollama) responde 200 con cuerpo
  vacio, sin lanzar excepcion.
- **Impacto**: el run se contabiliza `completed` (HTTP `sse-runner.ts:178-184`; worker
  `execution.ts:297` `markCompleted`) con salida vacia y sin `errorCode`. En una receta encadena un
  assistant vacio al historial (ver H-06) y sigue. Una falla real del proveedor queda **invisible**
  para el cliente y el registro de runs.
- **Recomendacion**: tratar un stop natural con 0 eventos de contenido y 0 tokens como una condicion
  de advertencia/error del proveedor, distinguible de un `end_turn` genuino.

#### H-06 -- El motor de recetas encadena texto de assistant VACIO al historial
- **MEDIA | alta**
- **Ubicacion**: `apps/worker/src/execution.ts:419` (y `:195,199` acumulacion; `:311-313`
  `textMessage`).
- **Evidencia**: `history.push(textMessage('assistant', stepResult.text))` es incondicional;
  `stepResult.text` puede ser `''` (solo tool_use, o respuesta vacia, o corte por
  max_iterations/token_cap sin texto). El unico guard previo (`:409`) mira `stopReason==='error'`, que
  nunca ocurre (H-24). `textMessage('assistant','')` produce `content:[{type:'text',text:''}]`.
- **Escenario**: un paso INTERMEDIO de la receta produce salida vacia (modelo que solo llama tools, o
  respuesta en blanco).
- **Impacto**: Anthropic (y compatibles estrictos) **rechazan** un bloque de texto assistant vacio con
  400 -> el paso siguiente falla -> la receta entera queda inejecutable, consume los 3 reintentos y
  dispara alerta de fallo definitivo, pese a que el modelo respondio legitimamente. Alcance acotado:
  en OpenAI el bloque vacio se mapea a `content:''` (`openai/map-request.ts:33`) y NO falla; y solo
  rompe si el paso vacio es intermedio (un texto vacio en el ULTIMO paso no se encadena). **Divergencia
  con HTTP**, que no encadena pasos.
- **Recomendacion**: saltar el `push` del assistant cuando `stepResult.text` es vacio/whitespace, o
  sustituirlo por un placeholder minimo.

#### H-07 -- Lectura no acotada del body de respuesta de una tool (OOM)
- **MEDIA | alta**
- **Ubicacion**: `apps/backend/src/tools/signed-tool-fetch.ts:66-67`.
- **Evidencia**: `const text = await response.text(); const clipped = text.length > maxResponseChars
  ? text.slice(0, maxResponseChars) : text;` -- se bufferea el cuerpo **COMPLETO** en memoria ANTES de
  recortar a `maxResponseChars` (100k). No hay chequeo de `Content-Length` ni lectura por stream con
  corte temprano (contraste: `attachments/extract.ts:72-96` SI lo hace con `readBodyBounded`).
- **Escenario**: el endpoint de una tool (webhook de cliente O el web worker nativo -- ambos comparten
  `performSignedToolPost`) responde 200 con un cuerpo enorme dentro de la ventana de 10s.
- **Impacto**: un endpoint de tool que se porta mal (o comprometido) infla la heap del backend/worker
  por corrida; el recorte ocurre demasiado tarde. Con runs concurrentes y varias tool_use por turno
  (en secuencia), es un vector de OOM/DoS. El unico limite real es el timeout de 10s.
- **Recomendacion**: leer el body por stream con corte temprano al superar `maxResponseChars` (reusar
  el patron de `readBodyBounded`), y rechazar por `Content-Length` declarado.

#### H-08 -- token_cap evadible: depende del `usage` autorreportado por el proveedor
- **MEDIA | alta**
- **Ubicacion**: `apps/backend/src/agent/run-agent.ts:95-98,116`;
  `apps/backend/src/providers/openai/translate-stream.ts:22-29`.
- **Evidencia**: `run-agent.ts:95-98` `if (event.usage) { totalInputTokens += ...; }` -- la suma solo
  ocurre si el proveedor manda `usage`. En `translate-stream.ts:22-29` los contadores arrancan en 0 y
  solo se actualizan si `chunk.usage` llega. El motor pide `stream_options:{include_usage:true}`
  (`map-request.ts:101`), pero no puede forzar el cumplimiento.
- **Escenario**: un endpoint openai-compatible/BYOK adversarial o buggy no envia el bloque `usage` (o
  lo pone en 0/negativo).
- **Impacto**: el corte `DEFAULT_RUN_MAX_TOKENS` (1M, documentado como salvaguarda de plataforma)
  queda **neutralizado**; el run solo lo acotan `maxIterations` (cap 20) y el timeout de pared. Con
  H-03 (sin backpressure) y H-19 (sin corte intra-turno), habilita consumo de recursos desacoplado del
  cap. El costo de tokens recae sobre la key BYOK del propio tenant, pero la memoria/CPU es de la
  plataforma.
- **Recomendacion**: complementar el cap con una cota independiente del `usage` autorreportado (p.ej.
  bytes/caracteres generados acumulados) que corte a media respuesta.

#### H-09 -- SSRF de adjuntos-documento en el camino HTTP
- **MEDIA | media** (verificador dedicado no concluyo por limite de reintentos; evidencia primaria
  directa + confirmado por la revision de cobertura).
- **Ubicacion**: `apps/backend/src/attachments/extract.ts:16-18,98-123`;
  `apps/backend/src/routes/run-agent-by-id.ts:22-29` (`AttachmentSchema.url`).
- **Evidencia**: `extract.ts:16-18` difiere explicitamente la SSRF ("*la confianza/SSRF de las URLs...
  responsabilidad de PR2; aqui la descarga solo se acota con timeout y tamano maximo*").
  `downloadDocument` hace `fetchImpl(url, ...)` (GET) directo sobre la `attachment.url` provista por el
  cliente, **sin pasar por `ip-guard`**. El schema solo exige `z.string().url().max(2048)`.
- **Escenario**: un adjunto de tipo `pdf`/`excel`/`word` con `url` apuntando a un servicio interno o a
  `169.254.169.254`, enviado a `POST /v1/run/:agentId`.
- **Impacto**: SSRF server-side por **GET a URL arbitraria** (mas potente que H-01 en cuanto a metodo/
  path). Es semi-ciega: el cuerpo se parsea como documento y se inyecta al modelo, no se devuelve
  crudo, pero el sondeo interno es viable y algunos servicios internos GET podrian filtrar contenido
  parcial via el texto extraido o los mensajes de error. (Caveat: la metadata de nube que exige header
  -- p.ej. GCP `Metadata-Flavor` -- no respondera a un GET pelado; IMDSv2 exige PUT+token.) No aplica
  en el worker (no procesa adjuntos).
- **Recomendacion**: aplicar `resolvesToForbiddenIp`/`ip-guard` + `https` al `downloadDocument` (mismo
  control que webhooks), como ya anticipa el comentario de alcance del propio fichero.

#### H-10 -- El camino worker (job simple) no aplica `maxTotalContentChars`
- **MEDIA | alta**
- **Ubicacion**: `apps/worker/src/execution.ts:125-131` (`JobPayloadSchema`);
  `apps/backend/src/routes/run-agent-by-id.ts:31-43` (`RunByIdBodySchema`).
- **Evidencia**: el HTTP aplica los tres limites: `messages.max(maxMessages=100)`, refine de
  `maxTotalContentChars=200k` (`:41-42`) y `maxIterations.max(cap=20)`. El `JobPayloadSchema` del
  worker solo exige `messages.min(1)` y `maxIterations.positive()`. `assembleAgentRun` no valida
  mensajes; `validateAgentRun` (`limits.ts:57-74`) solo comprueba `messages.length===0` y el cap de
  iteraciones. **Precision**: `maxIterationsCap` SI se aplica (via `validateAgentRun`, y en creacion de
  plantilla) y `maxMessages` se aplica en el enqueue (`scheduled-tasks.ts:23`, `triggers.ts:35`); el
  UNICO limite genuinamente no aplicado en NINGUN punto del camino worker es
  **`maxTotalContentChars`**.
- **Escenario**: una tarea programada/trigger con hasta 100 mensajes de longitud arbitraria (cada uno
  pasa `content:z.string()` sin cota) -> el total puede exceder 200k chars.
- **Impacto**: el mismo agente via worker acepta un payload que el HTTP rechazaria; va directo al
  proveedor con un contexto gigante -> probable `INVALID_REQUEST` (context length) que ademas se
  reintenta 3x (H-04), o quema tokens de la key BYOK. Divergencia HTTP vs worker; la plataforma
  declara `AGENT_LIMITS` como "unica fuente de verdad" pero no la aplica como defensa en profundidad en
  el worker.
- **Recomendacion**: aplicar el refine de `maxTotalContentChars` (y el cap de mensajes) en el enqueue
  de tareas/triggers y/o en `JobPayloadSchema`, para paridad con HTTP.

#### H-11 -- El deadline de receta es POR PASO, no por-job; los pasos no tienen cota en el parser autoritativo
- **MEDIA | media**
- **Ubicacion**: `apps/worker/src/execution.ts:359-397`; `packages/shared/src/jobs/recipe-payload.ts:82-93`.
- **Evidencia**: `runRecipeJob` corre cada paso con su PROPIO `runAgentWithDeadline` (deadline
  `runTimeoutMs`, default 600s), sin ningun deadline agregado del job. El parser autoritativo del
  payload (`parseRecipeJobPayload`, `recipe-payload.ts:82-93`) solo rechaza `steps.length===0`, **sin
  tope superior**. (La CREACION de recetas SI cap a 50 pasos, `recipes.ts:16,27`, pero el parser de
  ejecucion no re-valida ese tope: hueco de defensa en profundidad.)
- **Escenario**: una receta larga (hasta 50 pasos por el cap de creacion) o un payload de job armado/
  alterado fuera del route de creacion.
- **Impacto**: el tiempo total de pared de un job de receta es `totalSteps * runTimeoutMs` -- **no**
  acotado por `RUN_TIMEOUT_SECONDS`. Con 50 pasos y default 600s: hasta ~8.3h de slot de worker por
  job, y ~25h en el peor caso con los 3 reintentos (que re-corren desde el paso 1). `RUN_TIMEOUT_SECONDS`
  no significa lo mismo en HTTP (deadline del run) que en el worker de recetas (deadline por paso).
- **Recomendacion**: aplicar tambien un deadline agregado por job de receta, y re-validar el cap de
  pasos en el parser autoritativo.

#### H-12 -- SSE sin heartbeat: un proveedor lento deja que un proxy cierre la conexion antes del timeout
- **MEDIA | media**
- **Ubicacion**: `apps/backend/src/routes/sse-runner.ts:110-138` (unicos writes = eventos del modelo).
- **Evidencia**: los unicos `write` al socket son `sseWrite` dentro del `for await` y en el cierre; no
  hay `setInterval` que emita comentarios keep-alive (`:heartbeat\n\n`). El deadline tipico es de
  decenas/cientos de segundos (`DEFAULT_RUN_TIMEOUT_SECONDS=600`).
- **Escenario**: el proveedor BYOK acepta la conexion pero tarda al primer token, o hay un gap
  silencioso largo (tool nativa lenta, modelo "pensando"). Muchos proxies (nginx, ALB, Cloudflare)
  cortan conexiones idle a ~60s.
- **Impacto**: el proxy cierra el TCP -> `reply.raw` dispara `'close'` -> `clientGone=true` ->
  `controller.abort()` -> el run se aborta prematuramente y se registra como `aborted` (desconexion de
  cliente), aunque el cliente real seguia esperando. Se consumen tokens del proveedor sin resultado y
  no se distingue de una desconexion genuina.
- **Recomendacion**: emitir comentarios SSE de keep-alive periodicos mientras el run esta activo.

### BAJA

#### H-13 -- `classify` no mapea HTTP 408 a `TIMEOUT` (cae a `UNKNOWN` no-retryable)
- **BAJA | alta** -- `apps/backend/src/providers/errors.ts:102-119`. El switch por status cubre
  401/403, 404, 429, 400/422 y 500-599; un 408 cae a `UNKNOWN`. Un proveedor/proxy que senala timeout
  via HTTP 408 (en vez de un `APITimeoutError` por nombre) pierde la semantica retryable y el
  diagnostico. **Rec**: agregar rama 408 (y 409/425 segun politica) -> `TIMEOUT`/retryable.

#### H-14 -- `getStatus` solo lee `.status`; ignora `statusCode` / `.response.status`
- **BAJA | media** -- `apps/backend/src/providers/errors.ts:58-66`. Errores de transporte/proxy o
  wrappers que exponen el codigo como `statusCode` (undici/node http) o `error.response.status` se
  clasifican `UNKNOWN` no-retryable. Especialmente relevante en openai-compatible (endpoints de
  terceros que no siempre usan la clase `APIError` del SDK oficial). **Rec**: leer tambien `statusCode`
  y `response.status`.

#### H-15 -- JSON de tool sintacticamente invalido mata el run sin auto-correccion
- **BAJA | alta** -- `apps/backend/src/providers/anthropic/anthropic-provider.ts:70-71`,
  `apps/backend/src/providers/openai/translate-stream.ts:72`. `JSON.parse(trimmed)` sobre los
  argumentos acumulados; si el modelo emite JSON invalido en un bloque de tool YA completo, lanza
  `SyntaxError` -> `toProviderError` -> `UNKNOWN` -> el run falla. (Matiz verificado: un stream cortado
  a mitad produce error de conexion `PROVIDER_UNAVAILABLE`, no `SyntaxError`; el unico disparador de
  `SyntaxError` es JSON invalido en bloque completo.) Es un gap de manejo elegante: no se reinyecta un
  `tool_result isError` para que el modelo se auto-corrija. **Rec**: envolver el `JSON.parse` y emitir
  un `tool_use` con input vacio + marca de error, o un `tool_result` de error, en vez de tumbar el run.

#### H-16 -- Stream truncado sin `finish_reason` se mapea a `end_turn`
- **BAJA | media** -- `apps/backend/src/providers/openai/translate-stream.ts:60-62`,
  `map-finish-reason.ts:16-17`. Si el stream termina sin enviar `finish_reason`, queda `null` ->
  `end_turn` (fin natural). Enmascara una generacion cortada como completa; combinado con H-05 oculta
  fallas parciales del proveedor. **Rec**: distinguir "sin finish_reason" de un `end_turn` genuino.

#### H-17 -- El loop confia ciegamente en el `id` de tool_use (vacio o duplicado)
- **BAJA | media** -- `apps/backend/src/agent/run-agent.ts:132-153`;
  `apps/backend/src/providers/openai/translate-stream.ts:44-50` (`pending.id` arranca `''`). Un
  endpoint que stremea tool_calls sin `id` (o con `id` repetido) produce reinyeccion de pares
  `tool_use`/`tool_result` con `toolUseId=''` o duplicado -> correlacion ambigua en el turno siguiente
  o rechazo del proveedor. **Rec**: validar unicidad/no-vacio del `id` antes de reinyectar (o generar
  uno).

#### H-18 -- La cancelacion no preempta las tool calls encoladas del turno en curso
- **BAJA | alta** -- `apps/backend/src/agent/run-agent.ts:138-139`,
  `apps/backend/src/tools/signed-tool-fetch.ts:44-47`. El loop ejecuta las tools del turno EN SECUENCIA
  y no chequea `input.signal.aborted` entre ellas; `performSignedToolPost` hace
  `signal?.addEventListener('abort',...)` **sin** un `if (signal?.aborted)` previo, asi que un signal
  ya-abortado no dispara el listener. Si el abort (timeout global o desconexion) ocurre durante la tool
  1, las tools 2..N registran su listener con el signal ya-abortado y cada una corre hasta 10s:
  worst-case ~`(N-1)*10s` de POSTs salientes DESPUES de que el run deberia haber muerto -- prolongando
  la exposicion SSRF-amplificada (H-01/H-09) tras la cancelacion. **Rec**: chequear `signal?.aborted`
  al entrar a `performSignedToolPost` y entre tools en el loop.

#### H-19 -- El token_cap no se evalua dentro de un turno unico
- **BAJA | alta** -- `apps/backend/src/agent/run-agent.ts:108-119`. El `return` de `:108-111` (stop
  natural) sale ANTES del check de token_cap (`:116`), que solo se alcanza si `stopReason==='tool_use'`
  con toolCalls. Respuesta a la pregunta D: un modelo que ignora `max_tokens` **NO** se corta por el
  cap global dentro de su turno; solo lo acota el timeout de pared (backstop duro). Combina con H-08 y
  H-03. Costo auto-infligido (key BYOK del tenant). **Rec**: ver H-08 (cota intra-turno).

#### H-20 -- Los reintentos por defecto del SDK se componen con los del worker
- **BAJA | alta** -- `anthropic-provider.ts:28`, `openai-provider.ts:21`,
  `openai-compatible-provider.ts:28`. Los clientes se construyen SIN `maxRetries` ni `timeout`; los SDK
  de Anthropic/OpenAI reintentan por defecto (`maxRetries=2`) en 429/5xx/errores de conexion.
  Componiendo con `MAX_ATTEMPTS=3` del worker, un job puede golpear al proveedor hasta ~9 veces (mas
  latencia/tokens). Ademas el timeout por defecto del SDK (~10min) es independiente de
  `RUN_TIMEOUT_SECONDS`. **Rec**: fijar `maxRetries` (p.ej. 0-1) y un `timeout` explicito por-request
  alineado con el deadline del run.

#### H-21 -- Desconexion real del cliente se registra como `errorCode='UNKNOWN'` y se loguea a nivel error
- **BAJA | alta** -- `apps/backend/src/routes/sse-runner.ts:145,161-164,178-184`. Ante `clientGone`, el
  provider lanza `AbortError` (no `ProviderError`) y, como `timedOut` es false, se entra al `else` del
  catch: `errorCode` queda `'UNKNOWN'` (deberia ser `null` para un `aborted`) y `request.log.error('agent
  run failed')` se ejecuta incondicionalmente. **Impacto**: metadato enganoso en la tabla de runs y
  ruido de logs de error por cada desconexion normal (falsas alarmas). **Rec**: no setear `errorCode`
  ni loguear a `error` cuando `clientGone`.

#### H-22 -- Ventana en que se escribe a un socket ya muerto pese a `clientGone`
- **BAJA | media** -- `apps/backend/src/routes/sse-runner.ts:75-80,119-128`. El handler `'close'` que
  setea `clientGone`/abort se despacha de forma asincrona; entre la muerte real del socket (RST) y la
  ejecucion del handler, el `for await` puede recibir otro evento y `sseWrite` (que no consulta
  `reply.raw.destroyed`/`writableEnded`) escribe a un socket cerrado. Node lo tolera, pero contradice
  la premisa de "clientGone evita escribir a socket muerto". **Rec**: chequear `reply.raw.destroyed` en
  `sseWrite`.

#### H-23 -- El schema del worker no acota `maxIterations` al cap
- **BAJA | alta** -- `apps/worker/src/execution.ts:130`. `maxIterations: z.number().int().positive()`
  sin `.max(maxIterationsCap)` (el HTTP SI lo acota, `run-agent-by-id.ts:37`). Un valor fuera de rango
  no se rechaza al validar el payload: `validateAgentRun` lanza DENTRO del run (`limits.ts:65`), que
  `handleFailure` trata como transitorio -> 3 reintentos + alerta de fallo definitivo por un error de
  pura validacion de entrada. Divergencia HTTP vs worker. **Rec**: acotar en el schema del payload/
  enqueue, o tratar `AgentInputError` como permanente en el worker.

### INFO

#### H-24 -- Guarda `stepResult.stopReason === 'error'` en recetas es codigo inerte
- **INFO | alta** -- `apps/worker/src/execution.ts:409-411`. Ni `mapStopReason`, ni `mapFinishReason`,
  ni `runAgent` emiten `stop reason 'error'` (los errores se LANZAN y los captura el try/catch de
  `:396-406`). El guard nunca se ejecuta con proveedores reales; sugiere un modelo mental incorrecto
  del manejo de fallas y da falsa sensacion de cobertura. **Rec**: eliminar o documentar como
  defensivo-teorico.

#### H-25 -- `reply.raw.end()` en `finally` sin guarda de socket destruido ni try/catch
- **INFO | media** -- `apps/backend/src/routes/sse-runner.ts:166-196`. En una desconexion real el
  socket ya esta destruido y aun asi se invoca `end()`. Es no-op seguro en la mayoria de versiones de
  Node, pero es una escritura no guardada mas y un potencial rechazo de la promesa del handler si
  `end()` lanzara. **Rec**: guardar con `reply.raw.writableEnded`/`destroyed` o envolver en try/catch.

---

## 4. Divergencias HTTP (Playground) vs Worker (autonomia)

El mismo agente puede comportarse distinto segun el camino. Divergencias verificadas:

| Aspecto | HTTP `POST /v1/run/:agentId` | Worker (job simple / receta) | Hallazgo |
|---------|------------------------------|------------------------------|----------|
| `maxTotalContentChars` (200k) | **Aplicado** (refine en `RunByIdBodySchema`) | **No aplicado** en ningun punto | H-10 |
| `maxIterations` fuera de rango | 400 inmediato (`.max(cap)` en schema) | 3 reintentos + alerta (lanza dentro del run) | H-23 |
| Error de proveedor permanente (401/404/400) | Evento `error`, run termina | **Reintentado 3x** (ignora `retryable`) | H-04 |
| Deadline de pared | Sobre el run completo | Por-paso en recetas (`totalSteps * timeout`) | H-11 |
| Output vacio | No encadena (un solo turno) | Encadena assistant vacio -> 400 en Anthropic | H-06 |
| Adjuntos | Descarga server-side sin ip-guard | No procesa adjuntos | H-09 (solo HTTP) |
| Captura de output | Se stremea al cliente | Se acumula `text` para encadenar recetas | -- |

El match credencial-vs-proveedor SI es consistente entre ambos (`run-agent-by-id.ts:191` y
`execution.ts:261`). El token_cap y el timeout se pasan con los mismos valores de config a ambos
caminos; sus **defectos** (H-08 evadible, H-19 no intra-turno) son por tanto comunes a ambos.

---

## 5. Lo que SI es robusto (para no perder perspectiva)

- **No hay fuga de la apiKey en errores**: `ProviderError` copia solo escalares seguros (`code`,
  `providerId`, `status`, `message`) y NUNCA retiene el error crudo del SDK (`errors.ts:1-6,128-136`).
  Verificado por la revision; los mensajes de tool tampoco incluyen el secreto (`signed-tool-fetch.ts`).
- **Cierre por timeout de pared, limpio y bien distinguido**: `sse-runner.ts` separa `clientGone` /
  `timedOut` / error, cierra el timeout con `stop 'timeout' + done` (no como error), y **limpia el
  timer siempre** en el `finally` -- con tests dedicados que verifican la ausencia de fugas
  (`sse-runner-timeout.test.ts`), incluido el caso en que el provider LANZA al abortar. El
  `AbortController` se propaga a `runModel` y a `executeTool`.
- **Las tools nunca tumban el run**: `performSignedToolPost` NUNCA lanza; todo fallo (500, timeout,
  redirect, body invalido) vuelve como `{isError:true}` y el modelo puede continuar. Timeout de 10s por
  tool, `redirect:'manual'` (un 3xx no rebota a IP interna).
- **Defensa anti-SSRF de webhooks solida**: `isForbiddenWebhookUrl` (https + denylist de hostnames) +
  `resolvesToForbiddenIp` (resolucion DNS + matriz de rangos privados/reservados IPv4/IPv6, fail-closed)
  -- con la matriz cubierta en `ip-guard.test.ts` y `webhook-tools.test.ts`. (El TOCTOU DNS queda como
  riesgo residual reconocido.) El hueco es que ese mismo control **no** cubre el `baseUrl` (H-01) ni los
  adjuntos (H-09).
- **Cota de iteraciones respetada**, incluido `maxIterations<=0` (salvaguarda final `run-agent.ts:156`)
  y el corte sin ejecutar la ronda excedente; `validateAgentRun` rechaza history vacio y iteraciones
  fuera de rango.
- **token_cap correcto ENTRE iteraciones**: cuando el proveedor SI reporta `usage`, el corte por uso
  acumulado funciona y no ejecuta la ronda excedente (`run-agent-token-cap.test.ts`). La suma de input
  tokens por-llamada es el conteo de facturacion **correcto** (ver Apendice A).
- **Worker resiliente en su cierre de jobs**: gate por tier server-side, apagado -> re-pending sin
  gastar intento, notificacion de fallo definitivo best-effort que nunca bloquea el cierre, claim
  atomico (`FOR UPDATE SKIP LOCKED`), y `processClaimedJob` que nunca propaga (un job roto no tumba el
  loop).

---

## 6. Cobertura de tests y alcance

**Bien cubierto** (modos de fallo con test real):
- Normalizacion de errores HTTP del proveedor: `errors.test.ts` (matriz 401/403/404/429/400/422/5xx +
  `retryable`), y por-adaptador `anthropic-provider-errors.test.ts`, `openai-provider-errors.test.ts`,
  `openai-compatible-provider-errors.test.ts` (incluido el `baseUrl` requerido no-vacio).
- Timeout de pared, `clientGone`, provider que lanza al abortar, limpieza de timer y evento error:
  `sse-runner-timeout.test.ts`, `sse-runner-outcome.test.ts`.
- token_cap acumulado y por-turno-que-excede, default como cap: `run-agent-token-cap.test.ts`.
  Iteraciones e input vacio: `run-agent-limits.test.ts`, `run-agent.test.ts`.
- Match credencial-vs-proveedor: `run-agent-by-id-credential.test.ts` y worker `execution.test.ts`.
- SSRF de **webhook** de cliente: `ip-guard.test.ts` (matriz IPv4/IPv6, fail-closed) y
  `webhook-tools.test.ts` (IP privada bloqueada, redirect/302 rechazado, timeout, 500, no fuga).
- Recetas del worker: N pasos, encadenamiento, fallo en paso intermedio, deadline por paso, payload
  malformado, gate por tier, corte de contexto por caracteres.

**Huecos de cobertura** (modos de fallo SIN test -- correlacionan 1:1 con los hallazgos):
- **SSRF via `baseUrl`** (H-01): ningun test -- ni codigo -- pasa el `baseUrl` por `ip-guard`. Los
  tests de `assemble-agent-run`/`credential` solo verifican la PRECEDENCIA del `baseUrl`, no su
  seguridad.
- **JSON de tool malformado / stream cortado a mitad de tool** (H-15): `openai-translate-stream.test.ts`
  y `anthropic-provider.test.ts` solo prueban JSON **bien formado** (fragmentos que reensamblan a JSON
  valido). No hay caso de `argsBuffer` invalido ni de buffer incompleto al cierre.
- **tool_use con `finish_reason` no canonico** (H-02): sin test de tool_calls emitidas + finish_reason
  `stop`/`length`/null.
- **Clasificacion retryable en el worker** (H-04): `execution.test.ts` solo usa un `Error` transitorio
  generico; ningun test verifica que un `ProviderError` no-retryable NO se reintente (porque el codigo
  no lo hace).
- **token_cap sin `usage`** (H-08) y **respuesta vacia** (H-05): los tests siempre inyectan `usage`
  explicito; no cruzan el caso "sin usage -> cap inefectivo" ni "stream vacio -> exito".
- **Limites del worker** (H-10, H-23) y **output vacio en recetas** (H-06): sin test de job simple con
  payload gigante, `maxIterations` fuera de rango, ni paso que emite solo `stop` sin texto.
- **SSRF de adjuntos** (H-09): `attachments-extract.test.ts` cubre HTTP no-ok, tamano, timeout y
  archivo corrupto, pero **ningun** caso de URL a IP privada.
- **Backpressure / OOM** (H-03, H-07): sin test de stream masivo ni de body de tool enorme.

**Alcance y limitaciones**: read-only; no se ejecutaron runs reales. La verificacion adversarial de
H-09 (SSRF de adjuntos) fue por evidencia primaria directa mas la revision de cobertura (el
sub-verificador dedicado no concluyo por limite de reintentos de esquema, no por falta de evidencia).
Severidades asignadas con la logica de un motor multi-tenant BYOK (blast radius sobre otros tenants del
mismo proceso pesa mas que costo auto-infligido en la key del propio tenant). Quedan fuera: la
correctitud interna de los SDK de proveedor, el web worker nativo (endpoint de las tools `platform_*`),
y la superficie de creacion de agentes mas alla del `baseUrl`.

---

## Apendice A -- Hallazgo refutado (para trazabilidad)

**R-01 -- "Sobreconteo de input tokens acumulados"** (`run-agent.ts:96`). **REFUTADO.** La hipotesis
era que sumar los `inputTokens` por-turno a traves de iteraciones sobrecuenta tokens unicos (el
historial se reenvia creciente cada turno). Es **correcto, no un bug**: los proveedores facturan el
input POR REQUEST, y el historial reenviado se cobra en cada llamada; la suma es la representacion
exacta del costo facturado (tokens billed), no una inflacion. Unico matiz menor (fuera del alcance del
hallazgo): no se leen los campos de cache de Anthropic, lo que puede sobreestimar el **costo en dolares**
cuando hay prompt caching activo -- no el conteo de tokens. No amerita accion como defecto del motor.
