# Despliegue del servicio relay de teclado movil en Railway

Este documento describe como desplegar el **servicio relay de teclado movil** (`apps/relay`) como un
servicio **separado** en Railway, y las variables de entorno que necesitan **el relay** y **el backend**.

> **Que es (y que NO es).** En telefonos, la vista en vivo de Browserbase no levanta el teclado nativo
> (es un screencast). El usuario teclea en un campo propio de la consola y las pulsaciones se **relevan
> cifradas** hacia el navegador remoto. Es un **relay de conocimiento minimo**, **NO** cifrado extremo a
> extremo: Browserbase recibe el texto legible por CDP. La meta de seguridad es que el texto plano exista
> **solo** en la memoria del proceso relay, el menor tiempo posible, y en ningun otro lugar (ni logs, ni
> disco, ni base, ni otros procesos). En **desktop** no se usa nada de esto: entrada directa al iframe.

## Por que un servicio APARTE (no el backend, no el worker)

El `connectUrl` que el relay abre contra Browserbase **embebe el signing key de la sesion**: el proceso
que hace de relay tiene acceso efectivo a todas las sesiones vivas del proyecto. Por eso se aisla:

- **No en el backend:** es el proceso mas expuesto (ingress publico, todas las rutas, todos los usuarios).
  Llevar la llave maestra de Browserbase ahi ampliaria el dano de cualquier brecha del backend.
- **No en el worker:** hoy no tiene ninguna superficie de entrada desde internet y ademas tiene
  `VAULT_SECRET` (descifra **todos** los contextos guardados). Darle ingress publico seria el peor cambio.
- **Si en un servicio aparte:** hace **una sola cosa** (el upgrade WebSocket del relay), tiene **una sola
  dependencia** externa (`ws`), y es lo bastante chico como para auditarlo por completo.

## Que es el servicio relay

- **Servidor http crudo con un unico proposito:** el upgrade WebSocket del relay. **No** hay rutas HTTP de
  aplicacion (solo `GET /health` de liveness), **no** usa Fastify ni pino: los frames WebSocket jamas
  tocan un logger de plataforma, por diseno (`apps/relay/src/server.ts`).
- **No toca la base de datos.** El token efimero es *stateless* y trae todo lo necesario para validarlo
  (`apps/relay/src/session.ts`); el relay no tiene `DATABASE_URL`. El unico estado compartido (uso unico
  del jti y lock por conexion, B-1) lo media el **backend** por su listener interno: el relay solo habla
  HTTP con ese endpoint, sin acceso a la base (ver *Coordinacion multi-instancia*).
- **Abre su propia conexion CDP.** Durante `esperando_login` ningun proceso mantiene un CDP vivo, asi que
  el relay pide el `connectUrl` con `GET /v1/sessions/{id}` (`apps/relay/src/browserbase.ts`) y abre el
  WebSocket CDP para inyectar `Input.insertText` / `Input.dispatchKeyEvent`.
- **Auditoria solo de metadatos** (id de sesion, timestamps, conteo de eventos, resultado). Ninguna
  llamada al logger con contenido de pulsaciones; los errores se sanitizan antes de emitirse.
- **Shutdown graceful:** `SIGTERM`/`SIGINT` cierran toda sesion viva (y su CDP) antes de salir; sin
  sesiones huerfanas (`apps/relay/src/index.ts`).

## Build y start (Railway)

| Ajuste | Valor |
| --- | --- |
| Build command | `npm ci && npm run build` (el build de la raiz compila `packages/shared` primero y luego `apps/relay`) |
| Start command | `npm start -w apps/relay` (corre `node dist/index.js`) |
| Health check path | `/health` (responde `200 ok`) |
| Puerto | Railway inyecta `PORT`; el relay escucha en el (`0.0.0.0` por `HOST` default) |

> El relay usa el `WebSocket` **cliente** de la libreria `ws` para hablar CDP, asi que **no** necesita el
> flag `--experimental-websocket` del worker.

## Variables de entorno del SERVICIO RELAY (agregar a mano en Railway)

Solo estas. **Nunca** `VAULT_SECRET`, `DATABASE_URL` ni ninguna otra llave de la plataforma.

| Variable | Regla | Para que |
| --- | --- | --- |
| `BROWSERBASE_API_KEY` | obligatoria | Pedir el `connectUrl` de la sesion viva. La MISMA key del worker. |
| `BROWSERBASE_PROJECT_ID` | obligatoria | Proyecto de Browserbase. El MISMO del worker. |
| `RELAY_TOKEN_SECRET` | obligatoria, >= 32 chars | Validar el token efimero Y firmar (HMAC) las llamadas a la autoridad de coordinacion. **Mismo valor exacto** que en el backend. Secreto **separado** de `VAULT_SECRET` y `SESSION_TOKEN_SECRET`. |
| `RELAY_CONSUMO_URL` | **obligatoria en produccion** | URL base de la autoridad de coordinacion (el listener interno del backend) por la **red privada**, p.ej. `http://backend.railway.internal:3001`. Sin ella en produccion el relay **se niega a arrancar** (ver *Coordinacion multi-instancia*). |
| `RELAY_ALLOWED_ORIGINS` | recomendada | Lista separada por comas de los origenes permitidos del upgrade (p.ej. `https://app.ledesma-ai-labs.com`). `*` **solo** en desarrollo. |
| `NODE_ENV` | recomendada (`production`) | En `production` se exige `RELAY_CONSUMO_URL` (refuse-to-start). |
| `HOST` | opcional (default `0.0.0.0`) | Interfaz de escucha. |
| `LOG_LEVEL` | opcional (default `info`) | Nivel del logger de metadatos. |

## Variables a AGREGAR en el servicio BACKEND

El backend **no** habla con Browserbase ni releva pulsaciones: solo **acuna** el token efimero. Necesita:

| Variable | Regla | Para que |
| --- | --- | --- |
| `RELAY_TOKEN_SECRET` | >= 32 chars | Acunar el token que el relay valida Y verificar la MAC de las llamadas del relay a la autoridad de coordinacion. **Mismo valor exacto** que en el relay. |
| `RELAY_PUBLIC_URL` | URL `wss://` | URL publica del servicio relay (p.ej. `wss://relay.ledesma-ai-labs.com`). El endpoint la devuelve al cliente. |
| `RELAY_INTERNAL_PORT` | opcional (default `3001`) | Puerto del **listener interno** del backend (autoridad de coordinacion del relay). Solo alcanzable por la **red privada** de Railway; **no** se mapea al dominio publico. Solo arranca si hay `RELAY_TOKEN_SECRET`. |

> Si **falta cualquiera** de las dos en el backend, `POST /v1/sitios/:id/relay-token` responde
> `501 RELAY_NO_DISPONIBLE` y la consola **cae al aviso** de "hazlo desde una computadora" en tactil. El
> desktop no cambia en absoluto.

## Como la consola DESCUBRE la URL del relay

La consola **no** tiene una env propia para la URL del relay. Cuando el usuario abre el login asistido en
un dispositivo tactil, llama a `POST /v1/sitios/:id/relay-token` (autenticado). La respuesta trae
`{ token, expiresAt, relayUrl }`, donde `relayUrl` es exactamente `RELAY_PUBLIC_URL` del backend. La
consola abre el WebSocket contra esa `relayUrl` y presenta el `token` en el handshake. Asi, cambiar el
dominio del relay es cambiar **una** variable del backend, sin rebuild de la consola.

## Handshake autenticado (A-1)

El handshake del canal es ECDH X25519 **autenticado**: el ECDH por si solo no protege contra un adversario
activo en el proxy que termina TLS (podria sustituir la publica en cada pata y leer cada pulsacion). El
backend acuna, junto al token, un **secreto de enlace** por token (`hs`): lo mete **cifrado dentro del
token** (que el cliente no puede descifrar) y lo devuelve al cliente por **su** canal confiable con el
backend (`POST /v1/sitios/:id/relay-token`), no por el canal del relay. Con el, cliente y relay confirman
la clave con una MAC (HMAC-SHA256) sobre el **transcript** del handshake (las **dos** publicas + el token):

- el **relay** verifica la MAC del cliente y **rechaza** el handshake si no corresponde (una publica
  sustituida cambia el transcript y la MAC no valida);
- el **cliente** verifica la MAC del relay en el `ready` **antes de teclear**, para no hablar con un relay
  impostor.

Un MITM ve el token cifrado pero **no** el secreto de enlace, asi que no puede forjar ninguna de las dos
MAC. Solo se usan primitivas de `node:crypto` (relay) y WebCrypto (cliente); el transcript se arma en el
modulo compartido (`packages/shared/src/relay/protocol.ts`) para que ambos lados coincidan byte a byte.

## Coordinacion multi-instancia (B-1)

El uso unico del token (jti) y el lock "un solo canal por conexion" son **invariantes de seguridad**: si
viven en la memoria de cada proceso, en un **rolling deploy** de Railway (dos instancias solapadas) un
token se consume una vez **por instancia** y se abre un segundo canal a la misma sesion de login. Por eso
esos dos estados se delegan a una **autoridad compartida**: el **backend** los media en su base de datos de
forma **atomica** (`INSERT ... ON CONFLICT`), y el relay **sigue sin `DATABASE_URL`** (solo habla HTTP con
el endpoint interno). Migracion: `apps/backend/migrations/V031__relay_coordinacion.sql`.

- **Endpoint interno de verdad.** La autoridad corre en un **listener separado** del backend
  (`RELAY_INTERNAL_PORT`, default `3001`) que Railway **no** mapea al dominio publico: solo es alcanzable
  por la **red privada** (`backend.railway.internal:<puerto>`). Ademas cada llamada se autentica con una
  **MAC** (HMAC-SHA256 con `RELAY_TOKEN_SECRET`, ventana anti-replay) y hay **rate limit propio** en ese
  listener (defensa en profundidad). El jti viaja **hasheado** (SHA-256); la base guarda solo el hash.
- **Fail-closed.** Si la autoridad no responde, el relay **rechaza el handshake** (nunca cae en silencio a
  estado por proceso).
- **Refuse-to-start.** En produccion, sin `RELAY_CONSUMO_URL` el relay **se niega a arrancar**. Preferimos
  no arrancar antes que operar con estado dividido sin aviso.

### Requisito de despliegue: red privada

El backend y el relay deben estar en el **mismo proyecto y entorno** de Railway para que la red privada
(`*.railway.internal`) los conecte. El backend debe escuchar el listener interno en `::` (ya lo hace).
Configura `RELAY_CONSUMO_URL` del relay apuntando al dominio interno del backend y a `RELAY_INTERNAL_PORT`.

### Lo que sigue best-effort por instancia (NO garantizado con N instancias)

Los contadores de **anti-flood** y de **concurrencia por owner** (`apps/relay/src/rate-limit.ts`) **siguen
en memoria de cada instancia a proposito**: son un amortiguador de abuso, **no** un invariante de
seguridad. Con **multiples instancias** (p.ej. la ventana de un rolling deploy) **estos limites se
multiplican** por la cantidad de instancias: un owner podria abrir hasta `maxPorOwner * N` canales
concurrentes y hasta `maxNuevasPorVentana * N` nuevos por ventana. Es aceptable (frenar abuso masivo no
exige exactitud) y queda escrito aqui para que nadie lo asuma garantizado. Lo que **si** es invariante
(uso unico del jti y un solo canal por conexion) **no** se multiplica: lo hace atomico la autoridad
compartida.
