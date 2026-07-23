# Prueba manual: relay de teclado movil (conocimiento minimo)

Verifica el login asistido en un **telefono real** via el relay de teclado, y que el **desktop no cambia**.
Reemplaza el aviso previo (`prueba-manual-aviso-teclado-movil.md`), que solo comprobaba el mensaje de
"hazlo desde una computadora".

## Requisitos previos

- El servicio relay (`apps/relay`) desplegado y accesible por `wss://` (ver `docs/despliegue-relay.md`).
- En el backend: `RELAY_TOKEN_SECRET` (mismo valor que el relay) y `RELAY_PUBLIC_URL` configurados.
- En el relay: `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `RELAY_TOKEN_SECRET`,
  `RELAY_ALLOWED_ORIGINS` con el origen de la consola.
- Una cuenta con plan **autonomo** (Pro/Business) para poder conectar sitios.
- Un telefono real (Android o iOS) con un navegador moderno (soporte de X25519 en WebCrypto).

## A. En el telefono (camino feliz del relay)

1. Abre la consola en el telefono e inicia sesion. Ve a **Sitios conectados**.
2. Pega `https://en.wikipedia.org/w/index.php?title=Special:UserLogin` (o `en.wikipedia.org`) y toca
   **Conectar**. Espera a que aparezca el modal con la vista en vivo.
3. Confirma que arriba de la vista aparece el **aviso de divulgacion** (que en el telefono lo que escribes
   viaja cifrado por nuestra infraestructura, no se guarda ni se registra, y que desde una computadora la
   conexion es directa) y un **campo** para escribir con tres botones: **Tab**, **Borrar**, **Enter**.
4. Espera a "**Canal seguro listo**". Toca el campo: **el teclado nativo del telefono debe levantarse**.
5. Escribe el **usuario** en el campo. Observa en la vista en vivo que las letras aparecen en el campo de
   usuario del sitio. Usa **Tab** (o toca el campo de contrasena en la vista) para pasar a la contrasena.
6. Escribe la **contrasena**. Confirma que se refleja en la vista en vivo (como puntos). Usa **Enter** o el
   boton de login del sitio.
7. Si el sitio pide un **codigo de verificacion**, completalo igual (escribiendo en el campo; **Borrar**
   corrige). Llega a **sesion iniciada** en la vista en vivo.
8. Toca **"Ya inicie sesion"**. La conexion debe quedar **Activo** en la lista.

**Que confirmar:**
- El teclado del telefono se levanta al tocar el campo (paso 4).
- El texto tecleado aparece en la sesion remota (pasos 5-7).
- El campo **se limpia** tras cada tecla (no acumula texto visible) y **no ofrece autocompletado**.
- Se llega a sesion iniciada y la conexion queda **Activo**.

## B. En una computadora (el desktop NO cambia)

1. Con puntero fino (mouse/trackpad), repite la conexion de `en.wikipedia.org` desde una computadora.
2. Confirma que el modal **NO** muestra el campo del relay ni la divulgacion: solo la vista en vivo, y se
   teclea **directo** dentro del iframe (entrada directa, sin relay).
3. Completa el login y confirma. Debe quedar **Activo** igual que antes de este cambio.

## C. Fallback (navegador sin soporte)

En un navegador viejo sin X25519 en WebCrypto (o con el relay no configurado en el backend), el modal en
tactil debe mostrar el aviso de **"abre esta pagina en una computadora"** en lugar del campo. El desktop
sigue funcionando.

## D. No fuga (revisar durante A)

- Los logs del servicio relay durante el login deben mostrar **solo metadatos** (`relay_abierto`,
  `relay_cerrado`, conteo de eventos, duracion): **nunca** el usuario, la contrasena, el codigo, el
  `connectUrl` ni el token.
- Los logs del **backend** durante `POST /v1/sitios/:id/relay-token` no deben contener el token ni
  pulsaciones (solo la linea de request estandar).
