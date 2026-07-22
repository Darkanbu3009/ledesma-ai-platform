# Prueba manual: vista en vivo grande y eliminar conexion garantizado

Cubre las dos mejoras de la pagina Sitios conectados (`/sitios`):

1. El modal del login asistido y su vista en vivo se ven GRANDES y legibles.
2. El icono de Eliminar (bote de basura) borra cualquier conexion, aunque Browserbase
   este caido o la sesion haya expirado, sin tocar Supabase a mano.

Requisitos: un usuario con plan con autonomia (Pro o Business), backend + worker corriendo
con `BROWSERBASE_API_KEY` y `BROWSERBASE_PROJECT_ID` configurados.

## Contexto tecnico (por que esta vez si)

El intento previo (PR #208) solo agrando el modal y el iframe con CSS y no surtio efecto:
la vista en vivo de Browserbase renderiza el navegador remoto al tamano del viewport de la
SESION, no al del iframe que la embebe. La doc de Browserbase ("Session Live View",
https://docs.browserbase.com/features/session-live-view) no ofrece ningun parametro de
escala en la URL de la vista; su propia receta para cambiar el tamano de la vista (el
ejemplo de "mobile live view") es fijar `browserSettings.viewport { width, height }` al
CREAR la sesion. Ahora el worker crea la sesion de login con viewport explicito 1280x720
(`LOGIN_VIEWPORT` en `apps/worker/src/browserbase.ts`) y el modal ocupa hasta 90vw/1400px
con el iframe llenando todo el alto restante.

IMPORTANTE: el viewport se fija AL CREAR la sesion. Una fila que quedo en
`esperando_login` desde antes del despliegue conserva su sesion vieja; para ver el cambio
hay que iniciar una conexion NUEVA despues de desplegar worker y consola.

## (a) Vista en vivo grande y legible

1. Entrar a `/sitios` en desktop y conectar `https://en.wikipedia.org/w/index.php?title=Special:UserLogin`
   (o pegar `en.wikipedia.org` y navegar al login desde la vista).
2. Esperar a que abra el modal del login asistido.
3. Verificar:
   - El modal ocupa la mayor parte de la pantalla (hasta 90vw, tope 1400px) y casi todo el alto.
   - La pagina de login de Wikipedia se ve GRANDE y el texto es legible sin esfuerzo
     (la vista rinde a 1280x720 y escala ~1:1 dentro del iframe).
   - El aviso "Tu contraseña no pasa por Ledesma" (cabecera) y el boton "Ya inicié sesión"
     (pie) estan SIEMPRE visibles; el iframe no los tapa ni los empuja fuera.
4. Repetir en una ventana angosta (o movil): el modal ocupa el ancho disponible y el aviso
   y el boton siguen visibles.
5. Repetir con el idioma de la consola en EN: textos correctos en ambos idiomas.

## (b) Eliminar una conexion atascada sin tocar Supabase

1. Conectar un sitio y CERRAR el modal sin confirmar. Esperar ~10 minutos a que el barrido
   deje la fila en estado `error` (o usar cualquier conexion ya atascada en `error` o
   `caducado` cuya sesion/contexto remoto ya expiro).
2. En la fila, pulsar el icono de bote de basura (Eliminar).
3. Verificar la confirmacion: "Esto eliminará permanentemente la conexión con <dominio>.
   Si la sesión sigue activa en el proveedor se intentará cerrar, pero la conexión se
   eliminará de todos modos, pase lo que pase."
4. Confirmar con "Eliminar de todos modos".
5. Verificar:
   - La fila desaparece DE INMEDIATO de la lista, sin pasar por Supabase.
   - No aparece el aviso "No pudimos completar la desconexión" aunque la sesion de
     Browserbase haya expirado o el proveedor no responda.
   - En la base, la fila de `sitios_conectados` ya no existe y hay una constancia nueva en
     `data_subject_requests` (tipo `cancellation`, estado `completed`) para el owner.
6. Contraste con el flujo limpio: "Desconectar" sigue existiendo y se comporta como antes
   (si el proveedor falla de verdad, ese flujo si reporta el error).
7. Repetir el Eliminar sobre una conexion en estado `activo`: tambien funciona (el borrado
   forzado vale desde cualquier estado).
8. Verificar ES y EN, movil y desktop.
