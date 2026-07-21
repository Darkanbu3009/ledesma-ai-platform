# Prueba manual: checkpoints de aprobacion humana en tareas web (7.1e)

Verifica de punta a punta que una accion irreversible/financiera PAUSA la tarea con la sesion viva,
que el usuario ve exactamente que va a pasar (screenshot + descripcion) y que la accion SOLO se
ejecuta tras aprobar, en la MISMA sesion y por el mismo proxy pineado.

## Requisitos previos

- Todo lo de `docs/prueba-manual-tarea-web.md` (sitio `app.ledesma-ai-labs.com` conectado y activo,
  worker con Browserbase + credencial anthropic del owner).
- Migracion `V027__aprobaciones_web.sql` aplicada (estado `pausado` en jobs, tablas
  `aprobaciones_web` + `intervenciones_art22`, bucket `aprobaciones-web`).
- Worker con (opcionales pero recomendadas para esta prueba): `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` (screenshot), `RESEND_API_KEY` + `RESEND_FROM_EMAIL` +
  `CONSOLE_BASE_URL` (correo de aviso), `APROBACION_TTL_MINUTOS` (default 15).

## Pasos (aprobar)

1. En el chat del agente pedir una accion que dispare el checkpoint SIN cobrar nada real, p.ej.:
   "En mi sitio conectado app.ledesma-ai-labs.com (connection_id <id>), llena el formulario de
   contacto con el asunto 'prueba 7.1e' y ENVIALO."
2. Verificar en logs del worker: `tarea web PAUSADA en checkpoint de aprobacion humana (sesion viva)`
   con `aprobacionId` y `accionTipo` (solo ids/dominio; jamas objetivo ni contenido).
3. En la base: `select estado, descripcion, screenshot_path, expira_en from aprobaciones_web order by
   creada_en desc limit 1` -> `pendiente`, descripcion en UNA linea, `expira_en` ~15 min.
   `select status from jobs where id = '<job_id>'` -> `pausado`.
4. En Browserbase: la sesion del job sigue RUNNING (NO se cerro al pausar).
5. Llego el correo "Tu agente necesita tu aprobacion" con la descripcion y el enlace al console.
6. En la consola (movil y desktop, ES y EN): aparece el banner global "necesita tu aprobacion";
   entrar a /actividad muestra el job "Esperando aprobacion" y el MODAL con el screenshot grande,
   la descripcion en una linea y los tres botones. Tab cicla dentro del modal (foco atrapado).
7. Tocar "Aprobar" (un tap). Verificar:
   - `aprobaciones_web.estado = 'aprobada'`, `decidida_por`/`decidida_en` poblados.
   - `select * from intervenciones_art22 order by creada_en desc limit 1` -> decision 'aprobada',
     `decidida_por` = el usuario, `descripcion` y `screenshot_path` (quien, cuando, que vio).
   - El worker re-reclama el job y en logs: `tarea web reanudada y completada tras la decision del
     checkpoint` con la MISMA sesion (en Browserbase no aparece una sesion nueva para el job).
   - La accion SE EJECUTO en el sitio (el formulario quedo enviado) SOLO despues de aprobar.
   - El job queda `completed` con `resultado.estado = 'ok'` y la sesion queda RELEASED.

## Variantes

- **Rechazar (un tap)**: el job completa con `resultado.estado = 'rechazada'` ("rechazada por el
  usuario"), la accion NO se ejecuta y la sesion se cierra. Intervencion 'rechazada' registrada.
- **Rechazar con instruccion**: escribir p.ej. "mejor pon el asunto 'prueba B' y no lo envies aun";
  la tarea continua en la MISMA sesion siguiendo la instruccion y SIN ejecutar la accion original
  (si vuelve a topar con un envio, crea OTRO checkpoint).
- **Expirar**: no decidir; al vencer `expira_en` el barrido marca `expirada`, cierra la sesion,
  el job queda `failed` con mensaje claro, llega el correo "Una aprobacion expiro" y queda la
  intervencion 'expirada' con `decidida_por` null.
- **Pin de salida**: en el dashboard de Browserbase confirmar que la reanudacion salio por el mismo
  proxy/IP pineado (el worker re-verifica `egress_ip` en una pestana nueva; una IP distinta aborta
  sin ejecutar).

## Resultado esperado (resumen)

Ninguna accion financiera/irreversible se ejecuta sin una aprobacion 'aprobada'; la pausa conserva
la sesion (el estado del checkout no se pierde); cada decision queda en `intervenciones_art22`
(GDPR Art.22: quien, cuando, que vio); y expirar/rechazar jamas ejecuta la accion.
