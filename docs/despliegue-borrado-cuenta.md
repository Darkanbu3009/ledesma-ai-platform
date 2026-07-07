# Motor de borrado de cuenta (datos + auth.users)

Este documento describe el **motor de borrado de cuenta** del backend (`apps/backend`) y la variable de
entorno que necesita para borrar la identidad del usuario (`auth.users`) via el admin API de Supabase.

> **Alcance.** El **motor** (borrado atomico de datos + borrado de `auth.users`) y sus DOS vias de
> invocacion: el **erasure ARCO admin** (`POST /v1/admin/data-requests/:id/resolve`) y el **endpoint
> self-service** (`DELETE /v1/me`, ver [seccion abajo](#endpoint-self-service-delete-v1me)). La **UI**
> **no** esta aqui (pieza siguiente). Es irreversible: la pieza mas delicada del proyecto, deliberadamente
> aislada para auditarse con lupa.

## Que hace el motor

- `deleteAccountData(ownerId)` (`src/account/account-deletion-repository.ts`): borra/anonimiza **TODOS**
  los datos de negocio del owner (las 16 tablas) en **UNA transaccion** (`sql.begin`) — todo o nada. Es el
  **superconjunto atomico** del viejo `eraseOwnerOperationalData` (6 DELETE sueltos, no atomico — hallazgo
  **H-01** de la auditoria 8). Respeta las FKs, **anonimiza** `admin_actions` (conserva la fila, nulifica
  `actor_id`) y **protege las organizaciones compartidas** (solo borra la org si el owner era el unico
  miembro; si hay otros, no la toca).
- `deleteAuthUser` (`src/account/supabase-admin.ts`): borra la fila de `auth.users` via
  `supabase.auth.admin.deleteUser`. `auth.users` vive en el sistema de auth de Supabase (sin FK ni trigger
  a `profiles`; el vinculo es solo convencion), por eso es un **paso separado**.
- `deleteAccount(...)` (`src/account/account-deletion-service.ts`): **orquesta** los dos sistemas.

## Semantica cross-sistema (honesta: NO hay atomicidad entre los dos sistemas)

Son dos sistemas distintos (Postgres + auth de Supabase) que **no comparten transaccion**. El orden y las
garantias son:

1. **Datos primero** (`deleteAccountData`, atomico). Si **falla** → rollback: la cuenta queda **intacta**,
   `auth.users` **nunca** se toca, se propaga el error y se puede reintentar.
2. **Solo si los datos se borraron con exito**, y solo si se pidio, se intenta `deleteAuthUser`:
   - **exito** → `authUser: 'deleted'`.
   - **`SERVICE_ROLE_KEY` ausente** → `authUser: 'not_configured'` (los datos ya se borraron; se loguea).
   - **fallo del API** → `authUser: 'failed'`: los **datos personales ya se borraron** (cumplimiento
     satisfecho); queda un `auth.users` huerfano. **No se revierten los datos** (seria peor dejar los
     datos que la identidad). Se **loguea** claramente para **reintento manual** y se refleja en el estado
     devuelto.

En el erasure ARCO (admin), borrar `auth.users` es **opcional** (`delete_auth_user`, default **false**):
por default el erasure **conserva la identidad** y solo borra los datos. El borrado total del usuario es
del endpoint self-service (pieza siguiente).

## Variable de entorno

| Variable | Regla | De donde sacar el valor | Para que |
| --- | --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | **opcional**, no vacio | Supabase → Project Settings → API → `service_role` | Habilita `auth.admin.deleteUser`. Sin ella el borrado de datos funciona igual, pero el de `auth.users` queda desactivado (`not_configured`) |
| `SUPABASE_URL` | **requerida** (URL) | Supabase → Project Settings → API → `Project URL` | Base del proyecto; el cliente admin la usa junto con la `service_role` para el admin API. Ya existia antes de esta pieza |

### Nombre canonico de la variable (no depender de duplicados)

El codigo lee **exactamente** `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_URL` (declaradas en
`src/config/env.ts`). Ese es el **nombre canonico** ya presente en el entorno del backend. Si en Railway
existe ademas una variable duplicada `SERVICE_ROLE_KEY` (sin el prefijo `SUPABASE_`), el codigo **no la
usa**: puede eliminarse para evitar confusion. No hay que crear variables nuevas; basta con que
`SUPABASE_SERVICE_ROLE_KEY` (canonica) tenga el valor de la `service_role`.

### Inicializacion perezosa (el arranque nunca depende de esta llave)

El cliente admin de Supabase se crea de forma **perezosa (lazy)**: se construye la **primera vez que se
borra un usuario** de `auth.users` (dentro de `deleteUser`), **memoizado** para reusarse despues, y
**nunca** al cargar el modulo ni al registrar la ruta. `createClient` lanza de forma **sincrona** si la
URL o la key faltan; hacerlo en el arranque (eager) tumbaria el registro del plugin y **todo el arranque**
del servidor (el health check nunca pasa). Con la inicializacion perezosa, un problema de config del
cliente admin **no afecta el arranque**: el servidor **siempre** arranca y el fallo (con mensaje claro,
sin la llave) solo aparece en **tiempo de uso**, al intentar borrar la identidad.

### Es una llave MUY poderosa: tratarla como secreto maximo

La `service_role` key **bypasa RLS** y da **acceso total** al proyecto. Reglas no negociables:

- **Solo** en el entorno del **backend** (Railway). **Jamas** en el cliente/consola ni en el navegador.
- **Nunca** se loguea, **nunca** se devuelve por HTTP, **nunca** aparece en mensajes de error. El codigo
  solo la pasa a `createClient`; los errores propagados usan el mensaje de Supabase, no la llave.
- **Nunca** en el control de versiones (`.env.example` lleva un placeholder, no el valor real).
- Rotable de forma independiente desde el panel de Supabase si se sospecha exposicion.

### Comportamiento si falta (opcional, mismo patron que `WEB_WORKER_*`)

- El borrado de **datos** (Postgres) funciona **exactamente igual** (atomico, 16 tablas).
- El borrado de `auth.users` queda **desactivado**: el motor devuelve `authUser: 'not_configured'` y lo
  loguea. En **produccion** debe setearse para poder eliminar la identidad por completo.

## Endpoint self-service (`DELETE /v1/me`)

La via del **USUARIO** para borrar **su propia** cuenta (`src/routes/account.ts`), aislada del flujo admin
pero reusando el **mismo motor**. A diferencia del erasure ARCO (que por default **conserva** la
identidad), el self-service es **total**: invoca `deleteAccount(user.id, { deleteAuthUser: true })` —
borra los datos (atomico) **y** la identidad (`auth.users`).

- **Auth (`requireUser`).** Sin sesion valida → **401**. El owner que se borra es **siempre** el `sub` del
  token, **jamas** un id del body (es "mi" cuenta; no hay id de otro usuario).
- **Confirmacion fuerte (barrera de intencion).** El body es `{ confirmEmail: string }`. El backend
  compara `confirmEmail` **normalizado** (trim + lowercase) contra el **email del token** (fuente de
  verdad, del JWT), tambien normalizado. Si **no** coincide (o el token no trae email) → **400** y el
  motor **no** se invoca: **nada** se borra. Es la barrera contra clics accidentales.
- **Respuesta honesta** (mapea la semantica cross-sistema del motor, ver arriba): `200` con
  `{ accountDeleted: true, authUser, data }`. `authUser` es `'deleted'` (cuenta borrada por completo),
  `'not_configured'` o `'failed'` (datos borrados; identidad huerfana **ya logueada** para reintento
  manual — no se finge exito total ni se revierten los datos). Si el borrado de datos **lanza** (rollback),
  se propaga → `500` y la cuenta queda **intacta** (reintentable).
- **Sesion.** El JWT es **stateless**: el backend **no** invalida la sesion. Tras el borrado exitoso, el
  cliente debe cerrar sesion (`signOut`) — responsabilidad de la **UI** (pieza siguiente).
- **Doble llamada.** Idempotente por construccion: la primera llamada borra `auth.users`, asi que la
  segunda llega **sin** sesion valida → **401** natural, sin logica extra.
- **`SUPABASE_SERVICE_ROLE_KEY`.** Aplica igual que en el motor: sin ella, el self-service borra los datos
  pero devuelve `authUser: 'not_configured'` (identidad conservada). En **produccion** debe setearse para
  el borrado total.

## Borrado concurrente y el worker en vuelo

El motor no reescribe el worker. Un job del owner que este **en vuelo** durante el borrado esta cubierto
por los mecanismos ya existentes del worker (`apps/worker`): el **claim atomico** (compare-and-set del
estado del job) y el **reaper de huerfanos** (`reapOrphanedJobs`). Si el motor borra los `jobs` del owner
mientras un worker procesa uno, el cierre del worker afectara 0 filas (el job ya no existe) sin corromper
estado; y cualquier `running` que quede colgado lo recupera el reaper. El borrado de datos es idempotente
(acotado por `owner_id`), asi que un reintento converge.
