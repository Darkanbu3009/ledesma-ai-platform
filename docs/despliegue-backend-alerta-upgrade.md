# Alerta por correo de nuevas solicitudes de upgrade (backend)

Este documento describe la **variable de entorno** que el servicio **backend** (`apps/backend`)
necesita para avisar al **operador** por correo cuando un usuario registra una solicitud de upgrade.
Es **aditivo** y **best-effort**: si la variable no esta, `POST /v1/upgrade-requests` funciona
**exactamente igual** que hoy y solo se loguea (una sola vez) que la alerta esta desactivada.

> **Que es.** Cuando un usuario crea una solicitud **nueva** por `POST /v1/upgrade-requests` (fila
> real insertada en `upgrade_requests`, **no** un reintento deduplicado del mismo owner+tier), el
> backend envia un correo al operador con el asunto `Nueva solicitud de upgrade: <email u owner_id>`
> y el detalle del lead: email del usuario (del JWT verificado, sin queries nuevas), `owner_id`,
> plan solicitado, feature de origen y fecha. Asi el operador se entera del lead sin consultar la
> tabla ni el panel de admin.

## Reutiliza la infraestructura de Resend que ya existe

El envio usa el **mismo** cliente de Resend del backend que el correo de bienvenida
(`apps/backend/src/email/resend-client.ts`, extraido de `welcome-email.ts`): `POST` a
`https://api.resend.com/emails` via `fetch`, timeout de **5s**, sin SDK nuevo. La key
(`RESEND_API_KEY`) y el remitente (`RESEND_WELCOME_FROM_EMAIL`) son los **ya configurados** para la
bienvenida; **no** se agrega ninguna credencial nueva.

## Variable de entorno (agregar a mano al servicio backend en Railway)

| Variable | Regla | De donde sacar el valor | Para que |
| --- | --- | --- | --- |
| `UPGRADE_ALERTS_EMAIL` | opcional, email | Correo del operador que atiende los leads (ej. el del admin de la plataforma) | Destinatario de la alerta. Sin ella no se envia nada y el endpoint funciona igual |

Se valida en `apps/backend/src/config/env.ts`. Un valor **presente pero mal formado** (no-email) si
hace fallar el arranque (error de config explicito), igual que `RESEND_WELCOME_FROM_EMAIL`.

### Comportamiento si falta algo (best-effort)

- **Falta `UPGRADE_ALERTS_EMAIL`:** no se envia nada; se loguea el aviso **una sola vez** (no en
  cada solicitud) y el endpoint responde igual (201/200).
- **Falta `RESEND_API_KEY` o `RESEND_WELCOME_FROM_EMAIL`:** no se envia; se loguea y se sigue.
- **Resend falla o da timeout (5s):** el registro del lead **no** se ve afectado (ya quedo en la
  tabla antes del envio); se loguea y se sigue. El envio es fire-and-forget: va **despues** del
  insert, no le agrega latencia a la respuesta y jamas condiciona el resultado del endpoint.
- **Reintento deduplicado** (el usuario re-clickea el CTA con una `pending` existente): **no** se
  envia otro correo; solo el insert real (`created: true`) dispara la alerta.

### Resumen minimo para activar la alerta

```
UPGRADE_ALERTS_EMAIL=operador@ledesma-ai-labs.com   # destinatario de la alerta (NO va hardcodeado)
# ya deben estar (las de la bienvenida):
RESEND_API_KEY=re_...
RESEND_WELCOME_FROM_EMAIL=hola@send.ledesma-ai-labs.com
```

> **Recordatorio de despliegue:** mergear este codigo **no** activa la alerta. Hay que setear
> `UPGRADE_ALERTS_EMAIL` en el servicio backend de Railway; hasta entonces el backend loguea
> `alerta de upgrade desactivada: falta UPGRADE_ALERTS_EMAIL` y todo lo demas funciona igual.
