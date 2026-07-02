# Validacion end-to-end automatizada (produccion)

Script que valida de punta a punta las fases 3-5 de la plataforma (boveda de credenciales,
ejecucion directa, worker desplegado, scheduler pg_cron, triggers por evento, recetas,
cumplimiento y gates por tier) contra el API de produccion y su base.

- **Todo lo creado lleva el prefijo `E2E-VALIDACION`** y pertenece a un usuario de prueba propio
  (`validacion-e2e+<timestamp>@ledesma-ai-labs.com`).
- **La limpieza corre siempre** (aunque fallen fases) y toca exclusivamente filas de ese owner.
- **Idempotente / re-ejecutable**: cada corrida crea un usuario nuevo y barre los restos de
  corridas anteriores antes de empezar.
- **Cero dependencias nuevas**: Node >= 20 (fetch/crypto nativos) + la libreria `postgres` que ya
  esta en el workspace (correr `npm ci` en la raiz antes).

## Secretos

Los secretos se leen SOLO de `.env.validation` en la raiz del repo (cubierto por el patron
`.env.*` del `.gitignore`; **jamas commitearlo**). Claves requeridas:

```
API_BASE_URL=https://api-plataforma.ledesma-ai-labs.com
DATABASE_URL=...              # la de produccion, la misma del backend
ADMIN_API_TOKEN=...           # para subir/bajar tier via /v1/admin/profiles/:id/tier
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=... # crea/borra el usuario de prueba y obtiene su JWT
TEST_PROVIDER=anthropic
TEST_PROVIDER_API_KEY=...     # key real: las ejecuciones llaman al modelo de verdad
TEST_MODEL=claude-sonnet-4-6  # nunca haiku (el script lo rechaza)
```

Ningun secreto se imprime: hay un redactor global sobre logs, JSON de resultados y evidencia.

## Uso

```bash
npm ci                                   # una vez, en la raiz
node scripts/validacion-e2e/run.mjs      # corrida completa (9 fases + limpieza)
node scripts/validacion-e2e/run.mjs --solo-barrido   # solo limpiar restos de corridas viejas
node scripts/validacion-e2e/run.mjs --sin-limpieza   # depuracion: deja lo creado (limpiar luego)
```

Salida: consola con `[PASS]/[FAIL]/[SKIP]/[INFO]` por prueba + `salida/resultados-<ts>.{json,md}`
(directorio ignorado por git). Exit code 1 si hubo al menos un FAIL.

## Fases

| Fase | Que valida |
| --- | --- |
| 1 INFRA | `GET /health`, conexion a la base, auditoria de migraciones V001..V016 (tablas, funciones, cron `enqueue-due-scheduled-tasks`; retencion V016 informativo) |
| 2 IDENTIDAD | usuario via Supabase admin + JWT (password grant, fallback generate_link+verify), `POST /v1/register/individual`, tier a `autonomous` via admin |
| 3 BOVEDA | `POST /v1/credentials`, cifrado real en DB (encrypted_key sin la key en claro), mismatch de proveedor -> 400 |
| 4 EJECUCION | `POST /v1/agents` + `/v1/run/:agentId` por SSE con credencial guardada (texto + stop limpio) |
| 5 WORKER | receta de 2 pasos, `POST /v1/recipes/:id/run` -> 202 + jobId, poll de `jobs` hasta `completed` (la prueba de fuego del worker en Railway) |
| 6 SCHEDULER | tarea `* * * * *`, pg_cron encola y el worker completa; desactivacion inmediata |
| 7 TRIGGERS | webhook publico: hmac (firma valida 202+job, invalida 401, replay >300s 401) y url_token (correcto 202+job, incorrecto 401) |
| 8 CUMPLIMIENTO | consentimiento `privacy_notice` vigente sin faltantes, solicitud ARCO `access` |
| 9 GATES | tier `free` -> crear scheduled task da 403; restaura `autonomous` |
| LIMPIEZA | DELETE por API + barrido DB acotado al owner + borrar usuario + verificacion de cero filas |

## Firma HMAC (referencia de cliente)

El webhook entrante espera `x-ledesma-timestamp` (Unix segundos) y `x-ledesma-signature` con
`v1=<hex>` donde `hex = HMAC-SHA256(secreto, "{timestamp}.{rawBody}")`; ventana anti-replay de
300s (apps/backend/src/triggers/trigger-auth.ts).
