/**
 * CENSURA de la traza de tareas web (Fase F, paso 1). Antes de persistir un paso en
 * pasos_trayectoria (V030), TODO valor tecleado y TODO texto libre pasa por estas funciones puras:
 * los valores de campos SENSIBLES (password, tarjetas, tokens, codigos) y cualquier secuencia con
 * pinta de numero de tarjeta o de credencial dictada se reemplazan por el marcador; JAMAS se
 * guardan en claro.
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
 * espanol e ingles, porque el selector viene del DOM del sitio y la descripcion/instruccion del
 * modelo. "contrase[ñn]" cubre contrasena Y contraseña (revision adversarial: la description de un
 * sitio en espanol trae la enie).
 */
const CONTEXTO_SENSIBLE =
  /password|passwd|pwd|passcode|contrase[ñn]|clave|secret|token|api[-_ ]?key|credencial|credential|otp|one[-_ ]?time|verification[-_ ]?code|codigo de (?:verificacion|seguridad)|security[-_ ]?code|pin\b|nip\b|cvv|cvc|csc|cvn|tarjeta|card[-_ ]?(?:number|num)|cardnumber|pan\b|ccn\b|cuenta bancaria|routing|clabe|iban|ssn|curp|social[-_ ]?security/i;

/**
 * Secuencia con pinta de NUMERO DE TARJETA: 13 a 19 digitos, con espacios, guiones, puntos o punto
 * medio como separadores. Atrapa "4111111111111111", "4111 1111 1111 1111", "4111-1111-1111-1111" y
 * "4111.1111.1111.1111". Se aplica al VALOR y tambien DENTRO de textos libres (instrucciones y
 * objetivo), donde el numero puede venir embebido.
 */
const PATRON_TARJETA = /\d(?:[ .·-]?\d){12,18}/;

/**
 * CREDENCIAL DICTADA dentro de un texto libre: "con contraseña hunter2", "password: x", "pin es
 * 1234". Se censura el token que sigue a la palabra clave (el resto del texto sobrevive, que es lo
 * que hace legible la traza). Cubre el patron realista de un objetivo que trae la credencial
 * embebida (revision adversarial). Puede censurar de mas ("password reset" pierde "reset"):
 * aceptable por el criterio asimetrico.
 */
const PATRON_CREDENCIAL_EN_TEXTO =
  /\b(contrase[ñn]a|password|passwd|pwd|passcode|clave|pin|nip|token|otp)\b\s*(?:es|is)?\s*[:=]?\s*("[^"]+"|'[^']+'|\S+)/gi;

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
 * Censura un TEXTO LIBRE (instruccion del modelo): reemplaza cada secuencia con pinta de tarjeta
 * por el marcador, conservando el resto del texto (que es lo que hace legible la traza). Los
 * valores tecleados que la instruccion pudiera embeber ya se borran aparte (trayectoria.ts, scrub
 * por argumento); el patron de credencial dictada NO se aplica aqui porque en una instruccion la
 * frase "the password field" es un sustantivo comun, no una credencial.
 */
export function censurarTexto(texto: string): string {
  return texto.replace(new RegExp(PATRON_TARJETA.source, 'g'), VALOR_CENSURADO);
}

/**
 * Censura el OBJETIVO del usuario: ademas de las tarjetas, censura las credenciales DICTADAS
 * ("entra con contraseña hunter2", "pin: 1234"), un patron realista en texto de usuario (revision
 * adversarial). La palabra clave se conserva (documenta QUE se censuro).
 */
export function censurarObjetivo(texto: string): string {
  return censurarTexto(texto).replace(
    PATRON_CREDENCIAL_EN_TEXTO,
    (_m, palabra: string) => `${palabra} ${VALOR_CENSURADO}`,
  );
}

/**
 * Censura una URL antes de persistirla: conserva SOLO origen + path y descarta query string y
 * fragment (ahi viajan tokens de reset, codigos OAuth y session ids; revision adversarial). Una URL
 * no parseable se descarta entera (null): mejor perder el dato que persistir algo no analizable.
 */
export function censurarUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}
