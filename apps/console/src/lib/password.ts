/**
 * Longitud minima de contrasena validada en cliente, compartida por crear
 * cuenta (/crear-cuenta) y nueva contrasena (/nueva-contrasena). Es el minimo
 * que Supabase Auth aplica por defecto en el servidor; si el proyecto
 * configura una regla mas estricta, el error del servidor (weak_password) se
 * muestra tal cual en vez de prometer aqui una regla distinta.
 */
export const MIN_PASSWORD_LENGTH = 6;
