# Correo de bienvenida del backend (onboarding, Fase 2)

Este documento describe las **variables de entorno** que el servicio **backend** (`apps/backend`)
necesita para enviar el **correo de bienvenida** cuando un usuario nuevo completa su registro. Es
**aditivo** y **best-effort**: si estas variables no estan, el registro funciona **exactamente igual**
y solo se loguea que no se envio la bienvenida. No cambia el flujo de registro ni ninguna otra ruta.

> **Que es.** Cuando un usuario completa su alta (perfil + suscripcion free) por
> `POST /v1/register/individual` o `POST /v1/register/organization`, el backend envia **un** correo
> calido que lo invita a volver a la consola y poner su primer agente a funcionar, con un enlace al
> panel (donde vive el checklist de primeros pasos). Se envia **una sola vez**, solo en el alta real
> (`created`), nunca en un re-registro idempotente ni en el login (`GET /v1/me`).

## Reutiliza la infraestructura de Resend que ya existe

El correo se envia con el **mismo patron** que las alertas de fallo del worker (`apps/worker/src/
alertas.ts`): un `POST` a la API HTTP de Resend (`https://api.resend.com/emails`) via `fetch`, con
timeout corto de **5s** y sin SDK nuevo. Como el backend **no puede importar** codigo del worker (la
dependencia va worker -> backend, no al reves), el patron se **replica** en un helper propio del
backend (`apps/backend/src/email/welcome-email.ts`), sin tocar el worker ni sus alertas.

## Variables de entorno (agregar a mano al servicio backend en Railway)

Las tres son **OPCIONALES**. Se validan en `apps/backend/src/config/env.ts`. Un valor **presente pero
mal formado** (email/url invalido) si hace fallar el arranque (es un error de config, no "falta la
feature"), igual que `WEB_WORKER_URL`.

| Variable | Regla | De donde sacar el valor | Para que |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | opcional, no vacio | La **misma** cuenta de Resend que usan las alertas del worker | Autentica el `POST` a Resend. Sin ella no se envia la bienvenida (se loguea y se sigue) |
| `RESEND_WELCOME_FROM_EMAIL` | opcional, email | Un remitente **verificado** en el dominio `send.ledesma-ai-labs.com`, **distinto** del de alertas (ej. `hola@send.ledesma-ai-labs.com` o `bienvenida@send.ledesma-ai-labs.com`) | Remitente del correo de bienvenida. Si falta, no se envia |
| `CONSOLE_BASE_URL` | opcional, URL | Base publica de la consola (ej. `https://app.ledesma-ai-labs.com`) | Arma el enlace al panel (`/dashboard`) del correo. Si falta, el correo sale igual pero sin enlace |

### Comportamiento si faltan (best-effort)

- **Falta `RESEND_API_KEY` o `RESEND_WELCOME_FROM_EMAIL`:** no se envia nada; el registro responde
  igual (201/200) y se loguea `correo de bienvenida omitido: falta configuracion de email`.
- **Falta `CONSOLE_BASE_URL`:** el correo se envia **sin** el enlace al panel (el resto del contenido
  queda intacto).
- **Resend falla o da timeout (5s):** el registro **no** se ve afectado; se loguea y se sigue. El
  envio es fire-and-forget: **no** le agrega latencia a la respuesta del registro.

### Resumen minimo para activar la bienvenida

```
RESEND_API_KEY=re_...                                  # misma cuenta que las alertas del worker
RESEND_WELCOME_FROM_EMAIL=hola@send.ledesma-ai-labs.com  # remitente verificado (distinto del de alertas)
CONSOLE_BASE_URL=https://app.ledesma-ai-labs.com         # para el enlace al panel del correo
```

Sin estas variables el backend arranca y el registro funciona igual; simplemente no se envia el correo
de bienvenida.

## Nota sobre el email del usuario

El email del destinatario sale del **JWT verificado** del propio registro (`AuthenticatedUser.email`,
`apps/backend/src/auth/jwt-verifier.ts`): esta disponible en el contexto de la peticion, sin un query
extra a `auth.users`. Si por algun motivo el token no trajera email, la bienvenida se omite (se loguea)
y el registro sigue igual.
