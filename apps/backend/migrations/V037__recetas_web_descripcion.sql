-- LO QUE EL USUARIO ENSENO, EN SUS PALABRAS: una columna `descripcion` en recetas_web (V035) con el
-- texto en lenguaje llano que el usuario escribio al ensenar la tarea ("que le vas a ensenar",
-- grabaciones.descripcion, V036). Hasta ahora ese texto se perdia al promover: de la grabacion solo
-- sobrevivia la FIRMA del objetivo (el texto normalizado con los datos sustituidos por marcadores),
-- que sirve para buscar una coincidencia exacta y para nada mas.
--
-- POR QUE HACE FALTA, medido en produccion: una grabacion cuya descripcion fue "enviar un correo"
-- quedo bajo esa firma. Cuando despues se pidio "manda un correo a X con el asunto Y y dile Z", la
-- firma que se calculo fue otra y lo aprendido nunca se encontro, aunque describia exactamente esa
-- tarea. La firma exacta se conserva como via rapida (si coincide, no se consulta a nadie); la
-- descripcion es lo que permite RECONOCER la tarea cuando el usuario la pide con otras palabras, y es
-- ademas lo unico mostrable: la consola no puede ensenarle una firma a nadie.
--
-- QUE NO ES: no es un objetivo ejecutable ni entra en la ejecucion. Los pasos se ejecutan igual, con
-- la MISMA verificacion determinista de parametros y la MISMA politica del usuario (V034). Esta
-- columna no autoriza nada: solo dice, en palabras del usuario, que hace la tarea que ya sabe hacer.
--
-- PRIVACIDAD: es el texto que el usuario escribio para si mismo al empezar a grabar, no un dato
-- capturado del sitio. NULL en toda receta anterior (y en las que se promueven solas desde una
-- corrida exitosa del agente, que no tienen un texto del usuario que copiar): quien la lee cae a la
-- firma, que ya se persistia.
--
-- Operacion: como el resto de las migraciones de este repo, se aplica A MANO en el SQL Editor de
-- Supabase (no hay runner automatico: ni el backend, ni el worker, ni CI las ejecutan). Este archivo
-- es IDEMPOTENTE: re-aplicarlo es un NO-OP. Revertir es
--   alter table recetas_web drop column if exists descripcion;

alter table recetas_web add column if not exists descripcion text;

-- El BORRADO de una receta ("que la olvide") lo hace el backend con el rol de servicio, igual que
-- todas las escrituras de esta tabla. NO se agrega ninguna policy de DELETE para los roles de
-- cliente: exponerlo por PostgREST dejaria que un cliente borrara filas sin pasar por el endpoint,
-- que es donde vive la comprobacion de pertenencia. El REVOKE de V035 sigue vigente y se repite aqui
-- por si esta migracion se aplicara sola.
revoke insert, update, delete on recetas_web from authenticated, anon;
