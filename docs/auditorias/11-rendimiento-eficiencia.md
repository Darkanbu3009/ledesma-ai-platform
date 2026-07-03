# Auditoria 11 (Bloque C): Rendimiento y eficiencia

- **Fecha:** 2026-07-03
- **Alcance:** los tres ejes de rendimiento que importan al negocio: (1) latencia/eficiencia de la base de datos (queries vs indices), (2) eficiencia de TOKENS y COSTO por ejecucion en dinero real, y (3) rendimiento del frontend (bundle, carga, render). Cubre `apps/backend`, `apps/worker`, `apps/console`, `packages/shared`, `packages/widget` y las migraciones `apps/backend/migrations/V001..V017`.
- **Tipo:** auditoria READ-ONLY. **No se modifico ningun archivo** (ni codigo, ni SQL). Correr los builds de la consola y del widget (read-only, seguro) SI se hizo, para reportar tamanos reales. NO se ejecuto ninguna carga contra produccion ni benchmark contra el API real (contaminaria/costaria); todo lo demas es razonamiento sobre el codigo y los planes de query.
- **Metodo:** para queries, se leyo cada repositorio y ruta que emite SQL y se cruzo cada `WHERE`/`ORDER BY`/`JOIN` contra los indices declarados en las migraciones; para tokens, se leyo el ensamblado del contexto (`assemble-agent-run`, el loop de `run-agent`, `runRecipeJob`, `map-request`) y se modelo el costo en dolares con precios reales de proveedor; para frontend, se **corrio el build** de la consola y del widget y se reportan tamanos reales. Cada hallazgo lleva evidencia `path:linea`. Se corrio ademas un pase de verificacion adversarial (un verificador por hallazgo ALTA/MEDIA que intento refutar la ubicacion y los numeros); el auditor re-verifico de forma independiente los hallazgos de mayor severidad (no-caching, modelo de costo, tamanos de bundle, indices faltantes).
- **Pregunta central de cada hallazgo:** "que es innecesariamente lento, caro, o pesado, y CUANTO?" -- cuantificado en queries, KB, tokens o dolares, y marcado con la ESCALA a la que muerde (hoy pre-lanzamiento vs al escalar).

---

## 1. Resumen ejecutivo

**Veredicto por eje:**

- **Base de datos: SOLIDA.** Las migraciones fueron escritas con las queries calientes en mente. El claim del worker, el disparo del cron cada minuto, los listados por owner y el dashboard de uso tienen indice de respaldo. Los pocos huecos son concretos y menores a la escala actual: dos columnas FK sin indice en el camino de `/v1/me` (empiezan a doler a miles de usuarios) y la duda razonable de si el `OR` del claim rompe el orden del indice (a confirmar con EXPLAIN). No se encontro ni un solo N+1, ni un `SELECT *`, ni sobre-devolucion del `payload` jsonb en los listados. El riesgo estructural es el **crecimiento sin techo** de `jobs`/`agent_runs` con la retencion opt-in sin activar.
- **Tokens y costo: EL EJE MAS CARO, y HOY.** El motor **no usa prompt caching**: cada iteracion del loop agentico y cada paso de receta re-envia el prefijo estable (system + tools) y TODO el historial acumulado a precio de input completo. El costo de un run no es lineal en el trabajo util sino **cuadratico en el numero de rondas de tools**. Sumado a defaults muy permisivos (`RUN_MAX_TOKENS=1M` por run, sin presupuesto agregado por owner) y a un techo de receta enganoso (el corte de 200k caracteres es solo ENTRE pasos; dentro de un paso el cap real es 1M tokens), el diseno actual factura **~2x a ~10x mas de lo necesario** y expone a facturas sorpresa. **Matiz de negocio clave:** la plataforma es BYOK end-to-end (verificado: no hay key LLM de plataforma en `config/env.ts`), asi que **el costo de tokens lo paga el CLIENTE con su key, no Ledesma**. Igual importa -- y mucho: percepcion, competitividad y confianza (una receta que quema $25 en la key del cliente es churn).
- **Frontend: el widget EXCELENTE, la consola MEJORABLE.** El widget embebido (lo que se inyecta en sitios de clientes, donde el peso importa mas) pesa **14 kB / 4.48 kB gzip** -- patron eficiente (web component vanilla, Shadow DOM, streaming O(1)). La consola en cambio es **un unico chunk de 877.72 kB (233.32 kB gzip)** sin nada de code-splitting: la landing publica y las 17 paginas del dashboard viajan juntas. No es catastrofico, pero es el mayor ahorro estructural disponible y afecta la primera impresion.

**Que importa HOY (pre-lanzamiento) vs al ESCALAR:**

- **Importa HOY** (muerde desde el primer cliente o es una decision de diseno que se toma ahora): la ausencia de prompt caching (afecta el 100% de los runs con tools desde el dia 1), los defaults de `RUN_MAX_TOKENS=1M` sin budget agregado, y el techo real de receta de 5M tokens.
- **Importa AL ESCALAR** (irrelevante con ~0 usuarios, degrada con uso normal concurrente): la extraccion sincrona de adjuntos que congela toda la instancia, los dos indices FK faltantes en `/v1/me`, el bundle monolitico de la consola, el rate-limit en memoria no distribuido, y el crecimiento sin techo de las tablas.

### Hallazgos por severidad

| Severidad | Cant. | Que representa |
| --- | ---: | --- |
| **ALTA** | 3 | Cuello de botella o costo que importa HOY o degrada con uso normal. Los tres son del eje tokens/costo. |
| **MEDIA** | 13 | Ineficiencia real que importa al escalar (o decision de defaults a tomar ahora). |
| **BAJA** | 13 | Optimizacion menor, inconsistencia, o item informativo. |

*(El pase adversarial verifico los 16 hallazgos ALTA/MEDIA contra la fuente: **16 CONFIRMADOS, 0 refutados**. Ninguna severidad se movio.)*

**El unico riesgo de costo DIRECTO de Ledesma a verificar** esta fuera de este repo: el servicio externo `WEB_WORKER` (automatizacion web, hasta 25 pasos, firmado con secreto de PLATAFORMA). Si ese servicio corre su propio LLM con una key de plataforma, esos tokens son COGS de Ledesma y quedan fuera del cap `RUN_MAX_TOKENS`. No es verificable aqui (solo estan `backend`/`console`/`worker`).

---

## 2. Modelo de costo por ejecucion (el eje de negocio)

Precios de referencia (cutoff, por 1M tokens): **Opus 4.8/4.7/4.6 = $5 input / $25 output**; **Sonnet 5/4.6 = $3 / $15**; **Haiku 4.5 = $1 / $5**. Los modelos que la consola sugiere por defecto (`lib/model-catalog.ts:8`) son Opus y Sonnet, asi que un agente tipico corre a $5/$25 o $3/$15.

### 2.1 Que dispara el costo

**El driver principal es la ausencia de prompt caching.** `mapRequestToAnthropic` (`apps/backend/src/providers/anthropic/map-request.ts:44-68`) **nunca** setea `cache_control` -- ni sobre `system`, ni sobre `tools`, ni sobre `messages`. Y el loop agentico (`apps/backend/src/agent/run-agent.ts:67-68`) reconstruye en cada iteracion `turnRequest = { ...input.request, messages }` con el historial acumulado y se lo re-envia entero al modelo. `runAgent` **suma** el `usage` de cada llamada (`run-agent.ts:96-97`), asi que ese acumulado ES la factura real del proveedor. La formula del costo de input de un run es:

> `input_total = Suma_iteracion ( prefijo_estable + historial_hasta_esa_iteracion )`

Como el historial crece en cada ronda de tools y se re-cobra completo, **el costo crece con el cuadrado del numero de rondas**, no linealmente con el trabajo util.

### 2.2 Cuenta concreta: ejecucion simple con tools

Agente con `systemPrompt` ~1.000 tok + 3 tools (~500 tok de schemas) = **prefijo estable ~1.500 tok**. Hace 5 rondas de tool-calling con `tool_result` de ~1.000 tok cada uno (6 llamadas al modelo en total):

| Llamada | Input enviado (tok) |
| --- | ---: |
| 1 | 1.700 |
| 2 | 2.850 |
| 3 | 4.000 |
| 4 | 5.150 |
| 5 | 6.300 |
| 6 | 7.450 |
| **Total input** | **27.450** |

Con ~1.050 tok de output: **Opus $0.164 / Sonnet $0.098 por UNA ejecucion**. La "expectativa naive" de una sola llamada (1.700 tok) seria ~$0.016 en Opus: **el loop sin cache cuesta ~10x eso**. Con caching agresivo (lecturas del prefijo a 0.1x, escritura 1.25x) esa misma ejecucion baja a **~$0.083 en Opus (-49%)**; en loops largos o recetas donde el prefijo/historial domina, el ahorro sube a **~80-90%**.

Escalando a 20 iteraciones (el cap `maxIterationsCap`, `limits.ts:15`) con `tool_result` de 2k-4k tok: **489.000 a 909.000 tok de input = Opus $2.5 a $4.6 en UN run**, sin que nada este "roto" -- es un agente con tools que trabaja de verdad.

### 2.3 Recetas: el techo real es 5M tokens, no 50k

`runRecipeJob` (`apps/worker/src/execution.ts:337-439`) corre cada paso como una llamada `runAgent` SEPARADA que ACUMULA `[user, assistant]` de los pasos previos (`execution.ts:418-419`) y re-envia ese historial entero en cada paso **Y** dentro del loop interno de tools de cada paso -- doblemente cuadratico. Una receta de 5 pasos "normal" (paso ~500 tok user, ~2.000 tok output, prefijo 1.500) acumula ~35.000 tok de input = **Opus $0.43 / Sonnet $0.26**.

Pero el corte de seguridad `RECIPE_MAX_CONTEXT_CHARS=200.000` (`execution.ts:43`, ~50k tokens) se evalua **SOLO al inicio de cada paso** (`execution.ts:373-379`). Dentro de un paso, `runAgent` corre su propio loop con cap **`RUN_MAX_TOKENS=1M` independiente por paso** (`execution.ts:390`). El nombre "limite de 200k caracteres" sugiere un techo de ~50k tokens, pero el techo REAL de una receta de 5 pasos es **5M tokens = Opus $25 (input-heavy) a $125 (output-heavy) por una sola corrida**. Ademas, si un paso tardio falla, el job entero re-corre **DESDE EL PASO 1 hasta 3 veces** (`MAX_ATTEMPTS=3`, sin checkpoint, `execution.ts:332-335`): los pasos previos se pagan hasta 3x.

### 2.4 Topes y runaway

`RUN_MAX_TOKENS=1M` y `RUN_TIMEOUT=600s` (`limits.ts:31,37`, override en `env.ts:41-42`) son topes por-run muy altos. Un agente mal configurado o un loop de tools que no converge quema hasta **1M tok antes de cortar = Opus $5 (todo input) a $25 (todo output), mixto ~$15, en UN run**. No existe ningun presupuesto agregado por owner ni por dia: nada chequea gasto ANTES de arrancar el run (`agent_runs` solo registra metadatos DESPUES, `run-agent-by-id.ts:234-246`). Para pre-lanzamiento, es el momento de bajar el default.

### 2.5 Donde el diseno es EFICIENTE vs DERROCHADOR

**Eficiente:**
- El cap de tokens se evalua ENTRE iteraciones con el uso ACUMULADO real y corta limpio con `stop:'token_cap'` sin ejecutar la ronda excedente (`run-agent.ts:113-119`); `maxIterations` tiene cota dura de 20 validada (`limits.ts:15`, `validateAgentRun`). Frena loops runaway a nivel iteracion.
- Contabilidad de tokens correcta: lo que se graba en `agent_runs` = la factura real (no hay under-reporting).
- El `demo-registry` es trivial (una sola tool `get_current_time`, ~30 tok) y solo se inyecta cuando el agente no tiene ninguna tool (`assemble-agent-run.ts:88`): no infla nada.
- Output del configurador capado en 4.096 tok (`CONFIGURATOR_MAX_OUTPUT_TOKENS`): acota el lado caro (output).
- Dedupe de tools con precedencia nativa (`assemble-agent-run.ts:92-102`): el modelo nunca recibe dos schemas con el mismo nombre.

**Derrochador:**
- Sin prompt caching (sec. 2.1): el mayor lever, recuperable HOY.
- Acumulacion cuadratica sin tope de contexto DENTRO del run (`maxTotalContentChars=200k` solo valida el body inicial, no el historial del loop).
- Tools nativas (~500 tok de schemas) inyectadas en TODOS los agentes cuando `WEB_WORKER` esta configurado, aunque el agente nunca use automatizacion web (`assemble-agent-run.ts:82-102`, `native-tools.ts:60-73`): ~10.5k tok/run desperdiciados en el cap.
- Configurador re-envia system (~800 tok) + catalogo + historial cada turno sin cache (`configurator-service.ts:113-118`).

### 2.6 Quien paga

**El CLIENTE, en todos los caminos verificables.** La ejecucion sincronica (`run-agent-by-id.ts:162-181`), el worker autonomo (`execution.ts:283`, resuelve la key de la boveda del owner) y el configurador (`configurator-service.ts:122-136`) usan la key del cliente (header / session-token / boveda). **No existe `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` de plataforma en `config/env.ts`.** Por eso Ledesma no paga inferencia por estos caminos -- el costo lo genera y lo paga quien hace la request. **Unica excepcion a verificar fuera de este repo:** el `WEB_WORKER` externo (ver sec. 1).

**Por que importa igual:** el no-caching + acumulacion cuadratica hace que cada factura del cliente sea ~2x-10x mas alta de lo necesario; un competidor con caching factura la mitad por el mismo agente. Y los defaults de 1M/receta-5M sin budget agregado exponen al cliente a facturas sorpresa en SU key.

---

## 3. Matriz de queries calientes x indices

Leyenda: **OK** = query caliente con indice de respaldo que resuelve filtro y orden -- **~** = indexada pero con posible sort/scan residual (a confirmar con EXPLAIN) -- **XX** = sin indice de respaldo.

| Query (path:linea) | Filtro / orden | Indice de respaldo | Estado |
| --- | --- | --- | :--: |
| Claim del worker `jobs-repository.ts:196-215` | `status='pending' AND (scheduled_for IS NULL OR <=now()) ORDER BY created_at` | `jobs_pending_claim_idx (status,scheduled_for,created_at)` V008 | **~** |
| Cron `enqueue_due_scheduled_tasks` V010:182-195 | `is_active=true AND next_run_at<=now()` | `scheduled_tasks_due_idx (is_active,next_run_at)` V009 | **OK** |
| `jobs.listByOwner` `jobs-repository.ts:166-187` | `owner_id=$ [AND status=$] ORDER BY created_at DESC LIMIT/OFFSET` | `jobs_owner_created_idx (owner_id,created_at desc)` V017 | **OK** |
| Usage dashboard `run-repository.ts:96-168` | `agent_id=$ [AND created_at range] ORDER BY created_at DESC` | `agent_runs_agent_created_idx (agent_id,created_at desc)` V003 | **OK** |
| Webhook entrante `triggers-repository.ts:229-238` | `id=$` (PK) | PK | **OK** |
| Gate por tier `getProfileTier` (worker, cada job) | `profiles.id=$` (PK) | PK | **OK** |
| `resolveCredential` `resolve-stored-credential.ts` | `id=$ AND owner_id=$` | PK | **OK** |
| `/v1/me` subscriptions `registration-repository.ts:162-165` | `profile_id=$ ORDER BY created_at DESC LIMIT 1` | **ninguno** (V005 solo PK + FK) | **XX** |
| `/v1/me` usage_counters `registration-repository.ts:169-172` | `profile_id=$ ORDER BY created_at DESC LIMIT 1` | **ninguno** (V005 solo PK + FK) | **XX** |
| `agents.listByOwner` `agent-repository.ts:121-128` | `owner_id=$ ORDER BY created_at DESC` | `agents_owner_id_idx (owner_id)` -- solo owner | **~** |
| `credentials/recipes/scheduled_tasks/triggers/consents/... listByOwner` | `owner_id=$ ORDER BY created_at DESC` | indices solo `(owner_id)` | **~** |
| Erasure GDPR `retention-repository.ts:84-86` | `DELETE FROM agent_runs WHERE owner_id=$` | **ninguno** por owner_id (solo agent_id, created_at) | **XX** |
| Purga retencion (runs / jobs terminales) V015:37-53 | `created_at<cutoff` / `status IN(..) AND finished_at<cutoff` | `agent_runs_created_at_idx`, `jobs_status_finished_at_idx` V015 | **OK** |

**Indices faltantes que importan (por orden de impacto):**

1. **`subscriptions.profile_id` y `usage_counters.profile_id`** (los dos **XX** del camino `/v1/me`, MEDIA). `GET /v1/me` corre 2-4 queries en serie (`loadState`); dos de ellas son seq-scan + sort sobre esas tablas. `/v1/me` se llama en cada carga de la consola y validacion de sesion. Hoy con <100 profiles cada scan es <1ms; a ~1-5k profiles empieza a doler y retiene una de las 5 conexiones del pool.
2. **`agent_runs (owner_id)`** (BAJA): el erasure GDPR seq-scanea la tabla de mayor crecimiento. Operacion rara, por eso BAJA, pero su latencia crece sin techo sin retencion activa.
3. **Consistencia de listados por owner** (BAJA): `jobs` recibio el compuesto `(owner_id, created_at desc)` en V017; sus hermanas (`agents`, `credentials`, `recipes`, `scheduled_tasks`, `triggers`, tablas de privacidad) siguen con indice solo `owner_id` y ordenan en memoria. Trivial por-owner (colecciones de ~1-50 filas); solo importa si un owner acumula miles de filas en una de esas tablas (poco probable) -- y ademas esos listados no tienen `LIMIT`/paginacion.

**No es un hueco (aclaracion):** `triggers_url_token_hash_key` (V012) NO respalda ninguna lectura -- el dispatch de webhooks entra por PK (`:id`) y verifica el token en la app en tiempo constante. El indice solo garantiza unicidad. Esto es correcto (evita timing por indice).

---

## 4. Tamano de bundle del frontend (numeros reales del build)

Build de produccion corrido localmente (Vite 8, `npm run build`):

| Artefacto | Raw | Gzip | Notas |
| --- | ---: | ---: | --- |
| **Consola** `dist/assets/index-*.js` | **877.72 kB** | **233.32 kB** | UN solo chunk, 2018 modulos, warning Vite ">500 kB" |
| Consola `dist/assets/index-*.css` | 44.16 kB | 8.89 kB | Tailwind |
| Consola `dist/index.html` | 1.07 kB | 0.50 kB | |
| **Widget embebido** `dist/ledesma-agent.js` | **14.01 kB** | **4.48 kB** | 8 modulos, iife, sin CSS aparte (Shadow DOM) |

**Descomposicion estimada del gzip 233 kB de la consola:** react + react-dom ~45 kB, `@supabase/supabase-js` ~38 kB, react-query ~12 kB, zod ~13 kB (solo forms), react-hook-form + resolvers ~9 kB (solo forms), react-router ~7 kB, lucide (~66 iconos, tree-shakeados) ~10 kB, tailwind-merge ~7 kB, y el codigo de app (landing animada + 17 paginas + dialogos + SSE) ~55-70 kB.

**Que lo causa:** `App.tsx:2-22` importa **de forma eager las 17 paginas** del dashboard + toda la landing (`landing/hero-showcase`, `brain-swap`, `integration-chat-widget` de ~630 loc, `examples`, `integration` = ~1.900 loc) + las paginas legales de privacidad. **Cero code-splitting**: `grep` de `React.lazy`/`Suspense`/`import(` en todo `src` = 0 matches. Y `vite.config.ts:4-6` no define `manualChunks`, asi que el vendor estable (react-dom, supabase, react-query = ~100 kB gzip que casi nunca cambian) comparte hash con el codigo de app y se re-descarga entero en cada deploy.

**Ahorro potencial (dimensionado, sin implementar):** con `React.lazy` separando la ruta publica `/` del arbol autenticado, un visitante de la landing podria diferir **~55-65 kB gzip** (zod, react-hook-form, todas las paginas del dashboard) fuera del critical path, y un usuario del dashboard **~20 kB gzip** (la landing animada que nunca vera). Con un `manualChunks` de vendor, el usuario recurrente solo bajaria el delta de app (~55-70 kB) entre deploys en vez de los 233 kB completos.

**El widget es la referencia de eficiencia:** web component vanilla con Shadow DOM, sin framework, estilos inline, tipografia del sistema, y streaming O(1) (`appendDelta` muta el `textContent` de un unico nodo por token, `element.ts:566-576`). 4.48 kB gzip para algo que se inyecta en sitios de terceros es excelente.

---

## 5. Hallazgos por severidad

### ALTA -- importa HOY o degrada con uso normal

Los tres ALTA son del eje tokens/costo (sec. 2). Se resumen aqui con los campos del metodo.

**A1. Sin prompt caching: cada iteracion/paso re-paga el prefijo estable + todo el historial.**
- **Ubicacion:** `apps/backend/src/providers/anthropic/map-request.ts:44-68` (nunca setea `cache_control`); `apps/backend/src/agent/run-agent.ts:68` (re-envia el prefijo + historial completo cada iteracion) y `:96-97` (suma el usage = la factura).
- **Evidencia:** ejecucion de 5 rondas de tools = 27.450 tok input = Opus $0.164; con caching ~$0.083 (-49%); en loops largos el ahorro sube a 80-90%. Afecta el 100% de los runs con tools.
- **Impacto:** duplica-a-decuplica CADA factura de CADA run desde el dia 1. En BYOK lo paga el cliente, pero es el mayor lever de percepcion/competitividad. 100% recuperable.
- **Escala:** importa HOY (pre-lanzamiento).
- **Recomendacion:** setear `cache_control` (ephemeral) sobre `system` y `tools` (prefijo estable) y un breakpoint incremental al final del historial en `map-request.ts`; el prefijo se cachea una vez y las iteraciones lo leen a 0.1x.

**A2. El loop de tools acumula contexto cuadraticamente sin tope de contexto DENTRO del run.**
- **Ubicacion:** `run-agent.ts:63-68,135,153` (push de assistant + tool_result al historial que se re-envia entero); `agent/limits.ts:11` (`maxTotalContentChars=200k` solo valida el body inicial, no el historial del loop).
- **Evidencia:** 20 iteraciones (cap) con `tool_result` de 2k-4k tok = 489.000-909.000 tok input = **Opus $2.5-$4.6 en UN run**.
- **Impacto:** un agente con tools que trabaja de verdad puede costar $2-5 por ejecucion en Opus sin que nada este roto. Driver compuesto con A1.
- **Escala:** importa al ESCALAR (agentes con tools reales y resultados grandes).
- **Recomendacion:** aplicar caching (A1) y evaluar un tope de tokens de CONTEXTO por iteracion (truncado/resumen) ademas del cap acumulado; hoy `maxTotalContentChars` ni se re-chequea dentro del loop.

**A3. `RUN_MAX_TOKENS=1M` por run es muy alto y no hay presupuesto agregado por owner/dia.**
- **Ubicacion:** `agent/limits.ts:37` (`DEFAULT_RUN_MAX_TOKENS=1_000_000`); `config/env.ts:42`; `routes/run-agent-by-id.ts:234-246` (`agent_runs` se graba DESPUES, sin gate de presupuesto previo).
- **Evidencia:** un loop que no converge quema hasta 1M tok = Opus $5-$25, mixto $15, en UN run. No hay cap de gasto por owner ni por dia; nada chequea presupuesto antes de arrancar.
- **Impacto:** un bug, un trigger repetido o un prompt mal armado produce una factura inesperada en la key del CLIENTE. Aunque no es costo de Ledesma, una factura sorpresa destruye confianza.
- **Escala:** importa HOY como diseno de defaults (pre-lanzamiento es el momento de bajarlo).
- **Recomendacion:** bajar el default a algo conservador (p.ej. 100k-250k tok) y agregar un presupuesto agregado por owner (tokens/$ por dia) chequeado ANTES de arrancar el run; dejar 1M como opt-in para tiers altos.

### MEDIA -- importa al escalar (o decision de defaults a tomar ahora)

**M1. Techo de receta enganoso: cap por paso, no por receta (hasta 5M tok).** `apps/worker/src/execution.ts:43,373-379,390`. El corte de 200k chars es solo ENTRE pasos; cada paso corre con su propio `RUN_MAX_TOKENS=1M`. Receta de 5 pasos = hasta 5M tok = Opus $25-$125. El cliente que ve "limite 200k caracteres" no espera ese techo. **Reco:** presupuesto de tokens a nivel RECETA (suma de pasos); `runMaxTokens` por-paso mas chico para recetas.

**M2. Receta re-corre desde el paso 1 hasta 3 veces (sin checkpoint).** `execution.ts:332-335,359-428,30,487-501`. Un fallo en el paso 5 re-ejecuta 1-4 hasta 3 veces (`MAX_ATTEMPTS=3`). Amplificador de costo 3x sobre el prefijo. **Reco:** checkpoint por paso (persistir el historial hasta el ultimo paso ok) o reintento a nivel paso, no job.

**M3. Tools nativas (~500 tok) inyectadas en TODOS los agentes con `WEB_WORKER` activo.** `assemble-agent-run.ts:82-102`, `native-tools.ts:60-73`. Un agente que nunca usa automatizacion web desperdicia ~500 tok/llamada = hasta ~10.5k tok/run en el cap. **Reco:** inyectar nativas solo si el agente las declara/opta (flag por agente); o al menos cachearlas.

**M4. `WEB_WORKER` externo: unico camino potencial de costo DIRECTO de Ledesma.** `native-tools.ts:64,96-117`, `config/env.ts:34-35`. `ejecutar_tarea_web` es un agente web de hasta 25 pasos firmado con secreto de PLATAFORMA; si ese servicio externo corre un LLM con key de plataforma, esos tokens son COGS de Ledesma sin el cap del motor. **A verificar fuera de este repo.** **Reco:** confirmar que key/LLM usa el `WEB_WORKER`; si es de plataforma, aplicarle su propio cap y contabilizarlo.

**M5. Falta indice en `subscriptions.profile_id` y `usage_counters.profile_id`: `/v1/me` hace 2 seq scans por request.** `registration-repository.ts:162-172`; `V005__registration.sql:48-68`. `/v1/me` se llama en cada carga de la consola. Hoy <1ms; a ~1-5k profiles la latencia crece lineal. **Reco:** `create index on subscriptions (profile_id, created_at desc)` y sobre `usage_counters (profile_id, created_at desc)` (el segundo campo tambien resuelve el `ORDER BY ... LIMIT 1` sin sort). Confirmar con EXPLAIN #4/#5. *(Verificado en el pase adversarial: CONFIRMADO.)*

**M6. El `OR` del claim probablemente rompe el walk ordenado del indice.** `jobs-repository.ts:196-215`; `V008__jobs.sql:61`. El predicado `status='pending' AND (scheduled_for IS NULL OR <=now()) ORDER BY created_at` con el `OR IS NULL` suele degradar a Index Scan sobre `status='pending'` + **Sort** por `created_at` + Limit. Ademas la particion `pending` incluye jobs futuros (backoff de `markPendingRetry:250-260`) que el claim recorre y descarta. Es el cuello mas caro del camino caliente de ejecucion. **Reco:** correr EXPLAIN #1; si aparece un nodo `Sort`, evaluar un indice parcial `create index on jobs (created_at) where status='pending'`. No implementar sin confirmar el plan. *(Verificado: CONFIRMADO, sustancia y numeros correctos.)*

**M7. `agent_runs` y `jobs` crecen sin techo; la retencion (V015/V016) es opt-in y se activa a mano.** `V015__retention.sql:26-57` + V016; inserts en `run-agent-by-id.ts:234-246` y via scheduler/triggers. A 10k runs/dia: ~3.65M filas/ano en `agent_runs` (~1-2 GB con indices). Las queries siguen indexadas pero empeoran (sort-in-memory, seq scan del erasure, paginacion OFFSET, bloat de VACUUM). **Reco:** activar el cron de retencion (V016) antes o al lanzar; verificar en Supabase que el cron job este SCHEDULED, no solo la funcion creada.

**M8. Cero code-splitting: landing publica + 17 paginas en un chunk de 877 kB.** `App.tsx:2-22,29-64`; `vite.config.ts:4-6`. Ver sec. 4. **Reco:** `React.lazy` + `<Suspense>` para separar la ruta publica `/` del arbol autenticado; segundo nivel opcional para Playground/Configurador (SSE) y paginas legales.

**M9. Sin `manualChunks`: el vendor estable se re-descarga entero en cada deploy.** `vite.config.ts:1-6`. Cualquier cambio de una linea de app invalida el hash del bundle completo (~100 kB gzip de vendor que no cambio). **Reco:** aislar react/react-dom/react-router y `@supabase` en chunks vendor cacheables (immutable).

**M10. Waterfall serial de ~4 fetches antes del primer contenido del dashboard.** `AuthProvider.tsx:17-27` (getSession) -> `RegistrationGate.tsx:13-21` (`/v1/me`) -> `ConsentGate.tsx:19-28` (`/v1/consents/me`) -> pagina (`/v1/agents`). Los gates anidados bloquean cada uno el render del siguiente con `isLoading` full-screen. `/me` y `/consents/me` solo dependen de la sesion, no entre si. En carga fresca/refresh: ~4 round-trips en serie = ~600-1000 ms de espera encadenada. Mitigado en navegacion SPA (los gates usan `isLoading`, no `isFetching`, asi que con cache pasan al instante). **Reco:** prefetch en paralelo de `/v1/me` y `/v1/consents/me` apenas hay sesion, o combinar registro+consentimiento en un endpoint.

**M11. Auto-refresh de `/actividad` refetchea TODAS las paginas cargadas cada 10s.** `lib/queries.ts:81-94`, `lib/jobs.ts:43,79-89`. `useJobs` es `useInfiniteQuery`; refetchear un infinite query re-consulta TODAS las paginas. Con P paginas cargadas ("Cargar mas" P veces) y un job pending/running, cada tick = P requests. Un job colgado en `running` (crash del worker) mantiene el poll indefinidamente. Bien acotado en dos sentidos buenos (no poolea si no hay jobs en vuelo; pausa con el tab oculto). **Reco:** refetchear solo la primera pagina en el intervalo, y/o poner un techo temporal al poll de un `running` que no cierra.

**M12. Extraccion sincrona de adjuntos bloquea el event loop del backend.** `attachments/extract.ts:136-152` (`extractExcel` 100% sincrono, `XLSX.read` + `sheet_to_csv` sobre buffer de hasta 20 MB), invocado en `run-agent-by-id.ts:89-116` (loop secuencial). Node es single-thread: un parse grande bloquea 100% del event loop -> se detienen los writes SSE de otros runs en vuelo, los health checks, y toda request de esa instancia. El worker autonomo NO se ve afectado (no incorpora adjuntos). **Es el hallazgo de mayor riesgo al crecer (comportamiento ALTA a escala):** 1 usuario subiendo un Excel de 10-20 MB puede stallear a todos los demas de esa instancia. **Reco:** offloadear a `worker_threads`/piscina o a un microservicio; o extraer el texto al subir, no en la ruta de run.

**M13. Rate limit en memoria por-instancia: limite efectivo = N x max.** `plugins/security.ts:48-57`. `@fastify/rate-limit` con store default (en memoria, sin Redis). Con N instancias en Railway, cada una lleva su contador -> techo real de abuso = N x `RATE_LIMIT_MAX`, y se resetea en cada redeploy. Es EFICIENTE (sin round-trip) pero no distribuido. Como es BYOK, la exposicion es compute/ancho de banda/DB (martillar `/v1/run`, JWKS, session-tokens), no tokens del modelo. **Reco:** respaldar con un store Redis compartido cuando corra >1 instancia; mantener el fallback en memoria para dev.

### BAJA -- optimizacion menor / informativo

| # | Hallazgo | Ubicacion | Nota |
| --- | --- | --- | --- |
| B1 | Configurador re-envia system+catalogo cada turno sin cache | `configurator-service.ts:113-118,285-351` | Costo menor, lo paga el cliente, output capado |
| B2 | Listados por owner ordenan `created_at` en memoria (indice solo `owner_id`) | `agent-repository.ts:121-128` y hermanas | Trivial por-owner; inconsistente con V017 |
| B3 | `agent_runs` sin indice por `owner_id`: erasure GDPR hace seq scan | `retention-repository.ts:84-86`; `V003` | Operacion rara |
| B4 | Pool `max:5` + `prepare:false` (sin reuso de plan) | `db/client.ts:11` | Tradeoff obligado del pooler transaccional |
| B5 | `jobs.listByOwner` pagina por OFFSET (paginas profundas escanean y descartan) | `jobs-repository.ts:166-187` | Migrar a keyset si crece |
| B6 | `triggers_url_token_hash_key` no respalda ninguna lectura (dispatch por PK) | `triggers-repository.ts:229-238` | Informativo; correcto asi |
| B7 | `@supabase/supabase-js` completo pero solo se usa auth+storage | `lib/supabase.ts:1` | ~10-15 kB gzip de realtime/postgrest muertos |
| B8 | Playground hace `setState` por CADA token -> re-render de toda la transcripcion | `PlaygroundPage.tsx:187-196,425-501` | El widget lo hace O(1) |
| B9 | react-query sin `staleTime` (0): refetch en cada navegacion | `main.tsx:12-14` | Chatter evitable; no es martillo |
| B10 | Sin `@fastify/compress`: listados JSON sin gzip (~20 kB/pagina desperdiciados) | `server.ts` | El SSE no se beneficia (hijack) y conviene dejarlo sin comprimir |
| B11 | Polling del worker: ~17.280 queries/dia desperdiciadas con cola vacia | `worker.ts:59`, `env.ts:25` | Trivial hoy; LISTEN/NOTIFY NO viable con el pooler |
| B12 | Un verificador JWKS por modulo de ruta (cache no compartido) | `routes/*.ts`, `jwt-verifier.ts:14-17` | ~10 fetches JWKS en frio en vez de 1 |
| B13 | El build raiz compila `packages/shared` dos veces | `package.json:17` | tsc redundante; segundos de pipeline |

---

## 6. EXPLAIN queries propuestas (para confirmar planes en Supabase)

Reemplazar `<owner>`/`<sub>`/`<agent>` por UUIDs reales. El #1 conviene correrlo dentro de `BEGIN; ... ROLLBACK;` o sobre el `SELECT` interno para no reclamar de verdad. No fueron ejecutadas por el auditor.

```sql
-- #1 CLAIM del worker: buscar un nodo 'Sort' (=> el OR rompe el orden del indice)
--    vs 'Index Scan using jobs_pending_claim_idx'.
EXPLAIN ANALYZE
SELECT id FROM jobs
WHERE status='pending' AND (scheduled_for IS NULL OR scheduled_for <= now())
ORDER BY created_at ASC
LIMIT 1;

-- #2 CRON enqueue (cada minuto): confirmar Index Scan using scheduled_tasks_due_idx, sin Seq Scan.
EXPLAIN ANALYZE
SELECT id FROM scheduled_tasks
WHERE is_active = true AND next_run_at IS NOT NULL AND next_run_at <= now();

-- #3 listByOwner jobs con filtro status (GET /v1/jobs): confirmar jobs_owner_created_idx y como aplica el status.
EXPLAIN ANALYZE
SELECT id, agent_id, status, payload->>'kind' AS payload_kind, attempts, last_error,
       scheduled_for, created_at, started_at, finished_at
FROM jobs
WHERE owner_id = '<owner>' AND status = 'completed'
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;

-- #4 /v1/me subscriptions: se ESPERA Seq Scan + Sort (confirma el indice faltante).
EXPLAIN ANALYZE
SELECT id, profile_id, plan, status, created_at
FROM subscriptions WHERE profile_id = '<sub>' ORDER BY created_at DESC LIMIT 1;

-- #5 /v1/me usage_counters: se ESPERA Seq Scan + Sort (confirma el indice faltante).
EXPLAIN ANALYZE
SELECT id, profile_id, runs_used, runs_limit, period_kind, created_at
FROM usage_counters WHERE profile_id = '<sub>' ORDER BY created_at DESC LIMIT 1;

-- #6 Usage totals del agente (dashboard): confirmar uso de agent_runs_agent_created_idx (prefijo agent_id).
EXPLAIN ANALYZE
SELECT count(*) AS runs,
       count(*) FILTER (WHERE status='completed') AS completed,
       coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0)
FROM agent_runs WHERE agent_id = '<agent>';
```

---

## 7. Lo que SI es eficiente (breve)

**Base de datos / worker:**
- `claimNextJob` (`jobs-repository.ts:196-215`) es UN solo `UPDATE ... WHERE id=(SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)`: patron de cola correcto, atomico, sin doble-toma entre workers.
- El worker NO llama `countPending` ni `getNextPendingJob` en el loop (solo `claimNextJob`): 1 query por tick, sin `count()` malgastado. El guard `inFlight` (`worker.ts:48`) evita solapar pasadas durante runs largos -> cero queries mientras un job corre.
- Camino caliente del worker = lookups por PK (getProfileTier, loadAgent, resolveCredential): ~5 queries por job, sin N+1; en recetas el agente y la credencial se cargan una sola vez.
- Ningun `SELECT *`/`RETURNING *`: columnas explicitas en todos los repos. `jobs.listByOwner` trae `payload->>'kind'` (escalar), nunca el `payload` jsonb completo -> no sube los mensajes del usuario a memoria.
- `enqueue_due_scheduled_tasks` es `UPDATE...RETURNING + INSERT` en un solo statement atomico, con su filtro cubierto exacto por `scheduled_tasks_due_idx`.
- La retencion tiene indices dedicados que calzan con sus DELETE.

**Motor de tokens:**
- Cap de tokens evaluado ENTRE iteraciones con el uso acumulado real, corta limpio (`run-agent.ts:113-119`); `maxIterations` con cota dura de 20.
- Contabilidad de tokens correcta (lo grabado = la factura); runs graban solo metadatos (sin blow-up de storage ni PII).
- BYOK consistente: sin key LLM de plataforma en `env.ts`.

**Frontend / red:**
- Widget: web component vanilla + Shadow DOM, streaming O(1), 4.48 kB gzip (sec. 4).
- `lucide-react` con named imports (tree-shakeable: ~66 iconos, no el set de ~1500).
- react-query bien configurado donde importa: `refetchOnWindowFocus:false`, `refetchInterval` de `/actividad` gateado por `hasInFlightJobs`, `refetchIntervalInBackground` default false. `useMemo` donde corresponde. Mutaciones con `setQueryData`/invalidacion dirigida.
- SSE eficiente: chunk-por-evento con `X-Accel-Buffering:no` y `reply.hijack()` (evita re-serializacion de Fastify); desconexion y timeout abortan el run de inmediato (sin runs zombie). La descarga de adjuntos esta acotada a 20 MB con timeout de 15s.
- Arranque rapido: `parseEnv` (zod) + registro de rutas + pool lazy + JWKS lazy -> readiness sub-segundo para el health check de Railway; shutdown limpio con drenaje acotado.

---

## 8. Las 5 optimizaciones de mayor impacto / menor esfuerzo (quick wins)

Priorizadas por ROI. **Ninguna se implemento** (auditoria read-only); son para el backlog.

1. **Prompt caching en `map-request.ts` (system + tools + breakpoint de historial).** *Impacto:* baja el costo de CADA run con tools ~50% (loops cortos) a ~90% (loops largos/recetas). *Esfuerzo:* un archivo. *Escala:* importa HOY, 100% de los runs. **El quick win de mayor ROI de toda la auditoria.**
2. **Bajar `RUN_MAX_TOKENS` default (1M -> 100-250k) + documentar/aplicar techo de tokens por RECETA.** *Impacto:* acota facturas sorpresa en la key del cliente (de hasta $25-$125/receta a algo predecible). *Esfuerzo:* cambio de config + una guarda por receta. *Escala:* importa HOY (decision de defaults).
3. **Code-splitting por ruta (`React.lazy` landing vs dashboard) + `manualChunks` de vendor.** *Impacto:* difiere ~55-65 kB gzip del critical path de la landing y evita re-descargar ~100 kB de vendor en cada deploy. *Esfuerzo:* config de Vite + envolver rutas en `lazy()`. *Escala:* percepcion HOY (primera impresion), ancho de banda al escalar.
4. **Dos indices FK faltantes + activar el cron de retencion (V016).** `create index on subscriptions (profile_id, created_at desc)` y sobre `usage_counters (...)`; activar V016 en Supabase. *Impacto:* saca 2 seq scans del camino caliente `/v1/me` y acota el crecimiento de `jobs`/`agent_runs`. *Esfuerzo:* SQL. *Escala:* al escalar (miles de usuarios / meses de trafico).
5. **Offloadear la extraccion de adjuntos del event loop** (worker_threads/piscina o extraer al subir). Como quick win minimo alternativo: registrar `@fastify/compress` (threshold ~1 kB) para los listados JSON. *Impacto:* el offload evita que un Excel de 20 MB congele toda la instancia; compress ahorra ~20 kB/pagina en listados. *Esfuerzo:* medio (offload) / trivial (compress). *Escala:* degrada con uso concurrente.

---

## 9. Cobertura y alcance

- **Queries:** se leyeron todos los repositorios que emiten SQL (`jobs-repository`, `agent-repository`, `run-repository`, `provider-credential-repository`, `scheduled-tasks-repository`, `triggers-repository`, `recipes-repository`, `retention-repository`, `registration-repository`, los tres de privacidad) y las rutas de listado, y se cruzaron contra las migraciones V001-V017. No se ejecuto ningun EXPLAIN (se proponen en sec. 6 para que el usuario los confirme en Supabase).
- **Tokens/costo:** se leyo el ensamblado completo del contexto (`assemble-agent-run`, `run-agent`, `runRecipeJob`, `map-request`, `run-model`, `sse-runner`, `configurator-service`, `limits`, `env`). El modelo de costo usa precios de proveedor de referencia (cutoff) y supuestos explicitos de tamano de prompt/historial; los numeros son aproximados y sensibles a la config real del agente.
- **Frontend:** se corrio el build de produccion de la consola y del widget (numeros reales en sec. 4) y se leyeron `App.tsx`, `vite.config.ts`, `package.json`, `main.tsx`, `queries.ts`, `mutations.ts`, `ActivityPage`, `PlaygroundPage`, `AuthProvider`, los gates y los componentes de landing.
- **Backend/worker/red/build:** se leyeron `worker.ts`, `execution.ts`, `server.ts`, `security.ts`, `sse-runner.ts`, `db/client.ts`, `attachments/extract.ts`, `crypto/aes-gcm.ts` y los scripts de build.
- **Limites conocidos:** (a) el servicio externo `WEB_WORKER` no esta en este repo -- su posible costo LLM de plataforma (M4) quedo a verificar aparte; (b) no se midieron latencias reales (sin benchmark contra prod, por diseno); (c) los tamanos de descomposicion del bundle (sec. 4) son estimaciones por dependencia, no un `source-map-explorer` (que seria el siguiente paso para numeros exactos).
- **Metodo de confianza:** cuatro lectores por eje produjeron hallazgos con `path:linea`; un pase adversarial verifico los 16 hallazgos ALTA/MEDIA contra la fuente (16 confirmados, 0 refutados); el auditor re-verifico de forma independiente no-caching, el modelo de costo, los tamanos de bundle y los indices faltantes leyendo la fuente.

---

*Fin del informe de la Auditoria 11. Cierra el Bloque C. Read-only: no se modifico codigo ni SQL; el unico artefacto es este documento.*
