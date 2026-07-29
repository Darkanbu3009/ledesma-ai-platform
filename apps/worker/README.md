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
- `npm run parche -w apps/worker` — aplica el parche de Stagehand sobre `node_modules` (ver abajo).
  Va encadenado en `build` y en `dev`, asi que rara vez hace falta a mano.
- `npm run build -w apps/worker` — aplica el parche y compila a `dist/`.
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
| `TAREA_WEB_SCREENSHOTS` | no | `cambios` | Cuando se captura la pantalla: `siempre`, `cambios` o `minimo` (ver abajo). |
| `TAREA_WEB_HISTORIAL_PASOS` | no | `8` | Pasos de conversacion que se reenvian al modelo en cada llamada (3..40). |
| `ATLAS_SITIOS_SECRET` | no | derivado de `VAULT_SECRET` | Secreto del HMAC de origen del atlas de sitios (32+, ver abajo). |
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
aplicado por `patch-package`. Un nodo cuyo `encodedId` no cumpla `/^\d+-\d+$/` (incluido `undefined`)
deja de rotularse: su linea se omite y sus hijos validos toman su lugar, asi que el modelo solo puede
elegir entre identificadores que el esquema acepta. Con todos los nodos validos, el arbol es byte a
byte el de siempre.

#### Donde se aplica: en el worker, NO en el `postinstall` de la raiz

El parche cuelga del script `parche` de **este** workspace, encadenado en su `build` y en su `dev`
(`apps/worker/package.json:8-10`):

```
"parche": "cd ../.. && patch-package --error-on-fail --error-on-warn"
```

- **Por que no un `postinstall`** (ni en la raiz ni aca). `npm ci` en la raiz corre el `postinstall`
  de la raiz **y tambien el de cada workspace** (verificado). Vercel construye `apps/console`, que no
  usa Stagehand, y corre `npm ci` en la raiz: con el parche en cualquier `postinstall`, el build de la
  consola queda enganchado a una dependencia del worker que no necesita. Eso es lo que tumbo dos
  despliegues con `sh: line 1: patch-package: command not found` (exit 127). Colgado del `build` del
  worker, Vercel deja de tocarlo por completo.
- **Railway lo sigue aplicando solo.** Su Build Command es `npm run build` en la raiz, que encadena
  `npm run build --workspaces` y por tanto el `build` del worker. No hay paso manual que agregar.
- **El `cd ../..` no es cosmetico.** `patch-package` resuelve su raiz subiendo desde el cwd hasta el
  primer `package.json` (`getAppRootPath`), y ahi busca `patches/` **y** `node_modules/`. Desde
  `apps/worker` esa raiz seria el propio workspace: `patches/` no existe ahi y `node_modules` esta
  hoisteado en la raiz del monorepo, asi que imprime `No patch files found` y **sale 0** sin parchear
  nada (verificado). Con el `cd`, el binario sigue resolviendo por PATH (npm agrega el
  `node_modules/.bin` de la raiz al correr un script de workspace) y el parche aplica.
- **`patch-package` va en las `dependencies` del worker, NO en `devDependencies`**
  (`apps/worker/package.json:17`). Railway instala en modo produccion (su log avisa
  `npm warn config production Use --omit=dev instead`) y ahi las `devDependencies` se omiten: como
  devDependency el binario no existiria. Verificado con `npm ci --omit=dev`.
- **Falla RUIDOSAMENTE**: `--error-on-fail --error-on-warn`. Fuera de CI, `patch-package` imprime el
  error de un parche que no aplica y **sale con codigo 0** (verificado: un parche roto sale 0 sin los
  flags y 1 con ellos), asi que el build quedaria verde con un worker sin parchear. `--error-on-warn`
  cubre ademas el aviso por version distinta: si alguien sube Stagehand y el parche aplica a medias,
  el build se detiene en vez de seguir. Es idempotente: correrlo dos veces vuelve a dar `✔` y 0.
- **`postinstall-postinstall` NO se usa.** Es un parche para un hueco de yarn v1 y este repo es npm
  puro; ademas su propio `postinstall` invoca `yarn run postinstall` en cuanto encuentra `yarnpkg` en
  el PATH, y yarn aplica `engines` de forma estricta: con un node fuera de `>=20 <21` aborta la
  instalacion entera (reproducido con node 22).

#### Dos guardas para que un parche no aplicado no pase desapercibido

Un script se puede saltar (un `npm ci` que no construye, un `node_modules` reinstalado despues del
build), y un worker sin parche **no se rompe de forma visible**: navega igual y falla mas tarde en la
tarea web. Por eso hay dos redes:

- **El worker no arranca sin el parche.** `src/parche-stagehand.ts` corre en `src/index.ts` **antes**
  de leer la config y de tocar la base: carga el `formatTreeLine` REAL de `node_modules` y comprueba
  su COMPORTAMIENTO (que un nodo con `encodedId` invalido no se rotule y que sus hijos validos
  sobrevivan), no la presencia de un comentario. Si no cumple, imprime el motivo y sale con codigo 1.
- **CI lo vigila**: `test/parche-stagehand.test.ts` importa ese mismo `formatTreeLine` real y falla si
  el parche no esta aplicado (el orden de CI es `build` -> `test`, asi que el `build` del worker ya lo
  aplico).

**Retirarlo** cuando Stagehand lo corrija upstream. Verificado AUSENTE en 3.7.1 (su
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

### Atlas de sitios (`ATLAS_SITIOS_SECRET`, V040)

El worker agrega, POR DOMINIO, las estrategias de localizacion que GANARON en ejecuciones exitosas de
cualquier usuario, y se las ofrece como PISTAS a todo agente que opere despues en ese dominio (mapa
en el contexto de percepcion del motor libre; estrategias de fallback en el ejecutor de recetas). No
tiene flag: queda activo en cuanto la migracion V040 esta aplicada, y sin ella el worker corre igual
(la lectura falla, se loguea y la tarea sigue sin pistas).

`aprendizaje_sitios` NO tiene `owner_id` ni ninguna columna de tenencia. Para poder contar cuantos
usuarios DISTINTOS produjeron una estructura sin saber quienes son, cada observacion aporta un
HMAC-SHA256 del owner calculado con este secreto, que vive SOLO en el worker. Es opcional: sin la
variable, la clave se deriva de `VAULT_SECRET` con una etiqueta de separacion de dominio
(`claveDelAtlas`, `src/atlas-sitios.ts`), derivacion de una sola via que jamas permite reconstruir el
secreto de la boveda. Configurar la variable despues solo hace que los origenes se cuenten de nuevo
desde cero.

**Interaccion con `TAREA_WEB_OBSERVADOR_PASOS`**: el camino por RECETA alimenta el atlas siempre (las
ganadoras las informa el ejecutor determinista). El camino del MOTOR LIBRE necesita las estrategias
que lee el observador, asi que con el observador apagado (el default) una corrida con motor no aporta
nada al atlas, por la misma razon por la que tampoco se promueve a receta.

### Costo por corrida (`TAREA_WEB_SCREENSHOTS` y `TAREA_WEB_HISTORIAL_PASOS`)

El bucle del agente reenvia la conversacion COMPLETA en cada llamada al modelo, asi que el costo de
entrada crece con el cuadrado de los pasos: una corrida de 26 pasos consumio 208111 tokens de
entrada y 3007 de salida. Las palancas de `src/costo-modelo.ts` atacan las tres causas, y ninguna
cambia lo que el agente decide (mismo objetivo, mismas reglas de sistema, mismas herramientas):

- **Cache de prompt.** El prefijo estable de la corrida (definicion de herramientas + instrucciones
  de sistema + objetivo del usuario) se marca como cacheable, y mientras la ventana de historial no
  se desliza se marca ademas el final del envio anterior. Con eso, cada paso LEE de cache lo que
  antes volvia a pagar como entrada nueva. Se verifica en el log `tarea web: consumo de la corrida
  del motor`: `tokensLeidosDeCache` en cero significa que el cache no esta funcionando.
- **`TAREA_WEB_HISTORIAL_PASOS`** (default `8`, rango 3..40): cuantos pasos de ida y vuelta se
  reenvian. El objetivo original viaja SIEMPRE; esto acota solo la conversacion posterior. El corte
  cae siempre en un mensaje del asistente, nunca dejando un resultado de tool huerfano.
- **`TAREA_WEB_SCREENSHOTS`** (default `cambios`): una captura es lo mas caro que entra al contexto
  del modelo y, paso a paso, suele ser la MISMA pagina.
  - `cambios`: se captura solo si la URL o el titulo cambiaron desde la observacion anterior.
  - `minimo`: solo la primera de la corrida y las del tramo que precede a una accion irreversible.
  - `siempre`: comportamiento historico, sin intervencion alguna sobre la tool nativa.

Al terminar cada corrida del motor (haya devuelto o haya sido cortada por deadline o cancelacion) se
loguea `tarea web: consumo de la corrida del motor` con los tokens de entrada, de salida, leidos de
cache y creados en cache, mas el numero de llamadas al modelo. Es la medida directa del ahorro.

### Tareas que usan varios sitios conectados

Una tarea web puede operar sobre mas de un sitio conectado del mismo usuario (por ejemplo, buscar un
precio en la cuenta de una tienda y mandar el resultado por correo). El job lleva una LISTA CERRADA
de sitios autorizados (`payload.sitios`, tope `MAX_SITIOS_POR_TAREA` = 3, validada en `shared`); un
payload sin esa lista autoriza un solo sitio y se comporta exactamente como antes de este cambio.

Lo que NO cambia, y es lo que hace que la capacidad sea segura:

- **Una sesion POR SITIO, aislada.** Cada sitio abre su propia sesion de navegador contra su propio
  contexto externo, con su proxy y su pais pineado, y recibe SOLO su contexto descifrado. Las cookies
  de un sitio nunca entran en la sesion de otro; no hay un navegador con varias pestanas, hay N
  sesiones separadas en el proveedor (`crearGestorDeSitios`, `src/tarea-web.ts`).
- **Apertura BAJO DEMANDA.** Solo se abre la sesion del sitio de arranque; las demas se abren la
  primera vez que el agente cambia a ellas. Una tarea que autoriza tres sitios y usa uno paga una
  sesion. Todas se cierran al terminar, por la ruta de cierre de siempre.
- **El destino de un cambio se resuelve SERVER-SIDE** contra la lista del job
  (`resolverDominioAutorizado`, `src/multisitio.ts`), por comparacion exacta: ni sufijos, ni
  subdominios, ni un sitio del usuario que ESTA tarea no autorizo. Un destino rechazado vuelve al
  modelo como fallo de la tool y no abre nada.
- **El cupo de accion irreversible es POR SITIO.** Enviar un correo en un sitio y comprar en otro son
  dos acciones distintas y las dos pueden ejecutarse en la misma tarea; dos acciones irreversibles en
  el MISMO sitio siguen bloqueadas, y volver a un sitio ya visitado no reabre su cupo (el contador
  vive en `crearRegistroDeSitios`, fuera de la guardia del tramo).
- **La verificacion determinista y la politica del usuario se aplican igual en cada sitio**, contra
  los parametros que declaro el USUARIO. Lo que un sitio "le cuenta" al siguiente viaja como dato
  delimitado y censurado dentro de la instruccion del tramo, nunca como instruccion.

El bucle del agente esta atado a la sesion en la que arranca, asi que un cambio de sitio TERMINA el
tramo y el handler vuelve a correr el motor sobre la sesion del destino. El presupuesto de pasos
(`TAREA_WEB_MAX_STEPS`) y el deadline de pared (`TAREA_WEB_TIMEOUT_SECONDS`) son de la TAREA, no del
tramo, y los cambios estan acotados por `MAX_CAMBIOS_DE_SITIO_POR_TAREA`.
