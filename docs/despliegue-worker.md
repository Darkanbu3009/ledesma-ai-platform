# Despliegue del worker en Railway (Fase 5.2)

Este documento describe como desplegar el **worker de ejecucion autonoma** (`apps/worker`) como un
servicio SEPARADO en Railway. Es **aditivo**: no cambia la logica del worker (el motor, el loop, los
reintentos, las recetas), solo documenta el build, el start y las variables de entorno que el servicio
necesita.

**Por que este documento.** El worker ya corre en local y pasa sus tests, pero NUNCA se ha desplegado.
Hasta que este proceso corra en produccion, la autonomia (scheduler pg_cron + triggers) **encola** jobs
pero nadie los **ejecuta**: la cola crece y no pasa nada. Este servicio es la pieza que consume la cola.

> El scheduler (`docs/scheduler-pgcron.md`) y los triggers (`docs/triggers.md`) solo **producen** jobs.
> Este worker es el unico que los **consume** y ejecuta.

## Que es el worker

- **Proceso de background puro.** No sirve HTTP: no abre ningun puerto ni expone endpoints (revisar
  `apps/worker/src/index.ts` y `worker.ts`: no hay Fastify ni `listen`). El `setInterval` del loop
  (`worker.ts:59`) es lo que mantiene vivo el proceso.
- **Consume la MISMA base que el backend.** Se conecta por `DATABASE_URL` al pooler de Supabase
  (`apps/worker/src/db.ts:13`, `prepare:false`, `max:5`) y toma jobs de la cola `jobs` (V008).
- **Reusa el motor del backend** via el subpath `@ledesma-platform/backend/execution` (mismo
  `assembleAgentRun` / `runAgent` / boveda que la ruta HTTP, sin duplicar logica).
- **Shutdown graceful ya implementado** (`apps/worker/src/index.ts:65-84`): maneja `SIGTERM` y
  `SIGINT`, detiene el loop, devuelve el job en curso a `pending`, cierra el pool con tope de drenaje
  y tiene un watchdog de 10s. Railway manda `SIGTERM` al redesplegar, asi que un redespliegue no
  corrompe el job en vuelo (se re-reclama).

## Build en el monorepo: orden obligatorio

El worker importa dos paquetes del workspace que deben estar **compilados** antes de que el worker
compile Y antes de que arranque en runtime:

| Import (en `apps/worker/src/index.ts`) | Resuelve a | Lo produce |
| --- | --- | --- |
| `@ledesma-platform/shared` | `packages/shared/dist/index.js` | `npm run build -w packages/shared` |
| `@ledesma-platform/backend/execution` | `apps/backend/dist/execution/index.js` | `npm run build -w apps/backend` |

Orden requerido: **`shared` -> `backend` -> `worker`** (documentado tambien en
`apps/backend/src/execution/index.ts:14`).

### Parche de dependencia en el build del worker (obligatorio para la tarea web)

`apps/worker` tiene `"parche": "cd ../.. && patch-package --error-on-fail --error-on-warn"`
encadenado en su `build` (`apps/worker/package.json:8-10`). Aplica
`patches/@browserbasehq+stagehand+3.6.0.patch`, que corrige el arbol de accesibilidad de Stagehand
para que el modelo no reciba identificadores que su propio esquema de `act` va a rechazar (ver
`apps/worker/README.md`). Sin el parche, la tarea web falla de forma determinista en las paginas que
producen nodos sin `encodedId`.

El Build Command de este servicio es `npm run build` en la raiz, que encadena
`npm run build --workspaces` y por tanto el `build` del worker, asi que **no hay ningun paso manual
que agregar en Railway**. Tres condiciones que si hay que respetar:

- **NO devolverlo a un `postinstall`.** `npm ci` en la raiz corre el `postinstall` de la raiz **y el
  de cada workspace**, y Vercel corre `npm ci` en la raiz para construir `apps/console`, que no usa
  Stagehand. Enganchado a un `postinstall`, el parche del worker tumba el build de la consola
  (`sh: line 1: patch-package: command not found`, exit 127). Colgado del `build` del worker, Vercel
  ni lo ve.
- **`patch-package` vive en las `dependencies` del worker, no en `devDependencies`**
  (`apps/worker/package.json:17`). Railway instala en modo produccion (su log avisa
  `npm warn config production Use --omit=dev instead`) y ahi las `devDependencies` se omiten: como
  devDependency el binario no existiria. Verificado con `NODE_ENV=production npm ci --omit=dev`: con
  la dependencia en `dependencies`, `patch-package` queda en `node_modules/.bin` y el parche aplica.
- **Los flags `--error-on-fail --error-on-warn` no son opcionales.** Fuera de CI, `patch-package`
  imprime el error de un parche que no aplica y **sale con codigo 0**: el despliegue quedaria verde
  con un worker sin parchear. Con los flags, el build se detiene.

Y si aun asi el parche no llegara al contenedor (build saltado, `node_modules` reinstalado despues
del build), **el worker no arranca**: `apps/worker/src/parche-stagehand.ts` comprueba en el arranque
el `formatTreeLine` real de `node_modules` y, si no esta parcheado, imprime el motivo y sale con
codigo 1 antes de tocar la base. Un despliegue sin parche se ve en los logs al instante en vez de
fallar mas tarde dentro de una tarea web.

El `build` del root ya respeta ese orden. `package.json:17`:

```
"build": "npm run build -w packages/shared && npm run build --workspaces --if-present"
```

Construye `shared` explicito primero y luego todos los workspaces; el orden efectivo verificado es
`shared -> backend -> console -> worker -> ...`, asi que cuando el worker compila, el `dist/` de
`backend` y `shared` ya existe. `npm run build` produce `apps/worker/dist/index.js`.

> **Runtime, no solo build.** En produccion el proceso corre `node dist/index.js`, que importa el
> `dist/` de `backend` y `shared` en caliente. Por eso el servicio del worker tiene que construir el
> workspace completo (o al menos `shared` + `backend` + `worker`): esos `dist/` deben estar presentes
> en la imagen desplegada, no solo el del worker.

## Como esta desplegado el backend (a espejar)

No existe ningun `railway.json`, `nixpacks.toml`, `Dockerfile` ni `Procfile` en el repo (busqueda
repo-wide, cero resultados). Es decir, el **backend se despliega con autodeteccion de Railway
(Nixpacks)** y los comandos de build/start configurados a mano en el servicio.

Para espejarlo, el worker se configura **igual: sin archivo de config, con los comandos puestos a mano
en el servicio de Railway** (mas abajo). Un `railway.json` en la raiz lo tomaria tambien el servicio
del backend, asi que aca se documentan los comandos en vez de crear un archivo que colisione. Si mas
adelante se quiere config-as-code, ver la seccion opcional al final.

## Configuracion del servicio en Railway

Crear un **servicio nuevo** en el mismo proyecto de Railway, apuntando al mismo repo. Ajustes:

| Ajuste | Valor |
| --- | --- |
| **Root Directory** | `/` (raiz del repo; necesario para que resuelvan los workspaces de npm) |
| **Builder** | Nixpacks (autodeteccion; detecta `package-lock.json` y corre `npm ci`) |
| **Build Command** | `npm run build` |
| **Start Command** | `npm run start -w apps/worker` |
| **Health check** | ninguno (proceso de background, no sirve HTTP) |
| **Restart Policy** | `On Failure` (que Railway reinicie si el proceso muere) |

### Build command

```
npm run build
```

Construye todo el workspace en orden (`shared -> backend -> worker`). Es el mismo comando que corre CI.

Alternativa mas liviana (solo lo que el worker necesita, sin `console` ni widgets):

```
npm run build -w packages/shared && npm run build -w apps/backend && npm run build -w apps/worker
```

### Start command

```
npm run start -w apps/worker
```

Equivale a `node --experimental-websocket dist/index.js` dentro de `apps/worker` (ver
`apps/worker/package.json`). Si se invoca `node` a mano, hay que conservar el flag: en Node 20 el
`WebSocket` global (que usa la navegacion CDP de los sitios conectados, `src/cdp.ts`) existe solo
detras de `--experimental-websocket`; sin el, los jobs de sitios fallan con un mensaje que apunta a
este flag (el resto del worker no lo necesita).

## Variables de entorno

Lista EXACTA de lo que lee el worker. Todas se validan en `apps/worker/src/env.ts` (`EnvSchema`,
lineas 10-33), que es el **unico** punto donde el worker lee `process.env`. Si falta una obligatoria o
esta mal formada, `parseEnv` lanza y el proceso hace `exit(1)` **al arrancar** (verificado: sin
`VAULT_SECRET` el proceso imprime "Configuracion de entorno invalida" y sale).

### Obligatorias (sin ellas el worker NO arranca)

| Variable | Regla | De donde sacar el valor | Para que |
| --- | --- | --- | --- |
| `DATABASE_URL` | string no vacio (`env.ts:15`) | La MISMA que el backend: connection string del pooler de Supabase (rol de servicio, `?pgbouncer=true`/modo transaction, mismo host que usa el backend) | Cola de jobs y toda lectura/escritura, incluido el gate por tier (`getProfileTier` corre `select tier from profiles` sobre este cliente, no via cliente Supabase) |
| `VAULT_SECRET` | string de **32+ caracteres** (`env.ts:18`) | La MISMA que el backend: secreto maestro de la boveda | Descifra (AES-256-GCM) la credencial guardada de cada job para ejecutar sin humano presente |

### Con default / opcionales (el worker arranca sin ellas)

| Variable | Default / regla | Para que |
| --- | --- | --- |
| `NODE_ENV` | `development` (`env.ts:11`) | En prod conviene `production` (enum: `development`/`production`/`test`). No cambia el comportamiento del worker; es solo la marca de entorno |
| `LOG_LEVEL` | `info` (`env.ts:12`) | Severidad de logs (`fatal`..`trace`/`silent`) |
| `WORKER_POLL_INTERVAL_MS` | `5000` (`env.ts:25`) | Cada cuanto (ms) el loop consulta la cola |
| `RUN_TIMEOUT_SECONDS` | `600` (`env.ts:31`) | Deadline de pared que el worker aplica por run (mismo default que el backend) |
| `RUN_MAX_TOKENS` | `1000000` (`env.ts:32`) | Cap de tokens acumulados por run |
| `WEB_WORKER_URL` | opcional, URL (`env.ts:22`) | Tools nativas de plataforma. Solo se inyectan si estan **ambas** (`WEB_WORKER_URL` **y** `WEB_WORKER_SECRET`); si falta cualquiera, no se inyectan (comportamiento identico a un run sin nativas) |
| `WEB_WORKER_SECRET` | opcional, 32+ (`env.ts:23`) | Firma los POST al worker nativo. Ver la fila anterior: va en par con `WEB_WORKER_URL` |
| `RESEND_API_KEY` | opcional, no vacio (`env.ts`) | **Alertas de fallo por correo.** Key de la API de Resend. Sin ella no se envian alertas (se loguea y se sigue) |
| `RESEND_FROM_EMAIL` | opcional, email (`env.ts`) | Remitente verificado en Resend de las alertas (ej. `alertas@send.ledesma-ai-labs.com`). Si falta, no se notifica |
| `CONSOLE_BASE_URL` | opcional, URL (`env.ts`) | Base de la consola para el enlace a `/actividad` del correo (ej. `https://app.ledesma-ai-labs.com`). Si falta, el correo va sin enlace |
| `BROWSERBASE_API_KEY` | opcional, no vacio (`env.ts`) | **Sitios conectados (7.1b).** Key de la API de Browserbase. Sin ella (o sin `BROWSERBASE_PROJECT_ID`) el worker arranca igual: los jobs `conectar_sitio`/`confirmar_conexion`/`desconectar_sitio` fallan permanente con mensaje claro y el barrido de logins no corre |
| `BROWSERBASE_PROJECT_ID` | opcional, no vacio (`env.ts`) | Proyecto de Browserbase donde se crean contextos y sesiones de login. Va en par con `BROWSERBASE_API_KEY` |
| `BROWSERBASE_PROXY_SERVER` | opcional, no vacio (`env.ts`) | Proxy **externo propio con IP estatica** (recomendado en produccion): el pool gestionado de Browserbase es best-effort y no garantiza la misma IP entre sesiones; con proxy propio la salida pineada por dominio es realmente fija. Si esta, las conexiones NUEVAS salen por el (las existentes respetan su pin) |
| `BROWSERBASE_PROXY_USERNAME` | opcional, no vacio (`env.ts`) | Usuario del proxy externo (si el proxy lo exige) |
| `BROWSERBASE_PROXY_PASSWORD` | opcional, no vacio (`env.ts`) | Password del proxy externo (si el proxy lo exige). Viaja solo hacia la API de Browserbase al crear la sesion; jamas se persiste ni se loguea |
| `APROBACION_TTL_MINUTOS` | opcional, entero 1..20, default 15 (`env.ts`) | **Checkpoints de aprobacion (7.1e).** Cuanto vive una aprobacion pendiente antes de expirar (y cancelar la tarea SIN ejecutar la accion). Acotado a 20 min: el timeout de la sesion de tarea en Browserbase debe cubrir corrida + TTL + reanudacion. El TTL solo regula cuanto se espera, nunca SI se exige aprobacion: no hay valor que permita ejecutar una accion financiera sin aprobacion |
| `SUPABASE_URL` | opcional, URL (`env.ts`) | Base del proyecto Supabase para subir el **screenshot** del checkpoint al bucket privado `aprobaciones-web` (V027). Sin ella, el checkpoint se crea SIN screenshot y nada mas cambia |
| `SUPABASE_SERVICE_ROLE_KEY` | opcional, no vacio (`env.ts`) | Service role key para la subida del screenshot (omite RLS). Jamas se loguea. Va en par con `SUPABASE_URL` |

> **Alertas de fallo (aditivo, best-effort).** Cuando el worker marca un job como `failed` de forma
> DEFINITIVA (fallo permanente o reintentos agotados) envia **un** correo al dueno del job con el agente,
> el tipo (receta/mensaje), la fecha, el error truncado (300 chars, **sin** el contenido de los mensajes
> del usuario) y el enlace a `/actividad`. Es best-effort: **las tres variables de arriba son opcionales**
> y si falta cualquiera —o si Resend falla o da timeout (5s)— el worker **no se cae**, solo loguea que no
> pudo notificar y sigue procesando jobs. Hay un **cooldown anti-rafaga por owner** (max 1 correo cada 15
> min; los demas se loguean), en memoria del proceso (se resetea al redesplegar, aceptable para alertas).
>
> **Requisito de permisos:** el email del dueno vive en `auth.users.email` de Supabase (la tabla
> `profiles` no tiene email). El worker lo lee con el mismo `DATABASE_URL`. Para que los correos salgan,
> el rol de esa conexion debe tener **`SELECT` sobre `auth.users`** (el rol de servicio/`postgres` del
> pooler de Supabase ya lo tiene). Si no lo tuviera, la lectura falla de forma controlada: no se envia el
> correo (se loguea) y el worker sigue igual.

### Variables que el worker NO necesita (para evitar confusion)

Confirmado trazando todo el grafo de imports en runtime del worker:

- **`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`**: NO. El gate por tier consulta
  por `DATABASE_URL` (Postgres directo), no por cliente Supabase. `SUPABASE_URL` solo lo usa el
  verificador de JWT del backend (`auth/jwt-verifier.ts`), que el worker no importa.
- **`ADMIN_API_TOKEN` / `SESSION_TOKEN_SECRET` / `PORT` / `HOST`**: NO. Son del servidor HTTP del
  backend (`apps/backend/src/config/env.ts`), que el worker nunca importa (del backend solo consume el
  subpath `execution`, y todas sus referencias a `config/env` son `import type`, borradas al compilar).
- **`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` u otra key de proveedor**: NO. La API key de cada run sale de
  la **boveda** (se descifra con `VAULT_SECRET` por owner + credential) y se pasa explicita al SDK; no
  se lee de `process.env`.

### Resumen minimo para arrancar

Con esto el servicio arranca y funciona (native tools desactivadas, defaults en el resto):

```
DATABASE_URL=postgres://...        # igual que el backend (pooler de Supabase)
VAULT_SECRET=...                   # igual que el backend (32+ caracteres)
NODE_ENV=production                # opcional pero recomendado en prod
```

## Verificacion post-despliegue

1. Los logs del servicio muestran `worker iniciado: ejecutando jobs de la cola` (`worker.ts:55`).
2. No hay `exit(1)` con "Configuracion de entorno invalida" (eso seria una env obligatoria faltante o
   mal formada).
3. Encolar un job de prueba (via scheduler o trigger) y confirmar que pasa de `pending` a `succeeded`
   en la tabla `jobs`.
4. Al redesplegar, los logs muestran `senal recibida, cerrando` con `SIGTERM` y el cierre limpio: el
   job en curso vuelve a `pending` y se re-ejecuta (no se pierde ni se duplica).

## Opcional: config-as-code (railway.json)

Si en el futuro se prefiere versionar el build/start en vez de configurarlo a mano, se puede apuntar el
servicio del worker (ajuste "Config-as-code" / "Railway config file" del servicio) a un archivo propio,
p. ej. `apps/worker/railway.json`, con este contenido. **No** ponerlo en la raiz: ahi lo tomaria el
servicio del backend.

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm run build"
  },
  "deploy": {
    "startCommand": "npm run start -w apps/worker",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

Mientras el servicio no se configure para leer ese archivo, es inerte (Railway solo autodetecta un
`railway.json` en la raiz). Por eso el camino por defecto de este documento son los comandos a mano,
que espejan como esta desplegado el backend hoy.
