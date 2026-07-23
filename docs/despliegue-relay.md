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
  (`apps/relay/src/session.ts`); el relay no tiene `DATABASE_URL`.
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
| `RELAY_TOKEN_SECRET` | obligatoria, >= 32 chars | Validar el token efimero. **Mismo valor exacto** que en el backend. Secreto **separado** de `VAULT_SECRET` y `SESSION_TOKEN_SECRET`. |
| `RELAY_ALLOWED_ORIGINS` | recomendada | Lista separada por comas de los origenes permitidos del upgrade (p.ej. `https://app.ledesma-ai-labs.com`). `*` **solo** en desarrollo. |
| `HOST` | opcional (default `0.0.0.0`) | Interfaz de escucha. |
| `LOG_LEVEL` | opcional (default `info`) | Nivel del logger de metadatos. |

## Variables a AGREGAR en el servicio BACKEND

El backend **no** habla con Browserbase ni releva pulsaciones: solo **acuna** el token efimero. Necesita:

| Variable | Regla | Para que |
| --- | --- | --- |
| `RELAY_TOKEN_SECRET` | >= 32 chars | Acunar el token que el relay valida. **Mismo valor exacto** que en el relay. |
| `RELAY_PUBLIC_URL` | URL `wss://` | URL publica del servicio relay (p.ej. `wss://relay.ledesma-ai-labs.com`). El endpoint la devuelve al cliente. |

> Si **falta cualquiera** de las dos en el backend, `POST /v1/sitios/:id/relay-token` responde
> `501 RELAY_NO_DISPONIBLE` y la consola **cae al aviso** de "hazlo desde una computadora" en tactil. El
> desktop no cambia en absoluto.

## Como la consola DESCUBRE la URL del relay

La consola **no** tiene una env propia para la URL del relay. Cuando el usuario abre el login asistido en
un dispositivo tactil, llama a `POST /v1/sitios/:id/relay-token` (autenticado). La respuesta trae
`{ token, expiresAt, relayUrl }`, donde `relayUrl` es exactamente `RELAY_PUBLIC_URL` del backend. La
consola abre el WebSocket contra esa `relayUrl` y presenta el `token` en el handshake. Asi, cambiar el
dominio del relay es cambiar **una** variable del backend, sin rebuild de la consola.

## Instancia unica

El uso unico del token (jti consumido) y el rate limiting viven **en memoria** del proceso relay, asi que
el servicio esta pensado para **una instancia**. Escalar a N replicas exigiria estado compartido (p.ej.
Redis) para el conjunto de jti consumidos y los contadores por owner; hoy no aplica.
