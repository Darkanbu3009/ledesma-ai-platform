# Auditoria 06 - El worker, la cola de jobs y la concurrencia

> Auditoria READ-ONLY #6 de 12 (abre el Bloque B: correctitud y robustez). Nada de codigo fue
> modificado. Alcance: el sistema de ejecucion autonoma de la Fase 5 -- el worker (`apps/worker`), la
> cola `jobs` (V008) y la repo de acceso (`packages/shared/src/jobs`). Pregunta central: "que pasa si
> dos cosas ocurren al mismo tiempo, o si algo se interrumpe a la mitad?".
>
> Cada hallazgo esta VERIFICADO contra el codigo real (path:linea) y corroborado por una pasada de
> verificacion adversarial independiente (12 revisores, uno por escenario, con la consigna de REFUTAR).
> Se distingue el bug REAL alcanzable del caso teorico que la arquitectura ya previene, y se marca cada
> hallazgo como problema HOY (mono-proceso, 1 worker en Railway) vs solo AL ESCALAR (N workers).

---

## 1. Resumen ejecutivo

**Veredicto: correcta en su nucleo (el claim atomico es solido) pero con riesgos de doble ejecucion
reales y sin red de seguridad ante interrupciones.** El corazon de la cola -- el claim atomico
(`UPDATE ... FOR UPDATE SKIP LOCKED`) -- es genuinamente a prueba de doble-toma, hoy y al escalar. Pero
alrededor de ese nucleo hay tres debilidades que importan: (a) el modelo de entrega es **at-least-once**
y hay al menos dos caminos concretos de **doble ejecucion de efectos colaterales** alcanzables HOY con
un solo worker; (b) **no existe recuperacion de jobs `running` huerfanos**: un proceso que muere entre
el claim y el cierre deja el job atascado en `running` para siempre; (c) el worker mono-proceso sufre
**bloqueo head-of-line** (un job lento hambrea toda la cola).

### Hallazgos por severidad

| # | Severidad | Hallazgo | Aplica |
|---|-----------|----------|--------|
| H1 | **CRITICA** | Doble ejecucion si `markCompleted` falla transitoriamente tras un run exitoso | HOY (mono-proceso) |
| H2 | **CRITICA** | Reintento de receta re-ejecuta desde el paso 1 y duplica los efectos de los pasos previos (por diseno) | HOY (mono-proceso) |
| H3 | **ALTA** | Jobs `running` huerfanos sin recuperacion: crash/OOM/kill -9 entre claim y cierre = job perdido para siempre | HOY (mono-proceso) |
| H4 | **ALTA** | El watchdog de 10s (`process.exit(0)`) puede dejar un job huerfano en un shutdown graceful si el drain se cuelga | HOY (mono-proceso) |
| H5 | **ALTA** | Bloqueo head-of-line: un job lento (hasta `runTimeoutMs`=600s, o N*600s por receta) hambrea la cola entera | HOY (mono-proceso) |
| H6 | **MEDIA** | Carrera `break`-antes-de-capturar-stop: un run YA completado puede reclasificarse como timeout y re-cobrarse | HOY (ambos), ventana estrecha |
| H7 | **MEDIA** | Los redeploys (SIGTERM) consumen el presupuesto de reintentos: `attempts` sube en cada re-claim | HOY (mono-proceso) |
| H8 | **MEDIA** | Transiciones de estado sin compare-and-set (`WHERE id` a secas): latente hasta que se agregue un reaper o recovery | Solo al agregar reaper / N workers con recovery |
| H9 | **BAJA** | El gate de tier no se re-evalua entre pasos de una receta (downgrade a media receta no la corta) | HOY (ambos), por diseno |
| H10 | **BAJA** | Precedencia `timedOut` sobre shutdown: un timeout coincidente con el apagado se trata como fallo transitorio, no como re-pending limpio | HOY (ambos), benigno |
| H11 | **BAJA** | Higiene: defaults de `RUN_TIMEOUT/RUN_MAX_TOKENS` hardcodeados en el worker (drift potencial con el backend); cero tests de concurrencia/crash | HOY |

**Lo mas importante:** H1 y H2 son doble-ejecucion alcanzable. Para recetas con efectos colaterales
externos (el escenario que el brief marca como el peor: "quemar credenciales", acciones repetidas), una
doble ejecucion es grave. H3/H4 no corrompen datos pero pierden jobs de forma silenciosa. Ninguno es un
bug del claim en si: el claim esta bien. Son consecuencias del modelo de entrega y de la ausencia de un
reaper (deuda ya reconocida en `apps/worker/README.md:43-44`).

---

## 2. Modelo de entrega: **at-least-once**

Este es el marco que ordena todo el informe. El sistema **NO ofrece exactly-once ni at-most-once**: es
**at-least-once**, porque los efectos colaterales de un job (la llamada al proveedor, los tokens
cobrados, las tools nativas que escriben) ocurren ANTES de que el estado terminal se persista, y hay
varios caminos por los que ese estado terminal no se persiste tras un run exitoso -> el job se
re-ejecuta.

Evidencia del orden efecto-antes-de-commit (`apps/worker/src/execution.ts`):

```
295  const { stopReason, usage } = await runAgentWithDeadline(...);  // <- efectos YA ocurrieron
297  await deps.jobs.markCompleted(job.id);                          // <- recien aca se persiste el fin
```

Consecuencias practicas (todas verificadas mas abajo):
- Si `markCompleted` (L297) falla pero el run corrio, el job vuelve a `pending` y se re-ejecuta (**H1**).
- Un reintento de receta re-corre desde el paso 1, repitiendo los efectos de los pasos previos (**H2**).
- Una carrera interna puede reclasificar un run completado como timeout y re-cobrarlo (**H6**).

**Implicacion de diseno:** mientras el modelo sea at-least-once, la unica defensa correcta contra la
doble ejecucion es la **idempotencia de los efectos** (claves de idempotencia en las tools que escriben,
dedupe por job id) o un **checkpoint por paso** en recetas. Hoy no existe ninguna de las dos: las
recetas advierten al usuario en la UI (`RetryWarning`) que un reintento re-corre desde el paso 1, lo que
confirma que la decision es consciente, no un olvido -- pero la advertencia no elimina el riesgo tecnico.

---

## 3. Maquina de estados de un job

Estados (`packages/shared/src/jobs/types.ts:9`): `pending | running | completed | failed`. El CHECK de
la tabla los fija (`apps/backend/migrations/V008__jobs.sql:38-39`).

### Transiciones VALIDAS (las que el codigo ejecuta)

```
                    createJob / enqueue_due_scheduled_tasks (V010:193-195)
                              |
                              v
                        [ pending ] <-------------------------------+
                              |                                     |
             claimNextJob (jobs-repository.ts:196-215)              |
             status='running', attempts+=1, started_at=now()        |
                              |                                     |
                              v                                     |
                        [ running ]                                 |
                        /    |     \                                |
        markCompleted /  markFailed \  markPendingRetry ------------+
        (226-231)    /   (234-239)   \ (250-260)
                    v                 v   status='pending', started_at=null,
              [ completed ]       [ failed ]   scheduled_for=backoff|null
               (terminal)         (terminal)   (NO toca attempts)
```

Detalle de cada arista:
- **pending -> running** (`claimNextJob`): el UNICO camino de toma en runtime. Incrementa `attempts`,
  setea `started_at`, todo en un solo statement atomico. `markRunning` (222) existe pero es **codigo
  muerto**: no se llama en runtime, solo en un test.
- **running -> completed** (`markCompleted`): estado terminal, setea `finished_at`.
- **running -> failed** (`markFailed`): terminal. Dos disparadores: fallo PERMANENTE (gate de tier,
  `execution.ts:246`) o fallo transitorio con `attempts >= MAX_ATTEMPTS` (`execution.ts:487`).
- **running -> pending** (`markPendingRetry`): NO terminal. Dos disparadores: fallo transitorio con
  intentos restantes (`execution.ts:499-501`, con backoff futuro) o apagado del worker
  (`execution.ts:467-471`, con `scheduled_for=null` = elegible ya).

### Donde se ROMPE la maquina de estados

1. **running -> (proceso muere) -> running PARA SIEMPRE** (H3, H4). Ninguna arista sale de `running` sin
   que el proceso siga vivo corriendo TS. Un crash/OOM/kill -9, o el watchdog forzando `exit(0)` con el
   drain colgado, deja la fila en `running` sin retorno. `claimNextJob` solo mira `status='pending'`
   (`jobs-repository.ts:205`), asi que nunca la re-selecciona. La retencion V015 solo BORRA terminales
   (`V015__retention.sql:44-53`, "pending/running jamas se tocan"), ni siquiera limpia el huerfano.

2. **Transiciones fisicamente posibles pero no alcanzables hoy** (H8). Las cuatro `mark*` filtran solo
   por `id` (sin `AND status = ...`). No hay compare-and-set. Fisicamente, un `markCompleted` sobre un
   job ya `failed` (o viceversa) es posible. Hoy NO es alcanzable porque cada job tiene un unico escritor
   (el worker que lo reclamo; el gate `inFlight` + drenado secuencial garantizan un solo procesador por
   proceso, y `SKIP LOCKED` garantiza un solo worker por job). Se vuelve alcanzable si se agrega un reaper
   que re-transicione filas `running`, o N workers con recovery.

---

## 4. Hallazgos detallados

Formato por hallazgo: SEVERIDAD, UBICACION, EVIDENCIA, ESCENARIO (interleaving/fallo concreto), IMPACTO,
RECOMENDACION (sin arreglar), APLICA (hoy mono-proceso vs solo al escalar), CONFIANZA.

---

### H1 - Doble ejecucion si `markCompleted` falla tras un run exitoso

- **SEVERIDAD: CRITICA** (doble ejecucion de efectos alcanzable).
- **UBICACION:** `apps/worker/src/execution.ts:295-307` (camino simple) y `:430` (receta);
  `handleFailure` `:460-508`; `jobs-repository.ts:226-231` (markCompleted) y `:250-260` (markPendingRetry).
- **EVIDENCIA:** tras `runAgentWithDeadline` (L295), la unica escritura de cierre es
  `await deps.jobs.markCompleted(job.id)` (L297), DENTRO del `try`. Si lanza, cae al mismo `catch` que un
  fallo de ejecucion (`L305-307 } catch (error) { await handleFailure(deps, job, error); }`). El error de
  `markCompleted` no es `ShutdownAbortError` ni `PermanentExecutionError`, asi que `handleFailure` lo trata
  como transitorio: con `job.attempts < MAX_ATTEMPTS` (L487) llama `markPendingRetry` (L501), que
  reencola el job SIN guarda de estado y SIN idempotencia (`jobs-repository.ts:250-260`).
- **ESCENARIO (interleaving, basta UN worker):**
  1. `claimNextJob` -> `running`, `attempts=1`.
  2. `runAgentWithDeadline` termina con stop natural: el proveedor fue llamado, tokens cobrados, tools
     nativas ejecutadas (efectos hechos).
  3. `markCompleted` (L297) lanza por un blip transitorio de red a Postgres.
  4. `catch` -> `handleFailure`; no es shutdown ni permanente; `attempts=1 < 3` -> `markPendingRetry` con
     backoff, y ESTA vez la escritura tiene exito (el blip se resolvio) -> job vuelve a `pending`.
  5. Proximo tick -> `claimNextJob` re-reclama (`attempts=2`) -> **re-ejecuta el run completo** -> segunda
     llamada al proveedor = doble cobro y duplicacion de efectos.
- **IMPACTO:** doble ejecucion real de efectos colaterales; para recetas con tools que escriben, esto
  puede duplicar acciones externas y quemar credenciales/tokens dos (o hasta tres) veces.
- **RECOMENDACION:** hacer idempotente el cierre (p.ej. persistir un `completed` con clave de idempotencia
  ANTES de considerar el job cerrado, o registrar el resultado del run de forma que el re-claim lo detecte
  y no re-ejecute). Alternativa mas barata: distinguir el fallo de `markCompleted` (run ya hecho) del fallo
  de ejecucion y NO reencolar en ese caso (marcar `completed` con reintento de solo-la-escritura).
- **APLICA:** HOY (mono-proceso). No requiere N workers -- el interleaving es puramente secuencial.
- **CONFIANZA: alta** (verificado; ventana estrecha -- exige que `markCompleted` falle y luego
  `markPendingRetry` tenga exito en la misma pasada -- pero realista con blips que se auto-resuelven).

---

### H2 - El reintento de receta re-ejecuta desde el paso 1 (doble ejecucion de efectos por diseno)

- **SEVERIDAD: CRITICA** (doble ejecucion de efectos, garantizada en cada reintento con efectos).
- **UBICACION:** `apps/worker/src/execution.ts:337-439` (`runRecipeJob`); `:356` (`history=[]`), `:359`
  (bucle desde `i=0`), `:398-411` (propaga el fallo del paso); `packages/shared/src/jobs/recipe-payload.ts:26`
  ("...sin checkpoint. recipeId queda como trazabilidad").
- **EVIDENCIA:** `runRecipeJob` no persiste progreso: `history` es local y arranca vacio en cada
  invocacion; el bucle siempre parte de `i=0`. Un paso que falla PROPAGA el error (`throw new Error("fallo
  en el paso ${stepNumber}...")`, L403), que sube al `catch` de `processClaimedJob` -> `handleFailure` ->
  `markPendingRetry`. El numero de paso queda en `last_error` "para diagnostico" (L400-401), NO como
  checkpoint. `markPendingRetry` no guarda indice de paso; el re-claim vuelve a llamar `runRecipeJob` desde
  cero.
- **ESCENARIO:** receta `[s1(escribe A), s2(escribe B), s3]`. Corrida 1: paso 1 escribe A (ok), paso 2
  escribe B y luego `runAgentWithDeadline` lanza un fallo transitorio (proveedor 500 / timeout). `attempts=1
  < 3` -> `markPendingRetry`. Re-claim (`attempts=2`) -> `runRecipeJob` desde el paso 1 -> **re-escribe A**,
  re-corre el paso 2, etc. Hasta `MAX_ATTEMPTS=3` corridas.
- **IMPACTO:** cada reintento duplica los efectos de todos los pasos anteriores al que fallo. Para pasos
  puramente generativos solo re-gasta tokens/dinero; para pasos con efectos externos, duplica acciones.
- **RECOMENDACION:** checkpoint por paso (persistir el `history`/indice del ultimo paso exitoso para
  reanudar), o exigir idempotencia por paso. Si se mantiene "Camino A" (sin checkpoint), documentar el
  contrato de idempotencia esperado de las tools de receta y limitar el uso a pasos idempotentes.
- **APLICA:** HOY (mono-proceso). Es comportamiento de diseno, no un bug latente; acotado a `MAX_ATTEMPTS=3`.
- **CONFIANZA: alta** (verificado; decision explicita y documentada, pero con consecuencia real de
  duplicacion de efectos).

---

### H3 - Jobs `running` huerfanos sin recuperacion (crash / OOM / kill -9)

- **SEVERIDAD: ALTA** (job perdido/colgado, sin dano de datos pero sin retorno).
- **UBICACION:** ausencia de mecanismo -- confirmada en `jobs-repository.ts:196-215` (el claim solo mira
  `pending`), `V015__retention.sql:44-53` (solo borra terminales), y documentada como deuda en
  `apps/worker/README.md:43-44` ("NO existe todavia un 'reaper' de jobs `running` huerfanos ... el reaper
  automatico es alcance de un PR posterior").
- **EVIDENCIA:** la unica via `running -> pending` es `markPendingRetry`, invocada SOLO desde
  `handleFailure`, que requiere que el proceso siga vivo ejecutando TS. Un `kill -9`/OOM no dispara ningun
  handler (`stop()` solo corre por SIGINT/SIGTERM via `index.ts:97-98`; `index.ts` no re-reclama nada al
  arrancar). El re-claim filtra `status='pending'`, asi que un `running` nunca es candidato. Barrido de las
  17 migraciones: ningun `update jobs set status='pending'` de recovery; V010 solo INSERTA jobs nuevos.
  Grep de `sweep|orphan|stale|reaper|reclaim|stuck|requeue`: cero implementaciones.
- **ESCENARIO:** `claimNextJob` -> `running` (commiteado). `processClaimedJob` corre `runAgent`. El proceso
  recibe `kill -9`/OOM ANTES de `markCompleted/markFailed/markPendingRetry`. La fila queda `running`
  persistida. El worker reinicia (Railway `Restart Policy: On Failure`, ver `docs/despliegue-worker.md`) ->
  `claimNextJob` solo mira `pending` -> nunca vuelve a ver ese job. Huerfano permanente.
- **IMPACTO:** el job no se ejecuta ni se reintenta ni se reporta como fallido; queda invisible en
  `running`. `attempts` ya se consumio en el claim. Ademas ocupa espacio de observabilidad enganoso
  ("corriendo" cuando nadie lo corre).
- **RECOMENDACION:** reaper (cron pg_cron o barrido al arranque) que devuelva a `pending` los jobs
  `running` con `started_at` mas viejo que un umbral (p.ej. `> 2 * runTimeoutMs`). Emparejarlo con
  compare-and-set (ver H8) para no pisar un job que un worker vivo todavia esta cerrando.
- **APLICA:** HOY (mono-proceso: una sola instancia que crashea basta). No mejora al escalar: ningun otro
  worker re-reclama un `running` ajeno.
- **CONFIANZA: alta** (verificado; hasta documentado como deuda conocida).

---

### H4 - El watchdog de 10s puede dejar un huerfano en un shutdown graceful

- **SEVERIDAD: ALTA** (mismo resultado que H3 -- job atascado en `running` -- pero por una puerta
  distinta: el apagado ordenado).
- **UBICACION:** `apps/worker/src/index.ts:87-95` (watchdog + cadena de cierre); `worker.ts:62-77`
  (`stop()` hace `await inFlight`); `execution.ts:197-210` (`runAgentWithDeadline` depende de que
  `runAgent` respete `controller.signal`); `execution.ts:467-469` (`markPendingRetry` es la escritura que
  debe persistir en el apagado).
- **EVIDENCIA:** `const watchdog = setTimeout(() => process.exit(0), 10_000)` (L87). Si `stop()` no
  resuelve dentro de 10s -- porque el run ignora el abort (un fetch de proveedor que no cancela) o porque
  `markPendingRetry` tarda contra una DB lenta / pool drenando -- la cadena
  `.then(closeSql).finally(process.exit)` nunca llega y el watchdog fuerza `exit(0)`.
- **ESCENARIO:** SIGTERM (redeploy) -> `stop()` hace `shutdown.abort()` y entra en `await inFlight`. El
  abort NO detiene el run (o `markPendingRetry` esta colgado contra la DB). En t=10s el watchdog ejecuta
  `process.exit(0)`; el UPDATE en vuelo no commitea; la fila queda `running`. Al reiniciar, no hay recovery
  (H3). Huerfano permanente.
- **IMPACTO:** un redeploy normal de Railway (que SIGTERM) puede, en el peor caso, huerfanizar el job en
  vuelo. El README encuadra los huerfanos solo como "proceso muerto de golpe", subestimando este camino
  del apagado graceful.
- **RECOMENDACION:** el reaper de H3 tambien cubre esto. Adicionalmente, considerar persistir el retorno a
  `pending` ANTES de esperar el drain del run (marcar el job re-pending apenas se decide el shutdown, no al
  final del abort), reduciendo la ventana.
- **APLICA:** HOY (ambos); una sola instancia basta. Ventana estrecha (requiere drain colgado > 10s) pero
  consecuencia persistente.
- **CONFIANZA: alta** (verificado; la afirmacion reconoce y acota sus precondiciones correctamente).

---

### H5 - Bloqueo head-of-line: un job lento hambrea la cola entera

- **SEVERIDAD: ALTA** (liveness/throughput; no corrompe datos, pero puede detener la cola por minutos u
  horas HOY).
- **UBICACION:** `apps/worker/src/worker.ts:11-24` (drenado secuencial), `:47-53` (guard `inFlight`);
  `execution.ts:185-188` (deadline por corrida) y `:359-397` (una corrida por paso en recetas);
  `env.ts:31` (`RUN_TIMEOUT_SECONDS` default 600).
- **EVIDENCIA:** `drainQueue` procesa de a uno (`while (...) { await claimAndProcessOne(...) }`), y el
  guard `if (stopped || inFlight) return` impide que el `setInterval` arranque una segunda pasada mientras
  hay una en vuelo. No hay concurrencia intra-proceso. El deadline es POR corrida (`setTimeout(runTimeoutMs)`
  por invocacion de `runAgentWithDeadline`), no un tope total: una receta de N pasos puede correr N*600s.
- **ESCENARIO:** cola `[J_lento, J_A, J_B, ...]`. `tick` -> `drainQueue` reclama `J_lento`, `await
  processClaimedJob(J_lento)`. Si `J_lento` cuelga, se corta a 600s; durante esos 600s el `await` no
  retorna, el `setInterval` encuentra `inFlight != null` y hace `return`: NINGUN otro job se reclama.
  `J_A/J_B` esperan >= 600s. Con una receta de N pasos colgados, hasta ~N*600s (mas reintentos con
  backoff, ya que la receta re-corre desde el paso 1).
- **IMPACTO:** latencia de cola arbitrariamente alta con un solo worker. No es deadlock (cada corrida esta
  acotada a 600s), pero degrada el throughput de toda la plataforma proporcionalmente.
- **RECOMENDACION:** escalar a N workers (el claim ya es seguro) resuelve el hambreado (un worker atascado
  solo pierde su cuota-1). Alternativa/complemento: tope de wall-clock total por job de receta y/o un pool
  de concurrencia intra-proceso acotado.
- **APLICA:** HOY, y SOLO mono-proceso. Con N workers `SKIP LOCKED` reparte la carga y desaparece el
  hambreado global.
- **CONFIANZA: alta** (verificado; la afirmacion no exagera -- acota a `runTimeoutMs` / N*600s, no "para
  siempre").

---

### H6 - Carrera `break`-antes-de-capturar-stop: un run completado puede re-cobrarse

- **SEVERIDAD: MEDIA** (misma familia at-least-once que H1/H2; ventana de timing interna, efecto acotado y
  transitorio).
- **UBICACION:** `apps/worker/src/execution.ts:196-210`.
- **EVIDENCIA:** en el loop de consumo, el chequeo `if (controller.signal.aborted) break;` (L198) esta
  ANTES de capturar el stop (`stopReason = event.reason; usage = event.usage;`, L200-203):

  ```
  197  for await (const event of deps.runAgent({ ...input, signal: controller.signal }, ...)) {
  198    if (controller.signal.aborted) break;          // <- corta ANTES de mirar el evento
  199    if (event.type === 'text_delta') text += event.text;
  200    if (event.type === 'stop') { stopReason = event.reason; usage = event.usage; }
  ...
  207  if (stopReason !== null) return { stopReason, usage, text };   // "el stop natural manda"
  209  if (timedOut) throw new RunTimeoutError(...);
  ```

  El comentario del codigo (L205-207) promete que "un stop natural manda ... aunque el abort se dispare en
  el mismo instante". Eso vale SI el stop se procesa antes de que `aborted` sea observable en el top del
  loop; si el abort gana esa carrera, el `break` de L198 descarta el evento stop, `stopReason` queda
  `null`, y L209 lanza `RunTimeoutError` -> se trata como fallo transitorio -> reintento.
- **ESCENARIO:** el macrotask del `setTimeout` del deadline corre (`timedOut=true`, `controller.abort()`)
  justo cuando `runAgent` ya produjo su evento `stop` final pero el loop aun no lo consumio. Al reanudar
  `await iterator.next()`, el top-check L198 ve `aborted===true` -> `break` -> el stop se pierde ->
  `RunTimeoutError` -> el run YA HECHO se re-encola y re-cobra.
- **IMPACTO:** re-ejecucion/re-cobro de un run que en realidad completo. Acotado a `MAX_ATTEMPTS=3` y
  eventualmente el re-run completa; contradice la garantia literal "no re-cobrar un run ya hecho".
- **RECOMENDACION:** procesar el evento (o al menos capturar el `stop`) ANTES del `break`, o chequear
  `stopReason` antes de romper el loop.
- **APLICA:** HOY (ambos); es timing interno de una sola corrida, no cross-worker.
- **CONFIANZA: media** (depende de si `runAgent` tiene el stop bufferizado y del scheduling exacto entre
  producir y consumir el evento; ventana muy estrecha, pero el camino de codigo es real).

---

### H7 - Los redeploys (SIGTERM) consumen el presupuesto de reintentos

- **SEVERIDAD: MEDIA** (debilita la garantia de reintentos; sin dano de datos).
- **UBICACION:** `jobs-repository.ts:196-215` (el claim SIEMPRE hace `attempts = attempts + 1`) vs
  `:250-260` (`markPendingRetry` NO toca `attempts`); `execution.ts:467-471` (apagado -> `markPendingRetry`)
  y `:487-497` (`attempts >= MAX_ATTEMPTS` -> `markFailed`).
- **EVIDENCIA:** el conteo de intentos lo lleva el claim, no `markPendingRetry`. Un apagado devuelve el job
  a `pending` con `scheduled_for=null` (elegible ya), y el SIGUIENTE claim incrementa `attempts`. El
  comentario en `execution.ts:464-467` solo promete NO `markFailed` en el apagado; NO promete preservar el
  presupuesto. Hay tension real: el codigo trata el apagado como "no es culpa del job" pero igual le come el
  presupuesto via el proximo claim.
- **ESCENARIO:** claim 1 (`attempts=1`) -> SIGTERM (deploy 1) a media ejecucion -> `markPendingRetry`. Claim
  2 (`attempts=2`) -> SIGTERM (deploy 2) -> `markPendingRetry`. Claim 3 (`attempts=3`) -> un fallo
  transitorio REAL -> `job.attempts(3) >= MAX_ATTEMPTS(3)` -> `markFailed`. El job murio tras UN unico fallo
  real, habiendo sido interrumpido dos veces por deploys.
- **IMPACTO:** en periodos de redeploys frecuentes, jobs de larga duracion (recetas) agotan su presupuesto
  de reintentos por interrupciones externas, no por fallos propios, y terminan en `failed` prematuramente.
- **RECOMENDACION:** no contar el apagado contra `attempts`. Opciones: decrementar `attempts` en el camino
  de `ShutdownAbortError`, o mover el incremento fuera del claim (incrementar solo al registrar un fallo
  genuino), o usar una columna separada para intentos "reales" vs re-claims por interrupcion.
- **APLICA:** HOY (mono-proceso: 1 worker en Railway que recibe SIGTERM en cada redeploy). Con N workers el
  fenomeno es identico.
- **CONFIANZA: alta** (mecanica central verificada; el conteo exacto `attempts=3` requiere que el fallo real
  sea el ultimo de los tres claims, pero cada deploy consume una unidad en todos los ordenes).

---

### H8 - Transiciones de estado sin compare-and-set

- **SEVERIDAD: MEDIA** (latente: hoy inocuo, peligroso al agregar un reaper o N workers con recovery).
- **UBICACION:** `jobs-repository.ts` -- `markRunning:218-223`, `markCompleted:226-231`, `markFailed:234-239`,
  `markPendingRetry:250-260`. Todas `... where id = ${id}`, ninguna con `AND status = ...`.
- **EVIDENCIA:** contraste con `claimNextJob` (`:196-215`), que SI filtra estado en el subquery
  (`where status = 'pending' ... for update skip locked`). Ese `SKIP LOCKED` + filtro `pending` da
  semantica de dueno-unico por job: dos workers nunca reclaman el mismo, y un `running` no es
  re-seleccionable. Por eso HOY (y con N workers SIN reaper) no hay transicion invalida alcanzable: cada job
  tiene un unico escritor.
- **ESCENARIO (latente):** si se agrega un reaper que re-transiciona filas `running` -> `pending` (para
  arreglar H3/H4), aparece la carrera: el reaper mueve el job a `pending` y otro worker lo reclama, mientras
  el worker original -- que en realidad seguia vivo y termino -- ejecuta `markCompleted` sobre el mismo id
  sin guarda de estado -> lost update / doble cierre / posible doble ejecucion.
- **IMPACTO:** hoy ninguno. Es una trampa para el futuro: la solucion natural a H3/H4 (un reaper) introduce
  corrupcion de estado si no se agrega compare-and-set a la vez.
- **RECOMENDACION:** al introducir el reaper, convertir las transiciones de cierre en compare-and-set
  (`... where id = $1 and status = 'running'`) y verificar `rowCount` para detectar que otro las gano.
- **APLICA:** solo AL ESCALAR / al agregar recovery de huerfanos. Con N workers puros (sin reaper) sigue
  siendo seguro por el claim.
- **CONFIANZA: alta** (nucleo factico 100% correcto; la severidad depende de agregar el reaper).

---

### H9 - El gate de tier no se re-evalua entre pasos de una receta

- **SEVERIDAD: BAJA** (comportamiento por diseno; se documenta para que la priorizacion lo conozca).
- **UBICACION:** `execution.ts:245-248` (gate una vez, antes de ramificar) y `:337-439` (`runRecipeJob` no
  llama `getProfileTier`).
- **EVIDENCIA:** `const tier = await deps.getProfileTier(job.ownerId); if (tier !== 'autonomous') { throw
  new PermanentExecutionError(...) }` corre UNA vez por job, antes de la rama simple/receta. El bucle de
  receta no re-consulta el tier. Un owner que baja a `free` entre el encolado y la ejecucion se rechaza con
  fallo PERMANENTE -> `markFailed` sin reintentos (`:475-484`). Un downgrade a MITAD de receta (durante los
  N pasos) NO corta los pasos restantes: el gate solo se ve en el proximo job/re-reclamo.
- **IMPACTO:** correcto y deseable en el caso normal (no correr ejecucion autonoma para un plan
  insuficiente). El matiz: una receta larga que empezo con tier valido sigue consumiendo el plan aunque el
  owner baje a media corrida. Es una ventana pequena y aceptable, pero conviene tenerla explicita.
- **RECOMENDACION:** si el corte inmediato importara, re-evaluar el tier por paso (costo: una query extra por
  paso). Para la mayoria de los casos, el comportamiento actual es razonable; solo documentarlo.
- **APLICA:** HOY (ambos); no depende del interleaving entre workers.
- **CONFIANZA: alta** (verificado; comportamiento exacto).

---

### H10 - Precedencia de `timedOut` sobre el apagado

- **SEVERIDAD: BAJA** (caso benigno, ventana muy estrecha).
- **UBICACION:** `execution.ts:209` y `:214` (ambos chequean `timedOut` PRIMERO).
- **EVIDENCIA:** si el deadline y el apagado se disparan a la vez, `timedOut` gana: se lanza
  `RunTimeoutError` (transitorio) en vez de `ShutdownAbortError` (re-pending limpio).
- **ESCENARIO:** un job que alcanza `runTimeoutMs` en el mismo instante en que llega el SIGTERM se trata
  como fallo del intento (cuenta para `attempts`, con backoff) en vez de como interrupcion externa.
- **IMPACTO:** minimo -- un intento "gastado" de mas en un caso de coincidencia exacta. Se solapa con H7.
- **RECOMENDACION:** si se atiende H7, priorizar la clasificacion de apagado sobre timeout cuando
  `shutdownSignal.aborted` sea true.
- **APLICA:** HOY (ambos), benigno.
- **CONFIANZA: alta** (codigo explicito).

---

### H11 - Higiene: drift de defaults y cobertura de tests

- **SEVERIDAD: BAJA** (higiene).
- **UBICACION:** `apps/worker/src/env.ts:26-32` (defaults hardcodeados); ausencia de tests en
  `apps/worker/test/` y `packages/shared/test/`.
- **EVIDENCIA:** el worker hardcodea `RUN_TIMEOUT_SECONDS=600` y `RUN_MAX_TOKENS=1_000_000` "para no acoplar
  el parseo de env al build del backend" (comentario `env.ts:26-30`). Si el backend cambia sus limites
  (`apps/backend/src/agent/limits.ts`), el worker no lo refleja: drift silencioso. Sobre tests: NO existe
  ningun test de concurrencia (dos claims), de crash/huerfano, de fallo de `markCompleted`, ni de N workers
  (grep de `concurren|orphan|crash|kill|markCompleted.*throw`: sin resultados salvo un comentario).
- **IMPACTO:** el drift de defaults es un riesgo operativo menor; los gaps de test dejan sin red las rutas
  mas peligrosas (H1, H3, H6).
- **RECOMENDACION:** un test que fuerce `markCompleted` a lanzar y verifique la doble ejecucion (H1); un
  test de la carrera `break`/stop (H6); documentar el contrato de defaults compartido con el backend.
- **APLICA:** HOY.
- **CONFIANZA: alta.**

---

## 5. Lo que SI es robusto (breve)

Verificado y corroborado adversarialmente -- estas partes NO tienen hallazgos:

- **El claim atomico (nucleo de la cola).** `claimNextJob` (`jobs-repository.ts:196-215`) es un unico
  statement `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)` que marca `running`,
  incrementa `attempts` y setea `started_at` de forma atomica. Dos workers NUNCA toman el mismo job (patron
  canonico de cola en Postgres); no hay ventana entre "seleccionar" y "marcar running". **Sin doble-claim,
  hoy y al escalar.**
- **No hay solapamiento de ticks.** El guard `inFlight` (`worker.ts:47-53`) se evalua sincronicamente antes
  del primer `await`; combinado con el single-thread de Node, dos disparos del `setInterval` no pueden entrar
  ambos a `drainQueue`. **Auto-solapamiento cerrado.**
- **No hay estado en memoria compartido entre recetas.** `history`/`usage` son locales a cada invocacion de
  `runRecipeJob` (`execution.ts:356-357`); no hay estado a nivel de modulo. Dos recetas (secuenciales o en N
  procesos) no comparten ni mezclan estado. El encadenamiento conversacional (user+assistant por paso,
  `:418-419`) es correcto y no duplica mensajes (verificado por los tests `execution.test.ts:378-431`).
- **Limpieza de timers/listeners sin fugas.** `runAgentWithDeadline` hace `clearTimeout` y
  `removeEventListener` SIEMPRE en `finally` (`:217-220`), con listener `{ once: true }`. Los tests confirman
  `getTimerCount() === 0` tras timeout (`execution.test.ts:250, 522`).
- **Backoff y conteo de intentos correctos en el camino normal.** `attempts` se incrementa exactamente una
  vez por claim; el backoff lineal (`attempts * 5000ms`) crece por intento; `MAX_ATTEMPTS=3` se respeta; no
  hay reintento infinito (cada re-claim incrementa, y a los 3 va a `failed`).
- **El corte de contexto de receta funciona.** `RECIPE_MAX_CONTEXT_CHARS=200_000` se chequea antes de armar
  cada paso (`:373-379`); un historial que excede el tope corta con fallo claro indicando el paso (test
  `execution.test.ts:540-555`).
- **El gate de tier es server-side** (nunca confia en el cliente) y corre una vez por job para ambos caminos
  (simple/receta), antes de gastar nada (`:245-248`).
- **Aislamiento de fallos:** un job roto no tumba el loop (`processClaimedJob` nunca propaga; `drainQueue`
  captura fallos del ciclo y corta la pasada sin bucle apretado contra una DB caida, `worker.ts:16-21`).
- **Acoplamiento worker <-> backend sano (J).** El worker consume el motor via el subpath curado
  `@ledesma-platform/backend/execution` (funciones/repos sin estado, instanciados con el `sql` del worker).
  El unico estado compartido es la BASE DE DATOS; no hay estado en memoria compartido entre procesos ni
  dependencia de orden de arranque en runtime (el worker solo necesita la DB; el backend HTTP puede estar
  caido). La unica dependencia de orden es de BUILD (`shared -> backend -> worker`), documentada.
- **Las alertas por correo son best-effort totales:** nunca bloquean el cierre del job ni tumban el loop
  (`execution.ts:447-457`, `alertas.ts:220-227`); el cooldown en memoria es aceptable para mono-proceso.
- **No se filtra el payload** (mensajes del usuario) en logs, listados de observabilidad ni correos de
  alerta.

---

## 6. Cobertura y alcance

**Archivos leidos:** `apps/worker/src/{index,worker,execution,db,env,logger,alertas}.ts`;
`packages/shared/src/jobs/{jobs-repository,types,recipe-payload}.ts`; migraciones
`V008` (jobs), `V009/V010/V011` (scheduler), `V015/V016` (retencion); tests
`apps/worker/test/{execution,worker}.test.ts` y `packages/shared/test/jobs-repository.test.ts`;
`apps/worker/README.md` y `docs/despliegue-worker.md`.

**Metodo:** trazado paso a paso de cada escenario de concurrencia/interrupcion del checklist (A-J),
identificando el interleaving exacto o confirmando que la ventana esta cerrada. Cada hallazgo se sometio a
una pasada de **verificacion adversarial independiente** (12 revisores, uno por escenario, con la consigna
de REFUTAR contra el codigo real). Resultado: 8 CONFIRMED y 2 PARTIAL sobre las afirmaciones de bug (las
PARTIAL matizaron la severidad de H6 y el alcance de H8, ya reflejado arriba); las 3 afirmaciones de
"esto es robusto" (claim atomico, sin solapamiento de ticks, sin estado compartido) quedaron CONFIRMED.

**Cobertura de tests (lo que existe vs los gaps):**

| Cubierto por tests | Gap (sin test) |
|---|---|
| Camino feliz simple y receta; encadenamiento de historial; acumulacion de tokens | Doble ejecucion por fallo de `markCompleted` (H1) |
| Fallo transitorio -> retry/backoff; `attempts >= MAX` -> failed | Crash/OOM entre claim y cierre -> huerfano (H3) |
| Gate de tier -> failed permanente (simple y receta) | Watchdog forzando exit con drain colgado (H4) |
| Timeout de pared por paso; limpieza de timers | Carrera `break`/stop (H6) |
| Apagado entre pasos -> re-pending; corte de contexto | Consumo de `attempts` por redeploys (H7) |
| Fallo en paso intermedio -> corta receta con el paso en `last_error` | Concurrencia real de dos workers / N-workers |
| `drainQueue` no se cae por un job roto; corta ante DB caida | Fallo de `markPendingRetry` (propagacion al loop) |
| SQL del claim contiene `FOR UPDATE SKIP LOCKED` (contrato, no ejecucion real contra PG) | Prueba de integracion contra Postgres real del claim concurrente |

Los gaps de la columna derecha son, por si mismos, parte de los hallazgos (H11): las rutas mas peligrosas
(doble ejecucion, huerfanos) son justamente las que no tienen cobertura.

**Fuera de alcance (no auditado en profundidad):** la implementacion interna de `runAgent`/`assembleAgentRun`
del backend (si el `AbortController` realmente cancela el fetch del proveedor es una dependencia critica de
H4 y H6, pero vive en el motor del backend, auditoria de otro bloque); el scheduler pg_cron (V010/V011) mas
alla de confirmar que solo INSERTA jobs `pending`; la boveda de credenciales.

**Restricciones de la auditoria:** read-only; no se ejecuto nada contra produccion; no se encolaron jobs
reales.
