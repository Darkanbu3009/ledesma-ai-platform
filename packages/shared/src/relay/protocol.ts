/**
 * PROTOCOLO DE CABLE del relay de teclado movil (conocimiento minimo). Constantes y helpers PUROS
 * (solo Uint8Array / TextEncoder, sin node:crypto ni WebCrypto) para que el CLIENTE (console, WebCrypto)
 * y el SERVICIO RELAY (node:crypto) coincidan byte-por-byte en: version, parametros de HKDF,
 * construccion del nonce por contador y codificacion de la pulsacion. Al vivir en un solo lugar, los
 * dos lados no pueden divergir.
 *
 * ESTO NO ES CIFRADO EXTREMO A EXTREMO. Es el sobre del canal cifrado a nivel de aplicacion (ademas de
 * TLS) cuyo unico fin es que el texto plano de las pulsaciones NO exista en el proxy que termina TLS ni
 * en logs de plataforma. El destino (Browserbase) recibe el texto legible por CDP: eso es inevitable.
 */

/** Version del protocolo. Un cliente y un relay con versiones distintas no negocian. */
export const RELAY_PROTOCOL_VERSION = 1;

/** `info` de HKDF-SHA256 (contexto de derivacion). Fijo en ambos lados. */
export const HKDF_INFO: Uint8Array = new TextEncoder().encode('ledesma-relay-teclado-v1');

/** `salt` de HKDF: vacio (la aleatoriedad viene del ECDH efimero por sesion). */
export const HKDF_SALT: Uint8Array = new Uint8Array(0);

/** Longitud del nonce AES-GCM (96 bits). */
export const NONCE_LENGTH = 12;

/**
 * Construye el nonce AES-GCM de un mensaje a partir de su CONTADOR MONOTONO: 4 bytes en cero seguidos
 * del contador en big-endian de 64 bits. Como el contador es unico y estrictamente creciente por
 * sesion, el nonce NUNCA se repite bajo la misma clave (requisito duro de GCM), sin necesidad de
 * transmitir el iv. Un contador manipulado produce un nonce distinto -> el descifrado GCM falla.
 */
export function nonceParaContador(contador: number): Uint8Array {
  const nonce = new Uint8Array(NONCE_LENGTH);
  const view = new DataView(nonce.buffer);
  view.setBigUint64(NONCE_LENGTH - 8, BigInt(contador), false);
  return nonce;
}

/** Tipos de pulsacion en el byte 0 del texto plano. */
export const KIND_TEXTO = 1;
export const KIND_TECLA = 2;

/** Teclas de control soportadas para un login real. */
export type TeclaControl = 'Enter' | 'Backspace' | 'Tab';

const ID_POR_TECLA: Record<TeclaControl, number> = { Enter: 1, Backspace: 2, Tab: 3 };
const TECLA_POR_ID: Record<number, TeclaControl> = { 1: 'Enter', 2: 'Backspace', 3: 'Tab' };

/** Pulsacion ya decodificada del texto plano (nunca se loguea ni persiste). */
export type Pulsacion =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'tecla'; tecla: TeclaControl };

/** Codifica texto a insertar: [KIND_TEXTO, ...utf8(texto)]. */
export function codificarTexto(texto: string): Uint8Array {
  const cuerpo = new TextEncoder().encode(texto);
  const bytes = new Uint8Array(cuerpo.length + 1);
  bytes[0] = KIND_TEXTO;
  bytes.set(cuerpo, 1);
  return bytes;
}

/** Codifica una tecla de control: [KIND_TECLA, id]. */
export function codificarTecla(tecla: TeclaControl): Uint8Array {
  return new Uint8Array([KIND_TECLA, ID_POR_TECLA[tecla]]);
}

/**
 * Decodifica el texto plano de una pulsacion. Devuelve null ante cualquier forma invalida (byte de
 * tipo desconocido, tecla desconocida, control sin id). El llamador descarta el frame sin loguearlo.
 */
export function decodificarPulsacion(bytes: Uint8Array): Pulsacion | null {
  if (bytes.length === 0) return null;
  const kind = bytes[0];
  if (kind === KIND_TEXTO) {
    return { tipo: 'texto', texto: new TextDecoder().decode(bytes.subarray(1)) };
  }
  if (kind === KIND_TECLA) {
    if (bytes.length < 2) return null;
    const tecla = TECLA_POR_ID[bytes[1] as number];
    return tecla === undefined ? null : { tipo: 'tecla', tecla };
  }
  return null;
}
