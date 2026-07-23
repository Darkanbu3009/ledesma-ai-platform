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

/** `info` de HKDF-SHA256 (contexto de derivacion de la CLAVE AES). Fijo en ambos lados. */
export const HKDF_INFO: Uint8Array = new TextEncoder().encode('ledesma-relay-teclado-v1');

/** `salt` de HKDF: vacio (la aleatoriedad viene del ECDH efimero por sesion). */
export const HKDF_SALT: Uint8Array = new Uint8Array(0);

/**
 * AUTENTICACION DEL HANDSHAKE (channel binding contra un MITM en el proxy que termina TLS).
 *
 * El ECDH X25519 por si solo NO esta autenticado: un adversario activo puede sustituir la publica en
 * cada pata, compartir una clave con cada extremo y leer cada pulsacion. Para detectarlo, ambos lados
 * confirman la clave con un HMAC sobre el TRANSCRIPT del handshake (las DOS publicas + el token),
 * usando como raiz de confianza un secreto de enlace `bk` que el backend mete DENTRO del token cifrado
 * (que el cliente no puede descifrar) y ademas entrega al cliente por su canal confiable con el backend.
 * Como el MITM ve el token cifrado pero no `bk`, no puede forjar el HMAC: sustituir cualquier publica
 * cambia el transcript y la MAC deja de validar. Nada de esto es cripto propia: solo HKDF/HMAC-SHA256.
 *
 * `info` de HKDF-SHA256 para DERIVAR LA CLAVE DE MAC desde `bk`. Distinta de HKDF_INFO (la clave AES no
 * comparte material con la clave de MAC).
 */
export const HKDF_MAC_INFO: Uint8Array = new TextEncoder().encode('ledesma-relay-handshake-mac-v1');

/** Etiqueta de dominio del transcript del handshake (fija en ambos lados). */
export const HANDSHAKE_LABEL: Uint8Array = new TextEncoder().encode('ledesma-relay-handshake-v1');

/** Rol del extremo en la MAC de confirmacion (separa la MAC del cliente de la del relay). */
export const MAC_ROLE_CLIENTE = 1;
export const MAC_ROLE_RELAY = 2;

/** Agrega a `out` el prefijo de longitud (uint32 big-endian) seguido de los bytes UTF-8 de `s`. */
function agregarConLongitud(out: number[], s: string): void {
  const bytes = new TextEncoder().encode(s);
  const n = bytes.length;
  out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  for (const b of bytes) out.push(b);
}

/**
 * TRANSCRIPT del handshake: `LABEL || version || lp(relayPub) || lp(clientPub) || lp(token)`, donde
 * `lp(x)` es la longitud en uint32 big-endian seguida de los bytes de `x`. El prefijo de longitud lo
 * hace inequivoco (ningun corrimiento entre campos produce el mismo transcript). Cada lado lo arma con
 * SU vista local: el cliente usa el relayPub que RECIBIO y el clientPub que ENVIO; el relay usa el
 * relayPub que ENVIO y el clientPub que RECIBIO. Si el MITM sustituye cualquier publica, los dos
 * transcripts difieren en ese campo y la MAC no coincide. Puro (solo Uint8Array/TextEncoder) para que
 * cliente (WebCrypto) y relay (node:crypto) produzcan bytes IDENTICOS.
 */
export function transcriptoHandshake(
  relayPubB64: string,
  clientPubB64: string,
  token: string,
): Uint8Array {
  const out: number[] = [];
  for (const b of HANDSHAKE_LABEL) out.push(b);
  out.push(RELAY_PROTOCOL_VERSION & 0xff);
  agregarConLongitud(out, relayPubB64);
  agregarConLongitud(out, clientPubB64);
  agregarConLongitud(out, token);
  return Uint8Array.from(out);
}

/**
 * Mensaje sobre el que se calcula el HMAC de confirmacion: `role || transcript`. El byte de rol separa
 * la MAC del cliente de la del relay bajo la MISMA clave (un lado no puede reusar la MAC del otro).
 */
export function mensajeMacHandshake(
  role: number,
  relayPubB64: string,
  clientPubB64: string,
  token: string,
): Uint8Array {
  const transcripto = transcriptoHandshake(relayPubB64, clientPubB64, token);
  const mensaje = new Uint8Array(transcripto.length + 1);
  mensaje[0] = role & 0xff;
  mensaje.set(transcripto, 1);
  return mensaje;
}

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
