# Validacion end-to-end en produccion — Julio 2026

**Fecha de ejecucion:** 2026-07-02 (~02:36-02:37 UTC)
**Objetivo:** probar de punta a punta las fases 3-5 de la plataforma (boveda, ejecucion directa,
worker desplegado en Railway, scheduler pg_cron, triggers por evento, recetas, cumplimiento y gates
por tier) contra el API de produccion `https://api-plataforma.ledesma-ai-labs.com` y su base.
**Metodo:** script automatizado re-ejecutable `scripts/validacion-e2e/` (Node, sin dependencias
nuevas). Datos de prueba etiquetados con el prefijo `E2E-VALIDACION` y un usuario de prueba propio.
**Proveedor/modelo de las corridas reales:** anthropic / `claude-sonnet-4-6` (llamadas al modelo de
verdad; costo en centavos).

## Resultado global

**40 PASS · 0 FAIL · 0 SKIP · 9 INFO.** Todas las fases del plan pasaron. **No se encontraron
defectos de plataforma.** El worker desplegado en Railway toma y completa jobs correctamente (la
"prueba de fuego" del despliegue): tres jobs de fuentes distintas (receta manual, scheduler pg_cron y
webhooks de trigger) se completaron en `attempts=1` con `last_error=null`.

## Nota sobre el entorno de validacion (no es un defecto de la plataforma)

El runner de esta validacion solo tiene salida **HTTPS (443)**; los puertos del pooler de Postgres de
Supabase (5432 y 6543) estan bloqueados por la politica de red del entorno de ejecucion. Por eso las
verificaciones directas en la base se hicieron via **PostgREST** (la API REST que Supabase expone
sobre HTTPS, con la `service_role` key, que bypassa RLS igual que el rol de servicio del backend).
Consecuencia: la auditoria de migraciones cubre la **existencia de las 14 tablas clave** por probe
REST, pero el catalogo de funciones (`pg_proc`) y el schema `cron` no estan expuestos por PostgREST.
Esas piezas (`enqueue_due_scheduled_tasks`, `scheduler_cron_next` y el cron `enqueue-due-scheduled-tasks`)
se verificaron **funcionalmente** en la Fase 6: que el scheduler encolara un job en el minuto exacto y
el worker lo completara prueba toda la cadena SQL + el cron activo de punta a punta.

## Estado del despliegue del worker

**DESPLEGADO Y FUNCIONAL.** Evidencia:

| Fuente del job | jobId (prueba) | Desenlace |
| --- | --- | --- |
| Receta manual (`POST /v1/recipes/:id/run`) | `ee507f05…` | `completed`, attempts=1, last_error=null |
| Scheduler pg_cron (`* * * * *`) | `98ae0760…` | `completed`, attempts=1, last_error=null |
| Trigger HMAC (webhook publico) | job del owner | `completed`, attempts=1, last_error=null |
| Trigger url_token (webhook publico) | job del owner | `completed`, attempts=1, last_error=null |

El cron `enqueue-due-scheduled-tasks` esta **activo**: la tarea creada a las 02:36 encolo su job en
`2026-07-02T02:37:00.015+00:00` (el minuto exacto de `nextRunAt`), y el worker lo completo.

## Tabla FASE × PRUEBA × RESULTADO

| Fase | Prueba | Resultado | Evidencia (redactada) |
| --- | --- | --- | --- |
| 1 INFRA | `GET /health` -> 200 | PASS | `{"status":"ok"}` |
| 1 INFRA | Acceso a la base (PostgREST/HTTPS) | PASS | lectura de `profiles` ok |
| 1 INFRA | Auditoria de migraciones (tablas V001..V014) | PASS | 14 tablas clave presentes y accesibles |
| 1 INFRA | Funciones y cron del scheduler | INFO | no auditables por PostgREST; verificadas funcionalmente en Fase 6 |
| 1 INFRA | Cron de retencion `retention-purge-expired` (V016) | INFO | no auditable por PostgREST; opt-in por diseno |
| 2 IDENTIDAD | Crear usuario de prueba (Supabase admin) | PASS | `validacion-e2e+<ts>@ledesma-ai-labs.com` |
| 2 IDENTIDAD | Obtener JWT sin magic link manual | PASS | metodo = `password_grant` |
| 2 IDENTIDAD | `POST /v1/register/individual` | PASS | 201, tier inicial `free` |
| 2 IDENTIDAD | Subir tier a `autonomous` (admin) | PASS | `profile.tier=autonomous` |
| 2 IDENTIDAD | `GET /v1/me` -> tier autonomous | PASS | plan=free, runsLimit=10 |
| 3 BOVEDA | `POST /v1/credentials` -> 201 | PASS | providerId=anthropic |
| 3 BOVEDA | Cifrado real en DB (`encrypted_key`) | PASS | blob base64url de 182 chars, sin la key en claro |
| 3 BOVEDA | Mismatch de proveedor -> 400 | PASS | 400 VALIDATION_ERROR (credencial anthropic vs agente openai) |
| 4 EJECUCION | `POST /v1/agents` -> 201 | PASS | model=claude-sonnet-4-6 |
| 4 EJECUCION | `/v1/run` SSE con credencial guardada | PASS | texto='OK', stop=`end_turn`, tokens 1293/4 |
| 5 WORKER | `POST /v1/recipes` -> 201 | PASS | 2 pasos |
| 5 WORKER | `POST /v1/recipes/:id/run` -> 202 + jobId | PASS | jobId devuelto |
| 5 WORKER | Job de receta completado por el worker | PASS | `completed`, attempts=1, last_error=null |
| 5 WORKER | Receta con `last_run_at` actualizado | PASS | lastRunAt=2026-07-02T02:36:44Z |
| 6 SCHEDULER | `POST /v1/scheduled-tasks` -> 201 | PASS | nextRunAt en el minuto siguiente |
| 6 SCHEDULER | `PATCH isActive:false` (desactivacion inmediata) | PASS | task.isActive=false |
| 6 SCHEDULER | pg_cron encolo un job de la tarea | PASS | encolado 02:37:00.015Z (minuto exacto) |
| 6 SCHEDULER | Worker completo el job del scheduler | PASS | `completed`, attempts=1, last_error=null |
| 7 TRIGGERS | Crear trigger hmac (secreto una vez) | PASS | webhookUrl con host de produccion |
| 7 TRIGGERS | Webhook hmac firma valida -> 202 | PASS | `{"status":"accepted"}` |
| 7 TRIGGERS | Job del trigger hmac completado | PASS | `completed`, attempts=1, last_error=null |
| 7 TRIGGERS | Webhook hmac firma invalida -> 401 | PASS | 401 |
| 7 TRIGGERS | Webhook hmac replay (>300s) -> 401 | PASS | timestamp 400s atras -> 401 |
| 7 TRIGGERS | Crear trigger url_token (token una vez) | PASS | token devuelto una vez |
| 7 TRIGGERS | Webhook url_token correcto -> 202 | PASS | `{"status":"accepted"}` |
| 7 TRIGGERS | Job del trigger url_token completado | PASS | `completed`, attempts=1, last_error=null |
| 7 TRIGGERS | Webhook url_token incorrecto -> 401 | PASS | 401 |
| 8 CUMPLIMIENTO | `GET /v1/consents/me` (antes) | PASS | vigente privacy_notice=2025-03-21, faltante inicial |
| 8 CUMPLIMIENTO | `POST /v1/consents` (version vigente) -> 201 | PASS | documentVersion=2025-03-21 |
| 8 CUMPLIMIENTO | `GET /v1/consents/me` -> sin faltantes | PASS | `missing=[]` |
| 8 CUMPLIMIENTO | `POST /v1/data-requests` (access) -> 201 | PASS | status=pending |
| 8 CUMPLIMIENTO | `GET /v1/data-requests` lista la solicitud | PASS | total=1 |
| 8 CUMPLIMIENTO | `GET /v1/data-requests/export` (self-service) | INFO | 200, subjectId coincide |
| 9 GATES | Bajar tier a `free` (admin) | PASS | profile.tier=free |
| 9 GATES | Crear scheduled task con tier free -> 403 | PASS | 403 FORBIDDEN (gate server-side) |
| 9 GATES | Restaurar tier `autonomous` | PASS | profile.tier=autonomous |
| LIMPIEZA | DELETE por API (tareas/triggers/receta/agentes/credencial) | INFO | 204 en todos |
| LIMPIEZA | Barrido DB acotado al owner de prueba | INFO | consents/data_requests/usage/subs/profile borrados |
| LIMPIEZA | Borrar usuario de prueba (Supabase admin) | PASS | usuario eliminado |
| LIMPIEZA | Verificacion: cero filas E2E-VALIDACION activas | PASS | todas las tablas en 0 para el owner |

Verificacion **independiente** post-limpieza (consulta aparte via PostgREST): 0 filas del owner de
prueba en `agents/jobs/provider_credentials/scheduled_tasks/triggers/recipes/consents/data_subject_requests/profiles`
y el usuario devuelve **404** en la API admin de Auth. No queda ningun rastro E2E-VALIDACION activo.

## Defectos encontrados

**Ninguno de plataforma.** Las 9 fases pasaron contra produccion. Observaciones menores (ninguna
bloquea nada):

1. **[Informativo — entorno de validacion]** El runner solo permite salida HTTPS, por lo que la
   verificacion directa de Postgres se hizo via PostgREST y la auditoria del catalogo de funciones /
   `cron.job` quedo como verificacion funcional (Fase 6). Para auditar `pg_proc` / `cron.job` por
   lectura directa haria falta correr desde una red con acceso al puerto del pooler (5432/6543).
2. **[Informativo — retencion]** El cron de retencion `retention-purge-expired` (V016) es opt-in y no
   se pudo confirmar por PostgREST. Si aun no esta activado en produccion, la purga de retencion corre
   solo on-demand (`POST /v1/admin/retention/purge`). Recomendacion abajo.

## Cobertura de seguridad verificada (positiva)

- **Cifrado en reposo real**: `encrypted_key` es un blob AES-256-GCM (iv|tag|ciphertext) sin la key en
  claro (Fase 3b).
- **Aislamiento de proveedor**: una credencial guardada no puede ejecutarse contra un agente de otro
  proveedor (400, Fase 3c).
- **Autenticacion de webhooks**: firma HMAC invalida y replay fuera de la ventana de 300s -> 401;
  url_token incorrecto -> 401 (Fase 7).
- **Gate por tier server-side**: sin tier `autonomous`, crear una scheduled task -> 403 (Fase 9).
- **Secreto de trigger una sola vez**: el HMAC secret y el url_token se devuelven solo al crear.

## Recomendaciones

1. **Activar el cron de retencion (V016)** en produccion si se busca purga automatica de `agent_runs`
   y jobs terminales; hoy es opt-in y podria estar corriendo solo on-demand.
2. **Re-ejecutar esta validacion tras cada despliegue del worker/backend**: el script es idempotente y
   acotado al owner de prueba; sirve como smoke test de produccion (`node scripts/validacion-e2e/run.mjs`).
3. **Para auditorias de base mas profundas** (catalogo de funciones, `cron.job`, RLS por rol), correr
   una variante desde una red con acceso directo al pooler de Postgres; PostgREST cubre el resto sobre
   HTTPS.
4. Ninguna accion correctiva de plataforma es necesaria a partir de esta validacion.

## Reproducibilidad

- Script: `scripts/validacion-e2e/` (README con las 9 fases y el formato de `.env.validation`).
- Secretos: solo desde `.env.validation` (en `.gitignore`, nunca commiteado). Redactor global sobre
  logs, evidencia y resultados. Este informe no contiene secretos.
- Salida cruda por corrida: `scripts/validacion-e2e/salida/` (directorio ignorado por git).
