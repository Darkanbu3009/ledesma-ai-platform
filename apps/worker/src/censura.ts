/**
 * CENSURA de la traza de tareas web (Fase F, paso 1). Antes de persistir un paso en
 * pasos_trayectoria (V030), TODO valor tecleado y TODO texto libre pasa por estas funciones puras:
 * los valores de campos SENSIBLES (password, tarjetas, tokens, codigos) y cualquier secuencia con
 * pinta de numero de tarjeta se reemplazan por el marcador; JAMAS se guardan en claro.
 *
 * El criterio es ASIMETRICO a proposito (mismo espiritu que clasificarDesenlace): un falso positivo
 * censura de mas un valor inocente (se pierde un dato de depuracion, aceptable); un falso negativo
 * persiste una contrasena o una tarjeta (inaceptable). Ante la duda, se censura.
 *
 * Modulo PURO y sin dependencias para testearlo exhaustivamente (censura.test.ts) sin tocar el motor.
 */

/** Marcador que sustituye a un valor censurado. Explicito y buscable en la UI y en la base. */
export const VALOR_CENSURADO = '[CENSURADO]';

/**
 * Contexto (selector, instruccion o descripcion del campo) que marca un campo como SENSIBLE: todo lo
 * tecleado ahi se censura completo. Cubre credenciales (password/contrasena/clave/pin/otp/codigos de
 * verificacion), tarjetas (numero/cvv/vencimiento) y secretos tecnicos (token/secret/api key), en
 * espanol e ingles, porque el selector viene del DOM del sitio y la instruccion del modelo.
 */
const CONTEXTO_SENSIBLE =
  /password|passwd|contrasen|clave|secret|token|api[-_ ]?key|credencial|credential|otp|one[-_ ]?time|verification[-_ ]?code|codigo de (?:verificacion|seguridad)|security[-_ ]?code|pin\b|nip\b|cvv|cvc|csc|cvn|tarjeta|card[-_ ]?(?:number|num)|cardnumber|pan\b|ccn\b|cuenta bancaria|routing|clabe|iban|ssn|curp|social[-_ ]?security/i;

/**
 * Secuencia con pinta de NUMERO DE TARJETA: 13 a 19 digitos, con o sin espacios/guiones como
 * separadores. Atrapa "4111111111111111", "4111 1111 1111 1111" y "4111-1111-1111-1111". Se aplica
 * al VALOR y tambien DENTRO de textos libres (instrucciones), donde el numero puede venir embebido.
 */
const PATRON_TARJETA = /\d(?:[ -]?\d){12,18}/g;

/** ¿El contexto (selector + instruccion + descripcion) delata un campo sensible? */
export function esContextoSensible(contexto: string): boolean {
  return CONTEXTO_SENSIBLE.test(contexto);
}

/**
 * Censura un VALOR TECLEADO segun su contexto: si el campo es sensible, o el valor mismo parece un
 * numero de tarjeta, se devuelve el marcador entero (no una version parcial: hasta los ultimos 4
 * digitos de una tarjeta son dato personal). Un valor inocente vuelve intacto.
 */
export function censurarValor(valor: string, contexto: string): string {
  if (esContextoSensible(contexto)) return VALOR_CENSURADO;
  if (new RegExp(PATRON_TARJETA.source).test(valor)) return VALOR_CENSURADO;
  return valor;
}

/**
 * Censura un TEXTO LIBRE (instruccion del modelo, objetivo del usuario): reemplaza cada secuencia con
 * pinta de tarjeta por el marcador, conservando el resto del texto (que es lo que hace legible la
 * traza). No intenta detectar passwords aqui: un password no tiene forma reconocible dentro de un
 * texto; su proteccion es por CONTEXTO en censurarValor.
 */
export function censurarTexto(texto: string): string {
  return texto.replace(new RegExp(PATRON_TARJETA.source, 'g'), VALOR_CENSURADO);
}
