# Prueba manual: captura del pais del usuario (cierre del circuito del pinning por pais)

Verifica de punta a punta que un usuario SIN pais declarado puede conectar un sitio: la consola le
pide su pais UNA sola vez (selector con la lista completa ISO 3166-1 y la explicacion de por que se
pide), lo guarda en su perfil (`profiles.pais`, V029), la conexion procede con ese pais y
`sitios_conectados.proxy_country` queda pineado. Antes de este cambio, el backend rechazaba
`POST /v1/sitios/conectar` con 400 cuando el pais no era derivable, y no existia donde guardarlo.

Guion para ejecutar sobre un entorno desplegado con las migraciones V028 y V029 aplicadas.
Registrar los resultados reales al ejecutarlo.

## Requisitos previos

- Migracion `V029__profile_pais.sql` aplicada en el SQL Editor de Supabase (despues de V005/V007/
  V021; V028 ya aplicada para `proxy_country`).
- Backend, consola y worker desplegados con este cambio (Browserbase + `VAULT_SECRET` +
  `DATABASE_URL`, igual que `prueba-manual-pinning-por-pais.md`).
- Un usuario con plan con autonomia y SIN pais declarado. Para simular un perfil legado:

  ```sql
  update profiles set pais = null where id = '<sub-del-usuario>';
  ```

## Pasos

1. **Conectar sin pais declarado.** En Sitios conectados, pegar `https://en.wikipedia.org` y pulsar
   "Conectar sitio".

   - NO se encola nada todavia: se abre el dialogo "¿Desde qué país trabajas?" con la explicacion
     ("Tus agentes navegarán desde tu país para que tus sesiones se mantengan estables"), el
     selector con la lista completa de paises (nombres en el idioma activo) y la sugerencia del
     navegador preseleccionada si es derivable.
   - Verificar en ES y EN (selector de idioma del perfil) y en movil y desktop (el dialogo es
     `max-w-sm` y el selector ocupa el ancho completo).

2. **Elegir pais y guardar.** Seleccionar el pais real (p.ej. `Argentina`) y pulsar
   "Guardar y conectar".

   - El pais queda en el perfil y la conexion CONTINUA sola (spinner "Abriendo el navegador
     seguro"), sin volver a pedir nada. Verificar en la base:

   ```sql
   select pais from profiles where id = '<sub-del-usuario>';
   ```

   - `pais = 'AR'` (ISO-2 en mayusculas).

3. **Confirmar la conexion y verificar el pinning.** Abrir la vista en vivo, confirmar (Wikipedia no
   exige login) y verificar:

   ```sql
   select dominio, estado, proxy_country
   from sitios_conectados where dominio = 'en.wikipedia.org';
   ```

   - `estado = 'activo'` y `proxy_country = 'AR'` (el pais declarado, pineado por owner+dominio).

4. **No se vuelve a pedir.** Desconectar el sitio y conectarlo de nuevo (o conectar otro sitio).

   - La conexion va DIRECTO (sin dialogo de pais): el pais ya vive en el perfil.

5. **Editable desde el perfil.** En Configuracion > Cuenta, seccion "País", cambiar el pais (p.ej. a
   `España`) y verificar el aviso "País actualizado." y en la base `pais = 'ES'`. Las conexiones
   NUEVAS pinean el pais nuevo; las existentes conservan su `proxy_country` (el pinning por
   owner+dominio no se toca).

6. **(Negativo) Cliente sin pais por ningun camino.** Con `pais = null` en el perfil, llamar al
   endpoint directo sin body ni Accept-Language con region derivable:

   ```bash
   curl -s -X POST "$API/v1/sitios/conectar" -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -H 'Accept-Language: *' \
     -d '{"url":"https://en.wikipedia.org"}'
   ```

   - 400 con `code = 'PAIS_REQUERIDO'` y mensaje accionable bilingue ("Indica tu pais en la
     configuracion de tu perfil ... / Set your country in your profile settings ..."). JAMAS se
     pinea un default silencioso.

## Resultado esperado

| Paso | Esperado |
| ---- | -------- |
| 1    | Dialogo de pais (una sola vez), nada encolado aun |
| 2    | `profiles.pais` guardado y conexion continua sola |
| 3    | `proxy_country` pineado con el pais declarado |
| 4    | Conexiones siguientes sin volver a pedir el pais |
| 5    | Pais editable en el perfil; conexiones nuevas usan el nuevo |
| 6    | 400 `PAIS_REQUERIDO` accionable, sin default silencioso |
