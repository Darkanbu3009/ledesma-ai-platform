# Prueba manual: ensenarle una tarea al sistema (grabacion, V036)

Verifica de punta a punta la via COMPLEMENTARIA para sembrar una receta: el usuario hace la tarea el
mismo una vez, marca que datos cambian cada vez, y a partir de ahi el sistema la repite sin llamar al
modelo. La arquitectura principal NO cambia: el agente sigue navegando libremente cualquier sitio
donde el usuario ya inicio sesion, y esta via existe para los sitios donde falla de forma repetida.

## Requisitos previos

- Todo lo de `docs/prueba-manual-tarea-web.md` (sitio conectado y ACTIVO, worker con Browserbase).
- Migracion `V036__grabaciones.sql` aplicada (tabla `grabaciones` + columna `origen` en
  `recetas_web`).
- Nada mas: la grabacion no usa credencial de modelo ni consume tokens.

## Pasos (camino feliz)

1. En `/sitios`, sobre un sitio ACTIVO, tocar "Ensenarle una tarea".
2. Escribir en lenguaje llano que se va a ensenar (p.ej. "enviar el reporte semanal a
   ana@ejemplo.com") y tocar "Empezar".
3. En la base: `select estado, descripcion, vista_en_vivo_url from grabaciones order by creada_en
   desc limit 1` -> `grabando`, con la vista en vivo poblada a los pocos segundos.
   En los logs del worker: `grabacion abierta: el usuario ya puede hacer la tarea` (solo ids,
   dominio y pais; jamas la URL de la vista ni el contenido de la pagina).
4. Hacer la tarea dentro del navegador seguro embebido, como se haria normalmente.
5. Tocar "Ya termine". Verificar:
   - `grabaciones.estado = 'terminada'`, `vista_en_vivo_url` en null y `pasos` con la secuencia
     capturada (el primer paso es la ruta relativa de la pagina de inicio).
   - En Browserbase la sesion quedo RELEASED (el worker la cierra siempre al terminar).
6. La consola muestra "Que datos cambian cada vez" con SOLO los datos que se escribieron. Marcar el
   que corresponda (p.ej. el destinatario como "Para quien es") y tocar "Guardar".
7. Verificar:
   - `select origen, firma_objetivo, pasos from recetas_web order by creada_en desc limit 1` ->
     `origen = 'grabacion'` y, dentro de `pasos`, el dato marcado como
     `{"tipo":"parametro","parametro":"destinatario"}`. El valor tecleado NO aparece.
   - `select pasos from grabaciones where id = '<id>'` -> el dato marcado quedo como
     `<destinatario>`: el valor tampoco sigue persistido aqui.
   - La consola muestra "Listo. La proxima vez la hace sola."
8. Pedirle al agente esa misma tarea con OTRO destinatario. Verificar en `/actividad` que la
   ejecucion trae la etiqueta "Tarea aprendida", y en los logs del worker `tarea web completada con
   lo aprendido, sin llamadas al modelo por paso`.

## Pasos (el invariante: el login jamas se graba)

1. Abrir una grabacion sobre un sitio activo y, dentro de la vista en vivo, navegar a una pantalla
   que muestre un campo de contrasena (p.ej. cerrar sesion en el sitio).
2. Verificar de inmediato:
   - La consola muestra "Se detuvo la grabacion porque aparecio un campo de contrasena. No guardamos
     nada."
   - `select estado, motivo, pasos from grabaciones where id = '<id>'` -> `descartada`,
     `contrasena`, `pasos = []`. Lo que se habia capturado ANTES tampoco quedo.
   - En los logs: `grabacion descartada: no se guarda nada de lo capturado` con `motivo: contrasena`.
3. Repetir intentando abrir una grabacion sobre un sitio en `esperando_login`: la opcion "Ensenarle
   una tarea" no aparece en la fila, y un POST directo a `/v1/grabaciones` responde 400.

## Pasos (la receta grabada no salta las protecciones)

1. Con la receta del camino feliz ya guardada, pedirle al agente la misma tarea pero con un dato que
   NO va a coincidir con lo que la pagina termine mostrando.
2. Verificar que la tarea TERMINA SIN EJECUTAR la accion, con el mensaje de la verificacion (que se
   pidio y que se encontro), igual que una receta aprendida sola.
3. Agregar el dominio a "Sitios donde nunca actuar" (perfil) y repetir: la tarea se detiene por la
   politica, tambien por el camino de la receta grabada.

## Que NO debe pasar nunca

- Que un valor tecleado en un campo de contrasena, tarjeta o codigo llegue a `grabaciones.pasos`
  (la censura existente lo reemplaza por `[CENSURADO]` antes de persistir nada).
- Que una grabacion se abra sobre un sitio que no esta `activo`.
- Que la grabacion consuma tokens: `jobs.resultado` de un job `grabar_tarea` no reporta consumo y no
  hay ninguna fila nueva en `agent_runs`.
