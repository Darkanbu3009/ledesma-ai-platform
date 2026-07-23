import {
  generateKeyPairSync,
  createPublicKey,
  createHmac,
  diffieHellman,
  hkdfSync,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import {
  HKDF_INFO,
  HKDF_SALT,
  HKDF_MAC_INFO,
  MAC_ROLE_CLIENTE,
  MAC_ROLE_RELAY,
  mensajeMacHandshake,
} from '@ledesma-platform/shared/relay-protocol';

/**
 * HANDSHAKE del canal del relay: ECDH X25519 EFIMERO por sesion de login + HKDF-SHA256 -> clave
 * AES-256-GCM de sesion. La clave privada del relay VIVE SOLO EN LA MEMORIA de este proceso y muere con
 * la sesion (el KeyObject se descarta al cerrar). node:crypto hace todo; cero cripto propia.
 *
 * Interopera con WebCrypto del cliente usando SPKI DER para las claves publicas: WebCrypto exporta
 * 'spki' e importa 'spki'; node exporta/importa el mismo DER. Los parametros de HKDF (info/salt) vienen
 * del protocolo compartido, asi que ambos lados derivan la MISMA clave.
 */

const AES_KEY_LENGTH = 32; // aes-256-gcm

export interface ParEfimero {
  /** Clave publica X25519 en SPKI DER, base64url, para enviar al cliente en el server_hello. */
  publicKeyB64: string;
  /** Clave privada efimera: solo en memoria, nunca sale del proceso ni se loguea. */
  privateKey: KeyObject;
}

/** Genera un par X25519 efimero para UNA sesion de relay. */
export function generarParEfimero(): ParEfimero {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return { publicKeyB64: Buffer.from(spki).toString('base64url'), privateKey };
}

/**
 * Deriva la clave AES-256-GCM de sesion a partir de la privada efimera del relay y la publica del
 * cliente (SPKI DER base64url). Rechaza una clave que no sea X25519. El secreto compartido ECDH se pasa
 * por HKDF-SHA256 (nunca se usa crudo como clave). Lanza ante entrada invalida; el llamador cierra el
 * canal sin filtrar detalle.
 */
export function derivarClaveSesion(privateKey: KeyObject, clientPublicKeyB64: string): Buffer {
  const der = Buffer.from(clientPublicKeyB64, 'base64url');
  const publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (publicKey.asymmetricKeyType !== 'x25519') {
    throw new Error('clave publica del cliente no es X25519');
  }
  const secretoCompartido = diffieHellman({ privateKey, publicKey });
  const clave = hkdfSync('sha256', secretoCompartido, HKDF_SALT, HKDF_INFO, AES_KEY_LENGTH);
  return Buffer.from(clave);
}

const MAC_KEY_LENGTH = 32; // HMAC-SHA256

/**
 * Deriva la clave de la MAC de confirmacion desde el secreto de enlace del token (base64url). HKDF-SHA256
 * con un `info` DISTINTO al de la clave AES: la clave de MAC no comparte material con la de cifrado.
 */
function derivarClaveMac(bindingKeyB64: string): Buffer {
  const ikm = Buffer.from(bindingKeyB64, 'base64url');
  return Buffer.from(hkdfSync('sha256', ikm, HKDF_SALT, HKDF_MAC_INFO, MAC_KEY_LENGTH));
}

/** Calcula la MAC (HMAC-SHA256) de confirmacion de un rol sobre el transcript del handshake. */
function calcularMac(
  role: number,
  relayPubB64: string,
  clientPubB64: string,
  token: string,
  bindingKeyB64: string,
): Buffer {
  const mensaje = Buffer.from(mensajeMacHandshake(role, relayPubB64, clientPubB64, token));
  return createHmac('sha256', derivarClaveMac(bindingKeyB64)).update(mensaje).digest();
}

/**
 * VERIFICA la MAC del cliente sobre el transcript (relayPub que el relay ENVIO, clientPub que RECIBIO,
 * token). Si el MITM sustituyo cualquier publica, el transcript del cliente difiere del del relay y esta
 * MAC no coincide. Comparacion en TIEMPO CONSTANTE (timingSafeEqual); el chequeo de longitud previo
 * evita que lance con buffers de distinto tamano y no filtra timing (la longitud del HMAC es fija).
 * Devuelve false ante cualquier forma invalida (mac corrupta, secreto que no corresponde): el llamador
 * corta el canal sin filtrar detalle.
 */
export function verificarMacCliente(
  macB64: string,
  relayPubB64: string,
  clientPubB64: string,
  token: string,
  bindingKeyB64: string,
): boolean {
  let recibida: Buffer;
  try {
    recibida = Buffer.from(macB64, 'base64url');
  } catch {
    return false;
  }
  const esperada = calcularMac(MAC_ROLE_CLIENTE, relayPubB64, clientPubB64, token, bindingKeyB64);
  return esperada.length === recibida.length && esperada.length > 0 && timingSafeEqual(esperada, recibida);
}

/**
 * Calcula la MAC del RELAY (base64url) para que el cliente confirme que habla con el relay legitimo antes
 * de teclear: un MITM que sustituyo la pata del relay no conoce el secreto de enlace y no puede producirla.
 */
export function macRelay(
  relayPubB64: string,
  clientPubB64: string,
  token: string,
  bindingKeyB64: string,
): string {
  return calcularMac(MAC_ROLE_RELAY, relayPubB64, clientPubB64, token, bindingKeyB64).toString('base64url');
}
