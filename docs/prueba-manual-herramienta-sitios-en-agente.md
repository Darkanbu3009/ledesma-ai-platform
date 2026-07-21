# Prueba manual: herramienta de sitios conectados activada desde la UI del agente

Verifica de punta a punta que la herramienta "tareas en sitios conectados" se activa desde la
seccion Herramientas de crear/editar agente, que el agente en el Playground identifica el sitio
conectado por si mismo (via `platform_listar_sitios_conectados`) y que la tarea de LECTURA corre
dentro de la sesion pineada SIN re-login. Complementa `prueba-manual-tarea-web.md` (7.1d), que
probo el motor; aca se prueba la EXPOSICION en UI + runtime del agente.

## Requisitos previos

- `en.wikipedia.org` ya conectado via la UI de Sitios conectados: fila en `sitios_conectados` con
  `estado = 'activo'` y `tiene_contexto = true`.
- Worker desplegado igual que en `prueba-manual-tarea-web.md` (Browserbase + `VAULT_SECRET` +
  `DATABASE_URL`).
- Una credencial de `anthropic` guardada en la boveda del owner. El Playground debe usar esa
  credencial guardada (`x-credential-id`): es el unico camino que aporta el contexto de tenancy
  de las tools de sitios.

## Pasos

1. En `/agentes/nuevo`, crear un agente `anthropic` con un system prompt simple ("Eres un
   asistente que ayuda al usuario con sus sitios conectados").
2. En la seccion Herramientas, pulsar "Activar tareas en sitios conectados". Verificar:
   - Aparece la card "Tareas en sitios conectados" con la nota de acciones bloqueadas y la lista
     de sitios activos del owner (debe listar `en.wikipedia.org`).
   - El boton de activar queda deshabilitado (solo una activacion por agente).
   - Cambiando el idioma de la consola, los textos de la card aparecen en ES y EN.
3. Guardar. En la base, `select tools from agents where id = '<agent_id>'` muestra la entrada
   `{"kind":"sitios_conectados","name":"sitios_conectados","description":""}` junto a los
   webhooks (si los hubiera).
4. En el Playground del agente, seleccionar la credencial GUARDADA y pedir:
   "Lee el titulo del articulo destacado en mi wikipedia."
5. Verificar en el stream de tools de la consola, EN ESTE ORDEN:
   - `platform_listar_sitios_conectados` devuelve `{ sitios: [{ connection_id, dominio:
     "en.wikipedia.org" }] }` (solo sitios `activo` del owner).
   - `platform_ejecutar_tarea_en_sitio` con ese `connection_id` devuelve `job_id` y estado
     `encolada`.
   - `platform_revisar_tarea_en_sitio` termina en `{ estado: 'completada', resultado: ... }` y el
     agente responde con el titulo real del articulo destacado ("From today's featured article").
6. Sin re-login: en los logs del worker aparece `tarea web completada dentro de la sesion del
   sitio` para ese job, sin pasos de login; `ultimo_uso_en` de la fila de `sitios_conectados` se
   refresco y `egress_ip` no cambio (proxy pineado intacto).
7. Contraprueba del gating: en un agente SIN la herramienta activada, el mismo pedido en el
   Playground (misma credencial guardada) NO expone las tools `platform_*_sitio*` (el agente no
   puede invocarlas) y el system prompt no incluye el bloque de contenido no confiable.
8. Contraprueba de estado: desconectar el sitio (o marcarlo `caducado`) y repetir el paso 4: el
   listado vuelve vacio con la nota de conectar un sitio desde la consola; ejecutar con un
   connection_id viejo responde el mensaje accionable de reconectar, sin encolar nada.

## Resultado esperado

El usuario habla en lenguaje natural, el agente descubre el sitio conectado solo, la tarea corre
dentro de la sesion existente (sin credenciales, sin re-login) y las acciones irreversibles o
financieras siguen bloqueadas por 7.1d/7.1e: este flujo solo EXPONE la herramienta, no relaja
ninguna guarda.
