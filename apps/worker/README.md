# @ledesma-platform/worker

Worker de **ejecucion autonoma** (Fase 5). Proceso de fondo que tomara tareas de la cola `jobs`
(migracion `apps/backend/migrations/V008__jobs.sql`) y las ejecutara sin un humano presente.

## Estado actual (PR 5.1 - esqueleto)

Por ahora es un **esqueleto**: arranca, lee la config/env, se conecta a la misma base que el backend
y corre un loop que **CONSULTA** la cola de jobs (`JobsRepository` de `@ledesma-platform/shared`) en
intervalo. **No toma ni ejecuta agentes todavia**: solo loguea cuantos jobs `pending` hay.

Lo que falta (PRs siguientes):

- **PR 5.2 (ejecucion real):** claim atomico del job (`claimNextJob`, `FOR UPDATE SKIP LOCKED`),
  resolver la credencial de la boveda por `owner_id` + `credential_id`, armar el run con la capa
  reutilizable `assembleAgentRun` (`apps/backend/src/execution/`), ejecutar `runAgent` con un deadline
  propio, y cerrar el job (`markCompleted` / `markFailed`) con reintentos.
- **PR 5.3 (scheduler):** disparo por horario usando `jobs.scheduled_for`.
- **PR 5.4 (triggers):** encolado de jobs desde eventos entrantes.

Este proceso **no se despliega** aun; solo debe compilar y poder correrse localmente.

## Scripts

- `npm run dev -w apps/worker` — corre con `tsx watch`.
- `npm run build -w apps/worker` — compila a `dist/`.
- `npm run start -w apps/worker` — corre el build (`node dist/index.js`).
- `npm run typecheck -w apps/worker` / `npm run test -w apps/worker`.

## Config (env)

| Variable | Requerida | Default | Uso |
| --- | --- | --- | --- |
| `DATABASE_URL` | si | — | Conexion a la base (misma que el backend). |
| `VAULT_SECRET` | si | — | Boveda; se usara en PR 5.2 para resolver credenciales. |
| `WEB_WORKER_URL` / `WEB_WORKER_SECRET` | no | — | Tools nativas; se usaran en PR 5.2. |
| `WORKER_POLL_INTERVAL_MS` | no | `5000` | Cada cuanto consulta la cola. |
| `LOG_LEVEL` | no | `info` | Nivel de log. |
