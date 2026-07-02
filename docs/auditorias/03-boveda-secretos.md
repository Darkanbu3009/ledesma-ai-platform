# Auditoria de seguridad #3 — La boveda y el manejo de secretos

**Fecha:** 2026-07-02
**Alcance:** ciclo de vida COMPLETO de todos los secretos de la plataforma — cifrado de la boveda
(AES-256-GCM), API keys BYOK de clientes, secretos de triggers (HMAC + url_token), session tokens del
widget, `VAULT_SECRET`, `ADMIN_API_TOKEN`, `SESSION_TOKEN_SECRET`, `WEB_WORKER_SECRET`,
`RESEND_API_KEY` y el `webhook_secret` de firma saliente por agente.
**Tipo:** revision de codigo read-only, adversarial. No se modifico codigo. No se ejecuto contra
produccion. No se corrio `npm audit` (queda para la auditoria #14 de dependencias).
**Metodo:** lectura del codigo real de cada punto donde un secreto entra, se cifra/hashea, se
descifra, se compara o se loguea; barrido de patrones (`sk-`, `apiKey`, `==`/`===` sobre tokens,
`console.log` de objetos sensibles); revision de migraciones, tests de cripto/redaccion, `.gitignore`
e historial de git. Cada hallazgo esta verificado contra `path:linea` real y sometido a verificacion
adversarial (intento de refutacion) via un panel de sub-agentes.

> **Nota de redaccion:** este informe NO transcribe ningun secreto real. Donde aparece un valor
> sensible se referencia por ubicacion y tipo, redactado.

---

## 1. Resumen ejecutivo

**Veredicto: los secretos estan BIEN PROTEGIDOS de punta a punta, con excepciones acotadas.**

El nucleo criptografico es solido y disciplinado: AES-256-GCM con IV aleatorio por cifrado, auth tag
verificado, fallo cerrado y uniforme (sin oraculo), redaccion de logs cableada y probada, comparacion
en tiempo constante para el material de auth de triggers, y una bateria de tests "centinela" dedicada
a probar que la API key BYOK NUNCA sale del request. No se encontro **ninguna fuga directa y
explotable de un secreto en claro** por logs, respuestas de API, mensajes de error o base de datos.
No hay secretos reales hardcodeados ni en el codigo ni en el historial de git.

Las excepciones son debilidades de higiene/consistencia y un par de vias condicionales, ninguna de
severidad critica:

| Severidad | Cant. | Hallazgos |
| --- | --- | --- |
| CRITICA | 0 | — |
| ALTA | 0 | — |
| MEDIA | 4 | H-01 comparacion del `ADMIN_API_TOKEN` sensible a timing; H-02 `webhook_secret` del agente en claro en reposo; H-03 `baseURL` BYOK sin validar esquema/host (key puede egresar por HTTP o a host arbitrario); H-04 el `message` crudo de un proveedor puede arrastrar la key hacia el error/SSE (condicional a endpoint hostil) |
| BAJA | 3 | H-05 derivacion de clave con SHA-256 sin sal/KDF; H-06 logger del worker sin redaccion; H-07 `VAULT_SECRET` irremplazable/rotacion no gestionada |
| INFO | 2 | H-08 session token sin revocacion (solo TTL corto); H-09 `webhook_secret` del agente se devuelve en cada GET del agente |

Ninguna requiere accion urgente; H-01, H-02 y H-03 son las de mayor valor para el backlog.

---

## 2. Inventario de secretos del sistema

| Secreto | Que es | Donde vive | Como se protege | Como se compara |
| --- | --- | --- | --- | --- |
| **API key BYOK (guardada)** | La key del proveedor del cliente (Anthropic/OpenAI/compatible) que guarda en la boveda | `provider_credentials.encrypted_key` (V006) | **Cifrada** AES-256-GCM bajo `VAULT_SECRET`. Descifrada solo server-side, acotada por `owner_id`. Nunca en respuestas (solo metadata) | No se compara (se usa para llamar al proveedor) |
| **API key BYOK (al momento)** | La misma key pegada en el request | Header `x-provider-key`, variable local en memoria del request | Nunca persiste. Redactada en logs (pino). No vuelve en respuestas | — |
| **Secreto HMAC de trigger** | Clave con la que el cliente firma sus webhooks entrantes | `triggers.hmac_secret_encrypted` (V012) | **Cifrado** AES-256-GCM bajo `VAULT_SECRET`. Se muestra en claro UNA vez al crear/rotar | Se descifra y se usa en `verifyWebhookSignature` (HMAC-SHA256, `timingSafeEqual`) |
| **url_token de trigger** | Token impredecible que viaja en la URL del webhook | `triggers.url_token_hash` (V012) | **Hasheado** SHA-256 (irreversible). Token en claro se muestra UNA vez | `timingSafeEqualHex(hash(presentado), hash_guardado)` — tiempo constante |
| **Session token del widget** | Token efimero que lleva la provider key cifrada adentro | No persiste (stateless) | **Cifrado** AES-256-GCM bajo `SESSION_TOKEN_SECRET`. Integridad por auth tag GCM (no forjable sin el secreto) | Descifrado; validacion de `agentId`/`exp`; 401 generico |
| **`VAULT_SECRET`** | Secreto maestro de la boveda | Env var (Railway) | Requerido, min 32 chars. Deriva la clave AES via SHA-256. App falla al arrancar si falta | `!==` contra el header **NO** — no se compara con requests; es solo material de derivacion |
| **`SESSION_TOKEN_SECRET`** | Cifra los session tokens | Env var | Requerido, min 32 chars | Idem VAULT (solo deriva clave) |
| **`ADMIN_API_TOKEN`** | Autoriza los endpoints admin | Env var, header `x-admin-token` | Requerido, min 16 chars. Redactado en logs | **`!==` — comparacion sensible a timing** (H-01) |
| **`webhook_secret` del agente** | Firma los POST SALIENTES a las tools-webhook del cliente (`whsec_...`) | `agents.webhook_secret` (V004) | **En claro en reposo** (H-02). Generado por la base (`gen_random_bytes`). Solo viaja como firma derivada al webhook | No se compara (solo firma con HMAC-SHA256) |
| **`WEB_WORKER_SECRET`** | Firma los POST al worker nativo de plataforma | Env var | Opcional, min 32 chars. No se loguea | Solo firma (HMAC) |
| **`RESEND_API_KEY`** | Key de la API de correo (alertas del worker) | Env var (worker) | Opcional. Viaja como `Bearer` solo al endpoint fijo de Resend. Nunca se loguea | — |
| **JWT de Supabase** | Identidad del usuario (Bearer) | Header `authorization` | Verificado contra JWKS de Supabase (ES256). Redactado en logs | Firma verificada por `jose` |

---

## 3. Hallazgos

### H-01 — La comparacion del `ADMIN_API_TOKEN` es sensible a timing (`!==`, no tiempo constante) · MEDIA

- **Ubicacion:** `apps/backend/src/auth/require-admin.ts:12`,
  `apps/backend/src/routes/admin-agents.ts:32`, `apps/backend/src/routes/registration.ts:34`.
- **Evidencia:**
  ```ts
  if (typeof token !== 'string' || token !== config.ADMIN_API_TOKEN) {
    throw new AppError('UNAUTHORIZED', 401, 'Invalid or missing admin token');
  }
  ```
  Las tres guardas de super-admin comparan el token presentado con `!==` (comparacion de strings de
  JS, que hace short-circuit en el primer byte distinto). Contraste directo: el material de auth de
  triggers SI usa tiempo constante (`trigger-auth.ts:58-62` `timingSafeEqualHex` /
  `webhook-signature.ts:21` `timingSafeEqual`), e incluso hay un test estructural que lo exige
  (`trigger-auth.test.ts:153-168`). El token admin queda fuera de esa disciplina.
- **Explotabilidad:** un canal lateral de timing sobre red es dificil de explotar en la practica (el
  jitter de red y de V8 domina la senal de nanosegundos del short-circuit), y el token exige min 16
  chars de entropia, asi que aun con un oraculo perfecto la fuerza bruta es impractica. Es una
  desviacion clara de la norma del propio codebase, no una fuga inmediata.
- **Recomendacion (no aplicar aqui):** comparar con `crypto.timingSafeEqual` sobre buffers de igual
  longitud (o comparar `sha256(presentado)` vs `sha256(esperado)` como hace `timingSafeEqualHex`),
  centralizando la guarda admin en un unico helper. Agregar un test estructural analogo al de
  triggers.

### H-02 — El `webhook_secret` de firma saliente del agente se guarda EN CLARO en reposo · MEDIA

- **Ubicacion:** `apps/backend/migrations/V004__webhook_secret.sql:5-6`;
  `apps/backend/src/agents/agent-repository.ts:40,165` (columna `webhook_secret` leida/rotada en
  claro).
- **Evidencia:**
  ```sql
  add column if not exists webhook_secret text not null
  default ('whsec_' || encode(gen_random_bytes(24), 'hex'));
  ```
  A diferencia de TODOS los demas secretos del sistema —`encrypted_key` (cifrado, V006),
  `hmac_secret_encrypted` (cifrado, V012), `url_token_hash` (hasheado, V012)— el `webhook_secret` del
  agente se persiste en texto plano. Es el secreto con el que la plataforma firma (HMAC-SHA256) cada
  POST saliente a las tools-webhook del cliente, para que el cliente verifique el origen.
- **Explotabilidad:** requiere comprometer la base (o una fuga de un backup/consulta). Con el
  `webhook_secret` en claro, un atacante puede **forjar peticiones firmadas** que el servidor-webhook
  del cliente aceptaria como legitimas de la plataforma (suplantacion). No expone la API key BYOK; el
  impacto es sobre la integridad de las llamadas salientes a tools. La superficie es "secreto en claro
  en reposo", el resto del sistema cifra sus secretos.
- **Recomendacion:** cifrarlo en reposo con `VAULT_SECRET` (mismo patron que la boveda) y descifrarlo
  solo para mostrarlo/firmar; o, si se prefiere mantenerlo legible por diseno (se muestra repetidamente
  en "Conectar"), documentar explicitamente la decision de riesgo y compensar con controles de acceso
  a la base. Ver tambien H-09 (se devuelve en cada GET).

### H-03 — `baseURL` BYOK (openai-compatible) sin validar esquema/host: la key puede egresar por HTTP o a un host arbitrario · MEDIA

- **Ubicacion:** `apps/backend/src/providers/openai-compatible/openai-compatible-provider.ts:22-28`;
  origen del `baseUrl`: `apps/backend/src/routes/credentials.ts:19` y
  `apps/backend/src/routes/agents.ts:53` (`z.string().url()` acepta `http://`), y el header
  `x-provider-base-url` del plano publico.
- **Evidencia:**
  ```ts
  const baseURL = input.credentials.baseUrl;
  ...
  const client = new OpenAI({ apiKey: input.credentials.apiKey, baseURL });
  ```
  El SDK de OpenAI envia la `apiKey` como `Authorization: Bearer` a ese `baseURL`. La validacion
  aguas arriba (`z.string().url()`) admite `http://` y cualquier host, incluidos privados/internos.
  A diferencia de las tools-webhook —que tienen guarda anti-SSRF por hostname y por IP resuelta
  (`tools/webhook-tools.ts` + `ip-guard.ts`)— el endpoint del MODELO no pasa por ninguna guarda.
- **Explotabilidad:** es un escenario BYOK auto-infligido (la key y el endpoint los define el mismo
  usuario dueno de la key). Pero habilita dos cosas concretas: (a) mandar la key BYOK en **texto claro
  por HTTP** si el usuario configura un `http://`; (b) que la key se dirija a un host arbitrario. En un
  contexto multi-tenant, un endpoint compatible malicioso registrado por un usuario recibe su propia
  key, pero tambien puede ser un vector de exfiltracion/SSRF hacia infra interna via el fetch del
  proveedor.
- **Recomendacion:** exigir `https://` para `baseUrl`/`x-provider-base-url` (rechazar `http://`) y
  aplicar la misma guarda anti-SSRF (hostname + IP resuelta) que ya existe para las tools-webhook.

### H-04 — El `message` crudo de un error de proveedor puede arrastrar la key hacia el evento de error / logs (condicional) · MEDIA

- **Ubicacion:** `apps/backend/src/providers/errors.ts:78-86,133` (`getMessage` copia el
  `error.message` del SDK tal cual); reenvio al cliente: `apps/backend/src/routes/sse-runner.ts:145-156`
  (evento `error` con `message`); log: `sse-runner.ts:161-164` y worker `execution.ts:159-161`
  (`describeError` = `name: message`).
- **Evidencia:**
  ```ts
  function getMessage(error: unknown): string {
    // ... devuelve error.message del SDK sin sanitizar
  }
  ...
  const message = providerMessage !== '' ? providerMessage : DEFAULT_MESSAGES[code];
  return new ProviderError({ code, providerId, message, status });
  ```
  `toProviderError` descarta el objeto crudo del SDK (bien: los headers con la credencial no se
  retienen — ver `errors.ts:1-6`), pero conserva `error.message`. Ese `message` se envia al cliente en
  el evento SSE `error` y se loguea.
- **Explotabilidad:** condicional a un endpoint hostil/mal comportado. La Authorization/key NO esta en
  `error.message` para los SDK oficiales de Anthropic/OpenAI (el test centinela lo confirma para el
  caso 401, `byok-sentinel.test.ts:156-179`). El riesgo real es con **openai-compatible**: un endpoint
  de terceros que refleje la peticion (incluida la cabecera Authorization) en el cuerpo del error, que
  el SDK podria exponer en `error.message`. El impacto esta acotado: la fuga vuelve por el SSE/logs del
  **mismo dueno** de la key. Aun asi rompe el invariante "el secreto nunca aparece en un mensaje de
  error" para endpoints no confiables.
- **Recomendacion:** sanitizar `error.message` antes de reenviarlo/loguearlo (recortar longitud y
  filtrar patrones tipo `sk-`, `Bearer`, `whsec_`), o para el evento SSE usar `DEFAULT_MESSAGES[code]`
  en vez del texto crudo del proveedor. Extender el test centinela a un `message` que contenga el
  centinela.

### H-05 — Derivacion de clave con SHA-256 de una sola pasada, sin sal ni KDF · BAJA

- **Ubicacion:** `apps/backend/src/crypto/aes-gcm.ts:21-23`.
- **Evidencia:**
  ```ts
  export function deriveKey(secret: string): Buffer {
    return createHash('sha256').update(secret).digest(); // 32 bytes para aes-256-gcm
  }
  ```
  La clave AES-256 se deriva con un unico SHA-256 del secreto, sin sal ni estiramiento (el comentario
  del test lo dice: "sin sal ni iteraciones", `aes-gcm.test.ts:48`).
- **Explotabilidad:** es correcto y estandar **si** el secreto es de alta entropia (una clave
  aleatoria de 32+ bytes no necesita un KDF lento). El riesgo es que `VAULT_SECRET`/`SESSION_TOKEN_SECRET`
  solo se validan por LONGITUD (`min(32)`, `config/env.ts:17,24`), no por entropia: un operador podria
  poner 32 caracteres de baja entropia (p.ej. repetidos) y la clave derivada seria adivinable por
  fuerza bruta sobre el secreto. Ademas no hay separacion de dominio via sal/HKDF (mitigado en la
  practica porque cada uso tiene su propia env var distinta).
- **Recomendacion:** documentar/forzar que los secretos maestros sean aleatorios de alta entropia
  (p.ej. `openssl rand -hex 32`); opcionalmente derivar con HKDF con `info` por dominio para separacion
  formal. No cambia el formato de tokens existentes si se mantiene el esquema para lo ya cifrado.

### H-06 — El logger del worker no tiene redaccion · BAJA

- **Ubicacion:** `apps/worker/src/logger.ts:26-40` (logger propio, sin `redact`), vs.
  `apps/backend/src/logger.ts` + `server.ts:38` (pino con `redact` en el backend).
- **Evidencia:** el `createLogger` del worker serializa `JSON.stringify({ level, msg, ...meta })` sin
  ninguna lista de censura. Hoy es seguro: el worker solo loguea ids, contadores y `err.message`
  (`execution.ts:159-161` `describeError`, `alertas.ts`), nunca headers, cuerpos ni la key. La
  resolucion de la credencial (`resolveStoredCredential`) devuelve la key pero no la loguea.
- **Explotabilidad:** ninguna hoy; es ausencia de red de seguridad. Si manana alguien agrega un
  `logger.info('...', { credential })` o loguea un objeto con la key, no hay nada que lo censure (a
  diferencia del backend).
- **Recomendacion:** o bien compartir el logger pino del backend con `redact` (como ya se anticipa en
  el comentario de `worker/src/logger.ts:21-24`), o agregar una lista de censura equivalente.

### H-07 — `VAULT_SECRET` irremplazable y sin gestion de rotacion · BAJA

- **Ubicacion:** `apps/backend/src/config/env.ts:18-24`;
  `apps/backend/src/credentials/provider-credential-repository.ts:117-124`.
- **Evidencia:** al descifrar, `getDecryptedKeyForOwner` devuelve `null` ante cualquier fallo
  (fail-closed, correcto). Pero eso significa que **rotar `VAULT_SECRET` deja TODAS las
  `encrypted_key`/`hmac_secret_encrypted` existentes indescifrables en silencio** (las credenciales
  pasan a resolver `null` → 404, los triggers hmac fallan la auth): no hay versionado de clave ni
  migracion. El comentario de `env.ts:18-24` explica que es separada de `SESSION_TOKEN_SECRET` para
  rotar independientemente, pero no documenta que perderla/rotarla equivale a perder la boveda.
- **Explotabilidad:** no es una fuga; es un riesgo operativo (footgun) y de disponibilidad.
- **Recomendacion:** documentar de forma prominente que `VAULT_SECRET` es irremplazable (perderlo =
  perder toda la boveda) y que rotarlo exige re-cifrar todo; si se quiere soportar rotacion, introducir
  un identificador de version de clave en el token cifrado.

### H-08 — Session token sin revocacion; mitigacion unica es el TTL corto · INFO

- **Ubicacion:** `apps/backend/src/auth/session-token.ts:13-28`.
- **Evidencia:** el token es stateless y lleva la provider key cifrada adentro; la unica mitigacion
  ante fuga del token es su expiracion (default 900s, max 3600s). No hay lista de revocacion. Esta
  documentado explicitamente como decision de diseno.
- **Explotabilidad:** si un token se filtra, la key es usable hasta que expire. Aceptable por diseno
  (TTL corto + la key va cifrada, no en claro dentro del token).
- **Recomendacion:** ninguna urgente; considerar TTL default aun mas corto para casos sensibles.

### H-09 — El `webhook_secret` del agente se devuelve en cada GET del agente y en el modo autonomo del configurador · INFO

- **Ubicacion:** `apps/backend/src/agents/agent-repository.ts:40` (`rowToConfig` siempre incluye
  `webhookSecret`); rutas `apps/backend/src/routes/agents.ts:67-77` (`GET /v1/agents`,
  `GET /v1/agents/:id`) y el configurador.
- **Evidencia:** todo `AgentConfig` serializado incluye `webhookSecret: row.webhook_secret`. Se
  devuelve en cada listado/detalle del agente, no solo una vez.
- **Explotabilidad:** NO es una fuga cross-tenant: las consultas estan acotadas por `owner_id`, asi
  que un usuario solo recibe su propio secreto (es su clave de firma, la necesita para configurar la
  verificacion en su servidor-webhook — patron legitimo, como el "signing secret" de Stripe). El
  matiz es que, combinado con H-02 (en claro en reposo), el secreto viaja por la red en cada fetch del
  agente y queda residente en el navegador, en vez de mostrarse una sola vez como el secreto de trigger.
- **Recomendacion:** valorar mostrarlo una sola vez (como el secreto de trigger) y exponer solo un
  prefijo/huella en los GET subsiguientes; o cifrarlo en reposo (H-02).

---

## 4. Lo que SI esta bien protegido

- **Cifrado de la boveda (`crypto/aes-gcm.ts`).** AES-256-GCM. IV **aleatorio de 12 bytes por
  cifrado** (`randomBytes`, `encryptToToken:31`) → el mismo plaintext produce tokens distintos (probado,
  `aes-gcm.test.ts:69-75`); **sin reuso de nonce**. Auth tag de 16 bytes **verificado al descifrar**
  (`setAuthTag`, `decryptFromToken:51`). Fallo **cerrado y uniforme**: cualquier error (formato, truncado,
  tag invalido, secreto incorrecto) lanza el MISMO error generico sin distinguir el modo (evita oraculo)
  y sin exponer el secreto ni el plaintext (`decryptFromToken:53-55`, probado `aes-gcm.test.ts:84-118`).
- **API key BYOK.** Cifrada en reposo (`provider_credentials.encrypted_key`); el `SELECT` de metadata
  jamas pide `encrypted_key` (`provider-credential-repository.ts:70-96`); se descifra solo server-side y
  acotado por `owner_id` (aislamiento entre tenants); nunca se serializa a HTTP. Los adaptadores de
  proveedor construyen el cliente con la key y **no la retienen ni la loguean**
  (`anthropic-provider.ts:22-28`, `openai-provider.ts:16-30`). `toProviderError` descarta el objeto crudo
  del SDK (que podria traer headers con la credencial). El test **`byok-sentinel.test.ts`** prueba, con
  valores centinela, que la key no aparece en logs, ni en el SSE, ni hacia el webhook, ni en sobres de
  error, en cinco escenarios.
- **Secretos de triggers.** `hmac_secret` cifrado (AES-GCM), `url_token` hasheado (SHA-256,
  irreversible); el `SELECT` de metadata nunca trae el material de auth (`triggers-repository.ts`); se
  muestran en claro **una sola vez** al crear/rotar; comparacion en **tiempo constante**
  (`timingSafeEqualHex` / `timingSafeEqual`); ventana anti-replay; 404 generico para trigger inexistente
  o inactivo (no filtra existencia). Cobertura de tests amplia (`trigger-auth.test.ts`), incluida una
  prueba **estructural** de que no se usa `==` sobre el hash.
- **Session tokens.** Cifrados con AES-GCM bajo `SESSION_TOKEN_SECRET`; **no forjables** sin el secreto
  (el auth tag GCM autentica el payload); verificacion con 401 generico sin filtrar el motivo.
- **Redaccion de logs.** `loggerRedaction` esta **realmente cableada** al pino de Fastify
  (`server.ts:38-39`), no es letra muerta. Censura `authorization`, `x-api-key`, `x-provider-key`,
  `x-provider-base-url`, `x-admin-token`, `x-session-token`, `x-trigger-token`, `cookie`, `set-cookie`,
  `apiKey`/`api_key`/`key`, en `req.headers`/`req.body` y en variantes de primer nivel; ademas
  `sanitizeLoggedUrl` redacta el `?token=` del webhook entrante. Probado en `logging-redaction.test.ts`
  y en el bloque de sanidad de `byok-sentinel.test.ts`.
- **Manejo de errores.** El error handler devuelve mensaje generico en produccion
  (`error-handler.ts:47,57`); los eventos SSE de error solo llevan `{code, message, providerId, status}`
  (`sse-runner.ts:145-159`); los logs de error del run solo llevan `{name, message}` (nunca la key ni el
  ciphertext).
- **Higiene del repo.** No hay secretos reales hardcodeados (los `sk-...` que aparecen son fixtures de
  test obviamente falsos y centinelas con el fragmento `SENTINEL`). `.env.example` solo tiene
  placeholders (`cambia-esto-...`). `.env`, `.env.*` (excepto `.env.example`) y
  `scripts/validacion-e2e/salida/` estan en `.gitignore` y **no trackeados** (`git ls-files` confirma
  que solo `.env.example` esta versionado). El historial de git no contiene ningun secreto real
  (barrido `-S` sobre prefijos comunes: cero coincidencias).
- **Frontend (consola/widget).** Todos los secretos viven en **estado transitorio de React**, nunca en
  `localStorage`/`sessionStorage` ni `console.log`: el `SecretRevealDialog` (muestra el secreto una vez,
  no lo persiste), el `CredentialFormDialog` (`apiKey` en `useState`, `autoComplete="off"`, arranca
  limpio), `configurator.ts` y `triggers.ts` (comentarios y codigo lo confirman). `snippets.ts` usa
  placeholders (`TU_API_KEY_DEL_PROVEEDOR`).
- **Arranque.** `VAULT_SECRET`, `SESSION_TOKEN_SECRET` y `ADMIN_API_TOKEN` son **requeridos** y
  validados por longitud; la app **falla cerrado** al arrancar si faltan (`config/env.ts` +
  `index.ts:4-12`). Los errores de validacion de env logean solo los `path`+`message` de Zod, **nunca el
  valor** del secreto. Ningun secreto se loguea al arrancar. `RESEND_API_KEY` viaja como `Bearer` solo al
  endpoint fijo de Resend (`alertas.ts:249-253`) y nunca se loguea. El cliente Postgres no habilita
  logging de queries/parametros (`db/client.ts:11`, sin `debug`).

---

## 5. Cobertura y alcance

**Auditado (leido linea a linea):** `crypto/aes-gcm.ts`; boveda (`provider-credential-repository.ts`,
`resolve-stored-credential.ts`, ruta `credentials.ts`, migracion V006); triggers (`trigger-auth.ts`,
`webhook-signature.ts`, `webhook-url.ts`, `triggers-repository.ts`, rutas `triggers.ts` /
`incoming-triggers.ts`, migracion V012); session tokens (`session-token.ts`, ruta `session-tokens.ts`);
auth (`require-admin.ts`, `require-user.ts`, `jwt-verifier.ts`); admin (`admin-agents.ts`,
`registration.ts`); config (`config/env.ts`, `worker/src/env.ts`); loggers backend/worker + wiring
(`server.ts`); error handling (`error-handler.ts`, `app-error.ts`, `providers/errors.ts`); proveedores
(anthropic/openai/openai-compatible); ejecucion (`assemble-agent-run.ts`, `run-agent-by-id.ts`,
`sse-runner.ts`); worker (`worker.ts`, `execution.ts`, `index.ts`, `alertas.ts`, `db.ts`); firma
saliente (`webhook-tools.ts`, migracion V004, `agent-repository.ts`, ruta `agents.ts`); frontend
(`SecretRevealDialog.tsx`, `CredentialFormDialog.tsx`, `lib/configurator.ts`, `lib/triggers.ts`,
`lib/credentials.ts`, `snippets.ts`); tests (`aes-gcm.test.ts`, `logging-redaction.test.ts`,
`byok-sentinel.test.ts`, `trigger-auth.test.ts`, `credentials-route.test.ts`); `.gitignore`,
`.env.example`, historial de git. Barridos de patrones sobre todo el repo (`sk-`, `whsec_`, `Bearer`,
`==`/`===`/`.equals` sobre tokens, `console.*`).

**Fuera de alcance:** dependencias/`npm audit` (auditoria #14); seguridad de RLS a nivel Postgres mas
alla de lo que toca la boveda; auditoria de la infra de despliegue (Railway/Supabase) y sus roles.

**Verificacion adversarial:** cada hallazgo fue sometido a un intento de refutacion contra el codigo
real; los reportados sobrevivieron con la severidad indicada. No se reportan debilidades teoricas que
no apliquen al codigo concreto.

**Confianza global:** alta. El nucleo cripto y el manejo de la key BYOK son solidos y estan bien
probados; las excepciones son de consistencia/higiene (H-01, H-02, H-05, H-06), una via de egreso
configurable (H-03), una via condicional a endpoint hostil (H-04) y riesgos operativos/de diseno
documentados (H-07, H-08, H-09). **No se encontro ninguna fuga directa de un secreto en claro.**
