# Triggers por evento (webhook entrante) — Fase 5.4 (backend)

Un **trigger** deja que un sistema de terceros dispare la ejecucion de un agente pegandole a una URL
publica. Es el gemelo "por evento" del scheduler (Fase 5.3, "por horario"): no ejecuta nada por si
mismo, solo **encola un job** en la cola `jobs` (V008) que el worker (5.2) ya ejecuta. El trigger copia
`agent_id`, `owner_id`, `credential_id` y el `payload_template` al job, exactamente como el scheduler.

Esta fase es SOLO backend (sin UI; la UI es 5.4b).

## Aplicar la migracion (a mano)

Como el resto del repo, las migraciones se aplican **manualmente** en el SQL Editor de Supabase. Aplicar
`apps/backend/migrations/V012__triggers.sql`. Es idempotente (re-aplicarla es un no-op).

No requiere pasos de operador extra (a diferencia de V011/pg_cron). No hay dependencias nuevas de npm.

## Configuracion

- `VAULT_SECRET` (ya existente): cifra el secreto HMAC en reposo (AES-256-GCM), igual que la boveda.
- `PUBLIC_BASE_URL` (nuevo, **opcional**): origen publico del backend para construir la URL del webhook
  que se le muestra al usuario (p.ej. `https://api.ledesma-ai-labs.com`). Si falta, se deriva del
  request (protocolo + Host). Setearla en prod es lo robusto detras de un proxy/CDN.

## Gestion (CRUD, con JWT + tier `autonomous`)

Todo scoped por el usuario del token (`owner_id` sale del JWT, nunca del body). Crear un trigger exige
tier `autonomous` (gate server-side, 403 si no). Se valida que el agente y la credencial sean del owner.

- `POST /v1/triggers` — body: `{ agentId, credentialId, authMode: 'hmac'|'url_token', payloadTemplate }`.
  Genera el material de auth y **lo devuelve en claro UNA sola vez** (como una API key):
  - `hmac` → `{ trigger, webhookUrl, hmacSecret, signature }`. El `hmacSecret` no se vuelve a mostrar.
  - `url_token` → `{ trigger, webhookUrl, urlToken }`. La `webhookUrl` incluye `?token=<urlToken>`.
- `GET /v1/triggers` — lista metadata + `webhookUrl`. **Nunca** expone el secreto/token (para `url_token`
  la URL del listado NO trae el token: solo se mostro al crear/rotar).
- `PATCH /v1/triggers/:id` — `{ isActive?, rotate? }`. Activa/desactiva y/o **rota** el secreto/token
  (regenera y devuelve el nuevo una sola vez). Solo el owner.
- `DELETE /v1/triggers/:id` — borra. Solo el owner.

## Endpoint entrante (publico, sin JWT)

`POST /webhooks/triggers/:triggerId`

1. Resuelve el trigger por `:id`. Inexistente **o** inactivo → `404` generico (no revela cual).
2. Autentica segun `auth_mode`:
   - **hmac** (recomendado): el cliente firma `"{timestamp}.{rawBody}"` con HMAC-SHA256 y manda:
     - `x-ledesma-timestamp: <unix-segundos>`
     - `x-ledesma-signature: v1=<hexdigest>` (tambien se acepta el hex a secas)
     Firma invalida o timestamp fuera de la ventana anti-replay (300 s) → `401`.
   - **url_token**: el token va en `?token=<...>` (o en el header `x-trigger-token`). Se compara en
     tiempo constante contra el hash guardado. No coincide → `401`.
3. Si autentica: encola un job `pending` con los datos del trigger y el payload (`payload_template` +,
   si el evento trae un cuerpo JSON, un mensaje `user` extra con esos datos como contexto). **No** se
   ejecuta el agente aqui: lo toma el worker. Responde `202 Accepted`.

El worker vuelve a gatear por tier al ejecutar (5.2): si el owner perdio `autonomous`, el job se rechaza
alla. No hace falta re-verificar tier en el entrante.

## Seguridad

- El secreto HMAC se guarda **cifrado** (`VAULT_SECRET`); el `url_token` se guarda **hasheado**
  (SHA-256). Ninguno es recuperable en claro: se muestran una sola vez.
- Todas las comparaciones de secretos/tokens son en **tiempo constante** (`timingSafeEqual`), nunca `==`.
- El entrante no filtra existencia: `404` generico para inexistente/inactivo, `401` para auth invalida.
- **Rate limiting**: el limite global (`@fastify/rate-limit`, `RATE_LIMIT_*`) cubre esta ruta. Un limite
  por-trigger mas fino es una mejora futura.
- **Logs**: el token de la URL se redacta antes de loggear (`sanitizeLoggedUrl`) y el header
  `x-trigger-token` esta en la lista de redaccion. Nada de secretos en logs.
- **HMAC vs url_token**: HMAC es el estandar mas seguro (firma + anti-replay; el secreto no viaja). El
  `url_token` es mas simple pero viaja en la URL (mas expuesto a proxies/historiales): preferir HMAC.

## Raw body

La verificacion HMAC necesita el cuerpo crudo. Fastify parsea JSON y lo pierde, asi que el plugin del
entrante registra un content-type parser `parseAs:'string'` **encapsulado** (no afecta a las demas
rutas): `request.body` llega como string sin parsear solo en esa ruta.
