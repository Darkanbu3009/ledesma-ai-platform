# Prueba manual: pinning de red por PAIS (rework de la identidad de red)

Verifica de punta a punta que el pinning de red por PAIS elimina los abortos por rotacion normal de
IP del pool de Browserbase: reconectar `en.wikipedia.org` pinea el pais del usuario, y una tarea de
lectura posterior se ejecuta DENTRO de la sesion aunque la IP de salida haya cambiado, siempre que
el pais de salida sea el pineado. Antes de este cambio (pinning por IP exacta), la misma tarea
abortaba con "la salida de red no coincide" en cuanto el pool rotaba la IP.

Guion para ejecutar sobre un entorno desplegado con la migracion V028 aplicada. Registrar los
resultados reales al ejecutarlo.

## Requisitos previos

- Migracion `V028__sitios_conectados_pais.sql` aplicada en el SQL Editor de Supabase (despues de
  V024/V025).
- Backend y worker desplegados con este cambio (Browserbase + `VAULT_SECRET` + `DATABASE_URL`,
  igual que `prueba-manual-tarea-web.md`).
- Una credencial de `anthropic` en la boveda del owner.

## Pasos

1. **Reconectar el sitio (pinea el pais).** En la UI de Sitios conectados, conectar (o reconectar)
   `https://en.wikipedia.org` y confirmar tras "loguearse" (Wikipedia no exige login; basta abrir la
   vista en vivo y confirmar). Verificar en la base:

   ```sql
   select dominio, estado, proxy_ref, proxy_country, egress_ip
   from sitios_conectados where dominio = 'en.wikipedia.org';
   ```

   - `estado = 'activo'`, `tiene_contexto = true`.
   - `proxy_country` poblado con el pais del usuario (ISO-2, p.ej. `AR` o `ES`), derivado del
     navegador (la consola manda `pais`; el backend cae a `Accept-Language`).
   - `egress_ip` poblada (informativa: ya NO es criterio de aborto).
   - En los logs del worker, la linea `sesion de login abierta` incluye `pais` y `egressIp`.

2. **Tarea de lectura dentro de la sesion.** En el Playground de un agente con la herramienta de
   sitios conectados (ver `prueba-manual-herramienta-sitios-en-agente.md`), pedir:
   "Lee el titulo del articulo destacado en mi wikipedia."

   - La tarea debe COMPLETARSE devolviendo el contenido real del articulo destacado, SIN abortar
     por red. Este es el punto que fallaba con el pinning por IP exacta: el pool rotativo devolvia
     otra IP y el worker abortaba con `SalidaDeRedNoDisponibleError`.
   - En los logs del worker: `tarea web: sesion abierta con el pais pineado` con `pais` igual al
     `proxy_country` de la fila y una `egressIp` (tipicamente DISTINTA a la de la conexion: eso es
     rotacion normal y ya no aborta), seguido de `tarea web completada dentro de la sesion del
     sitio`.

3. **Repetir la tarea.** Pedir otra tarea de lectura y verificar que vuelve a completarse aunque la
   `egressIp` logueada cambie de nuevo (dos sesiones consecutivas, mismo pais, IP distinta, cero
   abortos).

4. **(Negativo, opcional) Salto de pais.** Simular falta de cobertura editando `proxy_country` de la
   fila a un pais sin relacion (p.ej. `JP`) y pedir otra tarea:

   ```sql
   update sitios_conectados set proxy_country = 'JP' where dominio = 'en.wikipedia.org';
   ```

   - El job debe FALLAR con "no hay ruta de red disponible para tu region ... Reintenta mas tarde"
     sin ejecutar la tarea, y la fila queda `estado = 'error'` (marcada para reconectar). JAMAS debe
     ejecutarse la tarea saliendo por otro pais.
   - Restaurar: reconectar el sitio desde la UI (al estar la fila en error con pais ya pineado en
     `JP`, desconectar y conectar de nuevo para pinear el pais real).

## Resultado esperado

| Paso | Esperado |
| ---- | -------- |
| 1    | `proxy_country` pineado; logs con pais + IP |
| 2    | Tarea completada con contenido real; IP distinta NO aborta |
| 3    | Segunda tarea tambien completa (rotacion de IP invisible) |
| 4    | Pais distinto aborta con mensaje claro y marca el sitio en error |
