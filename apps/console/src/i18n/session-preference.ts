/**
 * Marca EN MEMORIA de que el usuario ya eligio idioma en esta sesion (modal de la landing o
 * selector de Configuracion). Vive a nivel de modulo porque la app es una SPA: sobrevive a la
 * navegacion entre rutas pero se pierde al recargar, que es exactamente el alcance pedido para la
 * fase 1 (localStorage no esta soportado). Cuando exista persistencia real de la preferencia
 * (perfil del backend), este modulo es el punto unico a reemplazar.
 */

let languageChosen = false;

/** true si el usuario ya fijo idioma en esta sesion (el modal de la landing no debe reaparecer). */
export function hasSessionLanguageChoice(): boolean {
  return languageChosen;
}

export function markSessionLanguageChoice(): void {
  languageChosen = true;
}
