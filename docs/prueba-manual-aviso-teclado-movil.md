# Prueba manual: aviso de teclado movil en la vista en vivo del login

## Contexto

La vista en vivo de Browserbase NO soporta el teclado movil (doc de Session Live View: "Mobile
keyboards aren't officially supported. Desktop works natively"). El tap dentro del iframe si llega
como click a la sesion remota, pero como no existe ningun campo editable local que enfocar, el
telefono jamas despliega su teclado. No es un problema de nuestro iframe: abrir la vista en pestana
propia tampoco lo resuelve, y el unico workaround documentado por el proveedor (teclado virtual
propio que reenvia teclas a la sesion) capturaria lo que el usuario teclea, lo cual esta prohibido
por diseno en este flujo. Mientras el proveedor no lo soporte, el modal muestra un aviso en
dispositivos tactiles pidiendo completar la conexion desde una computadora.

## En un telefono real (Android, Chrome)

1. Entrar a la consola, ir a Sitios conectados y conectar `https://en.wikipedia.org/w/index.php?title=Special:UserLogin`.
2. Al abrirse el modal de la vista en vivo, VERIFICAR que arriba del iframe aparece el aviso:
   "En telefonos y tablets todavia no se puede escribir dentro de esta vista... Abre esta pagina en
   una computadora para conectar el sitio."
3. La vista en vivo sigue visible y responde al tap (el click llega al sitio remoto); lo que no
   aparece es el teclado del telefono, que es exactamente lo que el aviso explica.

## En desktop (regresion)

1. Repetir la conexion de `en.wikipedia.org` desde una computadora.
2. VERIFICAR que el aviso NO aparece.
3. Click en el campo de usuario dentro de la vista en vivo, escribir usuario y contrasena,
   completar el codigo de verificacion si el sitio lo pide y llegar a sesion iniciada.
4. Confirmar con "Ya inicie sesion" y verificar que la conexion queda Activa.
