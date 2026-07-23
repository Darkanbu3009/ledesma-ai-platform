import {
  generateKeyPairSync,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  type KeyObject,
} from 'node:crypto';
import { HKDF_INFO, HKDF_SALT } from '@ledesma-platform/shared/relay-protocol';

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
