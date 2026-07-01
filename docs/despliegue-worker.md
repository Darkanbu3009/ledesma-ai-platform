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

Equivale a `node dist/index.js` dentro de `apps/worker` (ver `apps/worker/package.json:9`). Tambien
funciona `node apps/worker/dist/index.js` desde la raiz.

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
