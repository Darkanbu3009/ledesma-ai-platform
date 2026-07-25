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

### Robustez de la cola (fix informe 06)

Dos endurecimientos aditivos sobre el nucleo (el claim atomico `FOR UPDATE SKIP LOCKED` queda INTACTO):

- **Reaper de jobs huerfanos (H3/H4).** Un `kill -9`/OOM, o el watchdog forzando `exit(0)` con el drain
  colgado, puede matar el worker ENTRE el claim y el cierre, dejando un job atascado en `running` para
  siempre (el claim solo mira `pending`; la retencion solo borra terminales). En cada pasada del loop
  (throttled: a lo sumo cada 60s, y siempre en el arranque -> recupera lo que dejo un proceso anterior
  muerto), el worker corre `reapOrphanedJobs`: devuelve a `pending` (o `failed` si ya agoto intentos, con
  `last_error` de "recuperado de estado huerfano") los `running` cuyo `started_at` supera un **margen
  amplio calibrado por tipo** — varias veces `RUN_TIMEOUT_SECONDS` para un job simple, y mas de
  `MAX_STEPS(50) * RUN_TIMEOUT_SECONDS` para una receta. El margen SUPERA el maximo wall-clock legitimo de
  cada tipo, asi que el reaper **jamas toca un job vivo**; ademas corre dentro del guard `inFlight`, sin
  solaparse con un job en vuelo de este proceso. Las transiciones de cierre (`markCompleted/Failed/
  PendingRetry`) llevan ahora **compare-and-set** (`... and status = 'running'`) para que el reaper y el
  worker no se pisen (cierra H8). Alternativa de cobertura total (worker caido): una funcion SQL + pg_cron
  (como el scheduler), que reapea aunque no haya worker vivo — no hace falta con 1 worker en Railway (si
  no hay worker, nadie consume la cola de todos modos) y quedaria como PR posterior si se escala a N workers.

- **Cierre endurecido contra doble ejecucion (H1).** Los efectos de un run (llamada al proveedor, tokens,
  tools nativas) ocurren ANTES de persistir `completed`. Si `markCompleted` fallaba por un blip transitorio
  de red, el job caia a reintento y se **re-ejecutaba** (doble cobro/efectos). Ahora `markCompleted` se
  **reintenta con backoff corto (3 intentos)** antes de rendirse, absorbiendo el blip en el caso comun.

  > **Honestidad de diseno — sigue siendo at-least-once, NO exactly-once.** Este fix REDUCE la
  > probabilidad de doble ejecucion y la hace recuperable, pero **no la elimina**: si Postgres esta
  > realmente caido, tras agotar los reintentos el job vuelve a `pending` y puede re-ejecutarse. La unica
  > defensa COMPLETA es la **idempotencia de los efectos** (claves de idempotencia en las tools que
  > escriben / dedupe por job id) o un **checkpoint por paso** en recetas; ambos son un cambio grande y
  > quedan FUERA de alcance de este fix.

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
cerrar el pool. Si el proceso muere de golpe (crash/OOM/`kill -9`, o el watchdog forzando `exit(0)` con
el drain colgado) dejando un job en `running`, el **reaper** (ver "Robustez de la cola" arriba) lo
recupera automaticamente al siguiente arranque / pasada del loop.

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
| `TAREA_WEB_MAX_STEPS` | no | `120` | Cap de pasos del agente de navegacion por tarea web (10..300). |
| `TAREA_WEB_TIMEOUT_SECONDS` | no | `1500` | Deadline de pared SOLO de los jobs `tarea_web` (60..2580). |
| `TAREA_WEB_TOOL_TIMEOUT_SECONDS` | no | `90` | Techo por LLAMADA de tool del agente de navegacion (30..300). |
| `TAREA_WEB_OBSERVADOR_PASOS` | no | `false` | Observador de pasos: `true` o `false` (ver abajo). |
| `WORKER_POLL_INTERVAL_MS` | no | `5000` | Cada cuanto consulta la cola. |
| `LOG_LEVEL` | no | `info` | Nivel de log. |

### Parche de Stagehand: identificadores malformados en el arbol de accesibilidad

El motor de navegacion (Stagehand 3.6.0) rotulaba cada linea del arbol de accesibilidad con
`encodedId ?? nodeId` (`understudy/a11y/snapshot/treeFormatUtils.js`). `encodedId` solo se calcula
para los nodos AX con `backendDOMNodeId` numerico (`decorateRoles`, `a11yTree.js`), asi que cuando
quedaba `undefined` el modelo veia `[5662]` en vez de `[0-5662]`, lo copiaba y el esquema de `act`
(`lib/inference.js`, que exige `numero-numero` en `elementId`) rechazaba la respuesta con
`NoObjectGeneratedError`. **El fallo es DETERMINISTA**: mismo arbol, mismo id malformado, mismo
rechazo (produccion, 25 jul 2026: `elementId "5662"` rechazado cinco veces en dos minutos). El
modelo no se equivocaba, obedecia un arbol mal formado.

**La causa raiz se ataca con un parche de la libreria**: `patches/@browserbasehq+stagehand+3.6.0.patch`,
aplicado por `patch-package` en el `postinstall` de la raiz. Un nodo cuyo `encodedId` no cumpla
`/^\d+-\d+$/` (incluido `undefined`) deja de rotularse: su linea se omite y sus hijos validos toman
su lugar, asi que el modelo solo puede elegir entre identificadores que el esquema acepta. Con todos
los nodos validos, el arbol es byte a byte el de siempre.

- **El parche se aplica solo** con cualquier `npm ci` / `npm install` en la raiz (Railway usa
  Nixpacks, que corre `npm ci` y por tanto el `postinstall`). No hay paso manual.
- **`patch-package` y `postinstall-postinstall` van en `dependencies`, NO en `devDependencies`**
  (`package.json:20-23`). Railway y Vercel instalan en modo produccion (el log de Railway avisa
  `npm warn config production Use --omit=dev instead`), y ahi las `devDependencies` se omiten: con
  `patch-package` como devDependency, el `postinstall` moria con
  `sh: line 1: patch-package: command not found` (Vercel, exit 127) y, peor, el parche NO se habria
  aplicado en el worker aunque el build no fallara. En `dependencies` el binario existe en los dos
  modos de instalacion.
- **El `postinstall` falla RUIDOSAMENTE**: `patch-package --error-on-fail --error-on-warn`. Fuera de
  CI, `patch-package` imprime el error y **sale con codigo 0** (verificado: un parche roto sale 0 sin
  los flags y 1 con ellos), asi que un despliegue de Railway se habria llevado un worker sin parchear
  creyendo que todo salio bien. `--error-on-warn` cubre ademas el aviso por version distinta: si
  alguien sube Stagehand y el parche aplica a medias, la instalacion se detiene en vez de seguir.
- **CI lo vigila**: `apps/worker/test/parche-stagehand.test.ts` importa el `formatTreeLine` REAL de
  `node_modules` y falla si el parche no esta aplicado.
- **Node 20 obligatorio** (`.nvmrc`, `engines` en la raiz). El `postinstall` de
  `postinstall-postinstall` invoca `yarn run postinstall` en cuanto encuentra `yarnpkg` en el PATH, y
  yarn aplica `engines` de forma estricta: con un node fuera de `>=20 <21` aborta la instalacion
  entera (verificado con node 22). Con node 20 la instalacion pasa limpia.
- **Retirarlo** cuando Stagehand lo corrija upstream. Verificado AUSENTE en 3.7.1 (su
  `treeFormatUtils.js` es identico al de 3.6.0), asi que subir de version NO reemplaza al parche.

### Blindaje de la tarea web (fallo de esquema del motor)

Red de seguridad para lo que el parche no cubra, en la tool `act` del agente:

- **Reintento SOLO si el identificador cambia.** Un rechazo de esquema con un `elementId` distinto
  al del intento anterior (o ilegible) se reintenta hasta 2 veces con 1 segundo entre intentos. Un
  rechazo con el MISMO `elementId` que el intento anterior NO se reintenta: es determinista y
  reintentarlo solo quema pasos y minutos de navegador. Corta en el acto, con el identificador en el
  mensaje del error.
- **Corte por 3 fallos de esquema consecutivos** (identificadores distintos, reintentos agotados): la
  tarea termina con un error propio que dice que fallo el MOTOR, distinto del limite de pasos y de un
  error del usuario. Un `act` exitoso reinicia el contador y el ultimo identificador rechazado.
- **`toolTimeout`** (`TAREA_WEB_TOOL_TIMEOUT_SECONDS`): techo por llamada de tool. Sin el, Stagehand
  aplica su default de 45 s y el despliegue no puede ajustarlo.

La trayectoria de la corrida se persiste con las acciones acumuladas EN VIVO aunque el motor lance
(corte por esquema, deadline de pared o cancelacion); los intentos fallidos quedan como pasos con
`exito: false`. Dos detalles que hacian que una tarea CANCELADA quedara con cero pasos:

- La accion de `act` entra a la traza **antes** de tocar el navegador y el mismo registro se completa
  con el desenlace al terminar. Registrarla despues perdia la que estuviera en vuelo (o entre
  reintentos) cuando llegaba la cancelacion.
- Las tools que no son `act` (`goto`, `extract`, `click`, `type`, ...) se registran en vivo por el
  callback de evidencia. La traza del motor solo llega cuando `execute()` DEVUELVE, asi que una
  corrida que lanza no la trae, y una tarea cancelada antes de su primer `act` no dejaba nada.

### Observador de pasos (`TAREA_WEB_OBSERVADOR_PASOS`)

Encendido, el handler lee del DOM las estrategias de localizacion de cada elemento que el motor toca
mientras la tarea corre, y esas estrategias son lo que hace promovible una corrida a receta. El
costo es una conexion CDP NUEVA por paso durante la corrida.

**Apagado (default): las recetas NO capturan estrategias enriquecidas durante la corrida.** En la
practica eso significa que una corrida del motor no se promueve a receta (sin estrategias no hay
paso re-ejecutable que guardar). Lo demas no cambia: las recetas YA aprendidas se siguen ejecutando
de forma determinista, se reparan y se jubilan igual, y la trayectoria se sigue registrando. Se
enciende (`TAREA_WEB_OBSERVADOR_PASOS=true`) en los despliegues donde interese volver a aprender
recetas nuevas.
