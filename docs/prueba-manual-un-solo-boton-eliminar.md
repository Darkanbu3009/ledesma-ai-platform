# Prueba manual: un solo boton de eliminar en Sitios conectados

Cubre la simplificacion de la pagina Sitios conectados (`/sitios`): cada fila tiene UNA
sola accion, el boton "Eliminar" (bote de basura + etiqueta), que invoca el borrado
FORZADO (`DELETE /v1/sitios/:id?force=true`). El boton "Desconectar" (flujo limpio, que
fallaba con "No pudimos completar la desconexión" cuando la sesion del proveedor ya habia
expirado) fue retirado de la UI. El endpoint sin `force` sigue existiendo en el backend.

Requisitos: un usuario con plan con autonomia (Pro o Business), backend + worker corriendo
con `BROWSERBASE_API_KEY` y `BROWSERBASE_PROJECT_ID` configurados.

## (a) Eliminar con un solo clic de accion, sin mensaje de error

1. Entrar a `/sitios` y conectar `https://en.wikipedia.org` (confirmar el login o cerrar el
   modal; el estado de la fila da igual para esta prueba).
2. Verificar la fila: un UNICO boton de accion, con el icono de bote de basura Y la
   etiqueta "Eliminar" visibles (no un icono suelto). No existe ningun boton "Desconectar".
3. Pulsar "Eliminar". Verificar la confirmacion: "Esto eliminará permanentemente la
   conexión con en.wikipedia.org. Si la sesión sigue activa en el proveedor se intentará
   cerrar, pero la conexión se eliminará de todos modos, pase lo que pase."
4. Confirmar con "Eliminar de todos modos".
5. Verificar:
   - La fila desaparece DE INMEDIATO de la lista.
   - No aparece NINGUN mensaje de error (en particular, nunca "No pudimos completar la
     desconexión": esa copy ya no existe).
   - En la base, la fila de `sitios_conectados` ya no existe y hay una constancia nueva en
     `data_subject_requests` (tipo `cancellation`, estado `completed`) para el owner.

## (b) Eliminar funciona desde cualquier estado

1. Repetir (a) con filas en distintos estados: `activo` (login confirmado),
   `esperando_login` (modal recien abierto), `error` (cerrar el modal sin confirmar y
   esperar ~10 min al barrido) y `caducado` (contexto vencido).
2. En TODOS los casos el boton "Eliminar" esta habilitado, la confirmacion es la misma y la
   fila desaparece sin error, aunque la sesion o el contexto ya no existan en Browserbase.

## (c) Idiomas y tamanos

1. Repetir (a) con la consola en EN: el boton dice "Delete", la confirmacion "Delete this
   connection?" / "Delete anyway".
2. Repetir en una ventana angosta (o movil): la fila apila en columna y el boton "Eliminar"
   sigue visible y pulsable; en desktop queda alineado a la derecha.
