# @ledesma-platform/worker

Worker de **ejecucion autonoma** (Fase 5). Proceso de fondo que toma tareas de la cola `jobs`
(migracion `apps/backend/migrations/V008__jobs.sql`) y ejecuta el agente **sin un humano presente**.

## Estado actual (PR 5.2 - ejecucion real)

El loop **toma** un job `pending` de forma ATOMICA (`claimNextJob`, `FOR UPDATE SKIP LOCKED`: dos
workers nunca toman el mismo) y lo ejecuta de punta a punta:

1. **Gate por tier** (server-side, antes de gastar nada): exige `profiles.tier = 'autonomous'`. Si no
   lo tiene, el job se marca `failed` directo (fallo PERMANENTE, no se reintenta).
2. **Carga el agente** (`AgentRepository.getById`) y **resuelve la credencial** de la boveda por
   `owner_id` + `credential_id` (`resolveStoredCredential`, descifra server-side).
3. **Ensambla** el run con la capa reutilizable `assembleAgentRun` (sin HTTP) y **ejecuta**
   `runAgent`, consumiendo el `AsyncIterable` hasta el `stop` final.
4. **Timeout de pared propio** (`AbortController` + `setTimeout(RUN_TIMEOUT_SECONDS)`): `runAgent` NO
   lo aplica. Al vencer aborta el run y cuenta como fallo del intento. El timer se limpia siempre.
5. **Cierre con reintentos** (maximo 3): exito -> `markCompleted`; fallo transitorio (error de
   proveedor, timeout, credencial irresoluble, agente ausente) -> vuelve a `pending` con backoff
   (`markPendingRetry`, `attempts++` via el proximo claim) mientras queden intentos, o `failed`
   definitivo al 3er intento. Un job roto NO tumba el worker: se registra y sigue con el siguiente.

### Como reusa el motor del backend

El worker importa el motor, los repos y la boveda del backend por el **subpath de paquete**
`@ledesma-platform/backend/execution` (ver el campo `exports` de `apps/backend/package.json`). Es la
MISMA logica que usa la ruta HTTP `/v1/run/:agentId`, sin duplicarla. El backend se construye antes
que el worker (orden de CI: `shared -> backend -> worker`), asi sus declaraciones ya existen al
compilar el worker. La logica del worker (`src/execution.ts`) recibe el motor y los repos **inyectados**
(solo imports de tipos), por eso sus tests corren sin tocar la DB, el motor real ni el modelo.

### Insertar un job a mano (para probar)

El QUE encola jobs por horario (scheduler, PR 5.3) y por triggers entrantes (PR 5.4) llega despues.
Para probar este worker se inserta un job a mano en la cola (`JobsRepository.createJob` o SQL directo)
con `agent_id`, `owner_id`, `credential_id` y `payload = { messages: [{ role, content }] }`.

### Apagado a media ejecucion

Ante `SIGTERM`/`SIGINT` el worker deja de tomar jobs nuevos, **aborta** el run en curso (que vuelve a
`pending` para re-reclamar, sin marcarlo `failed`) y espera a que la pasada en vuelo termine antes de
cerrar el pool. NO existe todavia un "reaper" de jobs `running` huerfanos (proceso muerto de golpe): un
job tomado y no cerrado queda en `running` hasta que se lo re-reclame manualmente; el reaper automatico
es alcance de un PR posterior.

Lo que falta (PRs siguientes):

- **PR 5.3 (scheduler):** disparo por horario usando `jobs.scheduled_for`.
- **PR 5.4 (triggers):** encolado de jobs desde eventos entrantes.

Este proceso **no se despliega** aun; solo debe compilar y poder correrse localmente.

## Scripts

- `npm run dev -w apps/worker` — corre con `tsx watch` (requiere el backend construido: `npm run build
  -w apps/backend`, porque importa `@ledesma-platform/backend/execution` de su `dist`).
- `npm run build -w apps/worker` — compila a `dist/`.
- `npm run start -w apps/worker` — corre el build (`node dist/index.js`).
- `npm run typecheck -w apps/worker` / `npm run test -w apps/worker`.

## Config (env)

| Variable | Requerida | Default | Uso |
| --- | --- | --- | --- |
| `DATABASE_URL` | si | — | Conexion a la base (misma que el backend). |
| `VAULT_SECRET` | si | — | Boveda: resuelve la credencial guardada de cada job. |
| `WEB_WORKER_URL` / `WEB_WORKER_SECRET` | no | — | Tools nativas; si falta alguna, no se inyectan. |
| `RUN_TIMEOUT_SECONDS` | no | `600` | Deadline de pared del run (lo aplica el worker). |
| `RUN_MAX_TOKENS` | no | `1000000` | Cap de tokens acumulados del run. |
| `WORKER_POLL_INTERVAL_MS` | no | `5000` | Cada cuanto consulta la cola. |
| `LOG_LEVEL` | no | `info` | Nivel de log. |
