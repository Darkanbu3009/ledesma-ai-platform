# Scheduler de ejecucion autonoma (Fase 5.3, backend)

Este documento describe el BACKEND del scheduling: la tabla de tareas programadas, los endpoints
CRUD, y el mecanismo de disparo por `pg_cron`. **No** incluye UI (eso es 5.3b) ni triggers entrantes
por evento (eso es 5.4). Es **aditivo**: reusa la cola `jobs` (V008) y el worker (5.2) tal cual.

## Vision general

```
usuario (tier autonomous)
   |  POST /v1/scheduled-tasks  (cron, agente, credencial, payload)
   v
scheduled_tasks  (V009)  -- plantilla recurrente: QUE correr y CUANDO (cron, UTC)
   ^  cada minuto
   |  enqueue_due_scheduled_tasks()  (V010, programada por pg_cron en V011)
   v
jobs  (V008, 'pending')  -->  worker (5.2)  -->  ejecuta el agente
```

El scheduler solo **produce** jobs. No toca el motor, el Configurador ni el worker: encola jobs que
el worker ya sabe ejecutar.

## Piezas

| Pieza | Archivo |
| --- | --- |
| Tabla `scheduled_tasks` | `apps/backend/migrations/V009__scheduled_tasks.sql` |
| Funciones de disparo (SQL) | `apps/backend/migrations/V010__scheduler_pgcron.sql` |
| Activacion de pg_cron (operador) | `apps/backend/migrations/V011__scheduler_pgcron_activation.sql` |
| Repositorio | `apps/backend/src/scheduling/scheduled-tasks-repository.ts` |
| Calculo de cron (TS, testeado) | `apps/backend/src/scheduling/cron.ts` |
| Endpoints CRUD | `apps/backend/src/routes/scheduled-tasks.ts` |

Las migraciones se aplican **a mano** en el SQL Editor de Supabase, en orden: **V009 -> V010 -> V011**.

## Endpoints (todos `requireUser`, owner = sub del JWT)

- `POST /v1/scheduled-tasks` — crea una tarea. **Gate por tier**: solo `tier = 'autonomous'` (403 si
  no). Valida que `agentId` y `credentialId` sean del owner (404 si no). Valida el `cronExpression`
  (400 si invalido o sin proximas ejecuciones). Calcula y guarda `next_run_at`.
  Body: `{ agentId, credentialId, cronExpression, payload: { messages, maxIterations? } }`.
- `GET /v1/scheduled-tasks` — lista las tareas del owner (estado, ultimo y proximo run).
- `PATCH /v1/scheduled-tasks/:id` — activa/desactiva (`isActive`) o edita (`cronExpression`/`payload`).
  Recalcula `next_run_at` si cambia el cron o se reactiva. Solo el owner.
- `DELETE /v1/scheduled-tasks/:id` — borra la tarea. Solo el owner.

El **gate por tier** vive solo en la creacion. PATCH/DELETE no re-gatean porque el **worker** vuelve a
gatear por tier al ejecutar cada job (defensa en profundidad): un usuario degradado que reactive una
tarea solo logra encolar jobs que el worker marcara `failed` por tier insuficiente.

## Formato del cron

Estandar de 5 campos: `minuto hora dia-del-mes mes dia-de-semana`, **interpretado en UTC**.

- minuto `0-59`, hora `0-23`, dia-del-mes `1-31`, mes `1-12`, dia-de-semana `0-7` (`0` y `7` = domingo).
- Por campo: `*`, `*/n`, `a`, `a-b`, `a-b/n`, `a/n`, y listas con coma (`1,15,30`).
- **No** se soportan nombres (`JAN`, `MON`) ni extensiones (`L`, `W`, `#`, `?`).
- Regla dia-del-mes vs dia-de-semana (Vixie): si **ambos** estan restringidos (ninguno es `*`), matchea
  con **OR**; si alguno es `*`, se aplica el otro.

Ejemplos: `0 8 * * *` = 08:00 UTC diario; `*/5 * * * *` = cada 5 minutos; `0 9 * * 1` = lunes 09:00 UTC;
`0 0 1 * *` = primero de cada mes 00:00 UTC.

## Decision clave: como se calcula `next_run_at`

`pg_cron` programa **su propia** funcion (cada minuto), pero **no** expone un parser que calcule "el
proximo match de ESTE cron de usuario". Opciones evaluadas:

- **(a) Calcularlo en SQL puro con un parser de saltos de calendario.** Fragil: rollovers de mes/anio,
  bisiestos, semantica DOM/DOW. Descartado por riesgo de bugs sutiles.
- **(b) Que el backend calcule `next_run_at` y se lo pase al disparo via un endpoint que pg_cron/worker
  invoque.** Acopla el scheduler al backend en cada corrida y agrega una pieza movil (ventana donde
  `next_run_at` queda sin recalcular). Mas fragil operativamente.
- **(c, ELEGIDA) Hibrido auto-contenido, sin dependencias nuevas.**
  - El **backend** (TypeScript, `cron.ts` -> `nextCronRun`) calcula `next_run_at` al **crear/editar**.
    Es **testeable en CI** sin Postgres (ver `apps/backend/test/cron.test.ts`).
  - El **disparo** avanza `next_run_at` por si mismo con la funcion SQL **gemela**
    `scheduler_cron_next` (V010), asi **no depende del backend** en cada corrida.
  - Ambas implementaciones interpretan el **mismo** subconjunto de cron, en UTC. El "proximo match" se
    obtiene por **barrido minuto a minuto** (`generate_series` en SQL, bucle de `Date` en TS) con corte
    al primer match: la aritmetica de calendario la resuelve la plataforma (Postgres / `Date`), **no**
    un parser de saltos. Lo unico que escribimos a mano es el **matcheo de un instante** contra el cron,
    que es simple y robusto.

No se agrego ninguna libreria de cron: la gramatica es chica, debe poder espejarse en SQL, y el barrido
hace innecesario un parser de "siguiente match". El horizonte del barrido es 1461 dias (4 anios) para
cubrir crones de 29 de febrero; mas alla de eso el cron se trata como imposible (`null`). El costo es
despreciable: para un cron tipico el primer match aparece en <= 1440 iteraciones, con corte temprano
(sin materializar la serie). El horizonte de TS (`HORIZON_MINUTES`) y el de SQL (`1461 days`) coinciden.

## Idempotencia del disparo (sin duplicados)

`enqueue_due_scheduled_tasks()` usa un unico `UPDATE ... RETURNING` dentro de un CTE que
**selecciona-y-avanza** atomicamente las tareas vencidas, e inserta un job por fila avanzada. Postgres
toma un lock de fila por tarea actualizada; una corrida concurrente que toque la misma fila la ve con
`next_run_at` ya en el futuro (fuera del filtro `next_run_at <= now()`) y no la re-encola. Ante atrasos
(base caida un rato), cada tarea vencida dispara **una** sola vez al volver y avanza al proximo match
futuro (sin catch-up atronador).

## Probar el disparo manualmente

Con la extension activada y `V009/V010/V011` aplicados:

1. Crea una tarea con `next_run_at` ya vencido (via el endpoint, o directo para probar el SQL):

   ```sql
   insert into scheduled_tasks (owner_id, agent_id, credential_id, cron_expression, payload, next_run_at)
   values (
     'TU-SUB', 'UUID-DE-UN-AGENTE', 'UUID-DE-UNA-CREDENCIAL',
     '*/5 * * * *',
     '{"messages":[{"role":"user","content":"hola"}]}'::jsonb,
     now() - interval '1 minute'   -- ya vencido: deberia dispararse
   );
   ```

2. Corre el disparo a mano (sin esperar al minuto de pg_cron) y verifica que encolo:

   ```sql
   select enqueue_due_scheduled_tasks();   -- devuelve la cantidad de jobs encolados (>= 1)
   select id, status, agent_id, payload from jobs order by created_at desc limit 5;  -- aparece un 'pending'
   select last_run_at, next_run_at from scheduled_tasks where owner_id = 'TU-SUB';   -- next_run_at avanzo al futuro
   ```

3. Probar `scheduler_cron_next` aislado:

   ```sql
   select scheduler_cron_next('0 8 * * *', timestamptz '2026-06-30 09:00:00+00');  -- 2026-07-01 08:00:00+00
   select scheduler_cron_next('*/15 * * * *', timestamptz '2026-06-30 09:07:00+00'); -- 2026-06-30 09:15:00+00
   select scheduler_cron_matches('0 9 * * 1', timestamptz '2026-06-29 09:00:00+00'); -- true (lunes)
   ```

Una vez que `cron.schedule` esta activo (V011), la funcion corre sola cada minuto y los pasos 2 se
observan automaticamente sin invocarla a mano.
