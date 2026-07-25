# Prueba manual: tarea web dentro de la sesion de un sitio conectado (7.1d)

Verifica de punta a punta que un agente ejecuta una tarea de SOLO LECTURA dentro de la cuenta real
del usuario en un sitio ya conectado (7.1c), por el proxy pineado y SIN re-login.

## Requisitos previos

- `app.ledesma-ai-labs.com` ya conectado via la UI de 7.1c: fila en `sitios_conectados` con
  `estado = 'activo'`, `tiene_contexto = true`, `proxy_ref` y `egress_ip` pineados.
- Worker desplegado con: `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `VAULT_SECRET`,
  `DATABASE_URL` y (opcional) `TAREA_WEB_MODEL` (default `anthropic/claude-sonnet-4-6`; Haiku es
  rechazado al arrancar). Migracion `V026__jobs_resultado.sql` aplicada.
- Una credencial de `anthropic` guardada en la boveda del owner (la tarea web corre con ella).
- Un agente del owner con proveedor `anthropic` (el chat de la consola usa `x-credential-id`, que es
  el unico camino que inyecta las tools de sitios).

## Pasos

1. Anotar `id` (connection_id), `egress_ip` y `ultimo_uso_en` de la fila de `sitios_conectados`
   del dominio `app.ledesma-ai-labs.com`.
2. En el chat del agente (consola, con la credencial guardada seleccionada), pedir:
   "En mi sitio conectado app.ledesma-ai-labs.com (connection_id <id>), dime que dice mi panel de
   agentes."
3. Verificar que el agente llama `platform_ejecutar_tarea_en_sitio` y recibe `job_id` con estado
   `encolada` (visible en el stream de tools de la consola).
4. Esperar al worker (poll de la cola). Verificar en logs del worker, EN ESTE ORDEN:
   - `tarea web completada dentro de la sesion del sitio` con `jobId`/`connectionId`/`dominio`
     (solo ids y dominio: JAMAS el objetivo, cookies, URLs internas ni keys).
   - Cero lineas de reintento (`job reencolado para reintento`) para ese job.
5. Verificar que el agente, via `platform_revisar_tarea_en_sitio`, recibe
   `{ estado: 'completada', resultado: { estado: 'ok', resumen: ... } }` y que el resumen describe
   el contenido REAL del panel de agentes del usuario (dato que solo existe dentro de su cuenta:
   prueba de que navego logueado, sin re-login).
6. Proxy pineado: en el dashboard de Browserbase, abrir la sesion del job y confirmar que salio por
   el mismo proxy/IP; la fila de `sitios_conectados` conserva `egress_ip` identica a la anotada.
7. Sesion e higiene: la sesion del job queda RELEASED en Browserbase (cierre en finally);
   `ultimo_uso_en` de la fila se refresco; `expira_en` se extendio (contexto re-guardado).
8. En la base: `select resultado from jobs where id = '<job_id>'` muestra el resumen; `select
   contexto_cifrado from sitios_conectados ...` sigue siendo bytea cifrado (nunca JSON en claro).

## Negativos rapidos

- Marcar la fila `estado = 'caducado'` y repetir el pedido: la tool responde de inmediato "el sitio
  no esta conectado o la sesion caduco..." SIN encolar job (y sin crear sesion de navegador).
- Pedir una tarea financiera ("transfiere/paga X") cuyos datos NO coincidan con lo que hay en
  pantalla (o cuyo monto supere el tope de la politica): el job termina `failed` con
  `last_error` = `DETENIDA_VERIFICACION: {...}` y la accion NO llega al navegador. La verificacion
  determinista corre dentro de la misma corrida, justo antes del clic.
- Pedir una tarea con accion bloqueada ("envia el correo a X") y ver que el agente la EJECUTA cuando
  los datos coinciden: `resultado.estado = 'ok'` y una sola corrida del motor. Si el agente
  terminara sin intentar la accion, el job falla con "nunca llego a la verificacion previa" (nunca
  se reporta como exito).
- Pedir un envio con TODOS los datos declarados
  (`envia a X un correo con asunto "..." y cuerpo "..."`) y seguir los logs: mientras el redactor
  este a medias aparece `la verificacion previa NO se supera todavia` con `parametrosComparados` y
  `parametrosDeclarados` (los dos numeros, siempre), la accion NO llega al navegador y la tarea
  SIGUE. Cuando los tres datos estan escritos, aparece `verificacion determinista superada` con
  `parametrosComparados = parametrosDeclarados` y despues
  `la accion irreversible surtio efecto en la pagina (confirmada)`.
- Si el sitio no cierra el redactor ni muestra confirmacion tras el clic, el job termina con
  "la accion se intento pero no se pudo confirmar" y NUNCA se reintenta sola: hay que revisar el
  sitio antes de volver a pedirla.
- Un job DETENIDO por la verificacion cierra ordenado: ademas del `last_error`
  `DETENIDA_VERIFICACION: {...}`, `select resultado from jobs where id = '<job_id>'` trae
  `{"estado":"detenida", ...}` y la trayectoria (V030) conserva TODOS los pasos de la corrida mas el
  paso de verificacion. En los logs NO debe aparecer
  `el job dejo de estar running a mitad de la corrida` para ese job.

## Resultado esperado (resumen)

La tarea de solo lectura se ejecuta dentro de la cuenta, por el proxy pineado, sin pantalla de
login, con una sola ejecucion del motor, resultado devuelto al agente y sesion cerrada.
