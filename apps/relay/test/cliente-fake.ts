import { webcrypto } from 'node:crypto';
import { HKDF_INFO, HKDF_SALT, nonceParaContador } from '@ledesma-platform/shared/relay-protocol';

/**
 * CLIENTE FALSO del relay para los tests, con WebCrypto (misma API que el navegador): X25519 efimero,
 * HKDF-SHA256 y AES-256-GCM con nonce por contador. Prueba la interoperabilidad real
 * cliente(WebCrypto) <-> relay(node:crypto): si esto descifra en el relay, el console tambien lo hara.
 * Usa `webcrypto` de node:crypto (mismos algoritmos que crypto.subtle del navegador) para tener tipos
 * sin depender del lib DOM en el tsconfig del relay.
 */

const subtle = webcrypto.subtle;

/** Copia a un ArrayBuffer limpio (evita fricciones de tipos entre Uint8Array y BufferSource). */
function ab(bytes: Uint8Array): ArrayBuffer {
  const copia = new Uint8Array(bytes.length);
  copia.set(bytes);
  return copia.buffer;
}

function aB64(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString('base64url');
}

function derB64(texto: string): ArrayBuffer {
  return ab(new Uint8Array(Buffer.from(texto, 'base64url')));
}

export interface ClienteFake {
  pubB64: string;
  derivarClave(relayPubB64: string): Promise<webcrypto.CryptoKey>;
}

export async function crearClienteFake(): Promise<ClienteFake> {
  const par = (await subtle.generateKey({ name: 'X25519' }, true, [
    'deriveBits',
  ])) as unknown as webcrypto.CryptoKeyPair;
  const spki = await subtle.exportKey('spki', par.publicKey);
  return {
    pubB64: aB64(spki),
    async derivarClave(relayPubB64: string): Promise<webcrypto.CryptoKey> {
      const relayPub = await subtle.importKey('spki', derB64(relayPubB64), { name: 'X25519' }, false, []);
      const compartido = await subtle.deriveBits({ name: 'X25519', public: relayPub }, par.privateKey, 256);
      const hkdf = await subtle.importKey('raw', compartido, 'HKDF', false, ['deriveKey']);
      return subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: ab(HKDF_SALT), info: ab(HKDF_INFO) },
        hkdf,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt'],
      );
    },
  };
}

/** Cifra una pulsacion ya codificada, con el nonce derivado del contador. Devuelve base64url(ct||tag). */
export async function cifrarFrame(
  clave: webcrypto.CryptoKey,
  contador: number,
  plano: Uint8Array,
): Promise<string> {
  const cuerpo = await subtle.encrypt(
    { name: 'AES-GCM', iv: ab(nonceParaContador(contador)), tagLength: 128 },
    clave,
    ab(plano),
  );
  return aB64(cuerpo);
}
