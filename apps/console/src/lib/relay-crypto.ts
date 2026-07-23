import { HKDF_INFO, HKDF_SALT, nonceParaContador } from '@ledesma-platform/shared/relay-protocol';

/**
 * Capa de cifrado del cliente para el relay de teclado movil (conocimiento minimo), con WebCrypto del
 * navegador: X25519 efimero por sesion, HKDF-SHA256 y AES-256-GCM con nonce por contador. PROHIBIDO
 * implementar primitivas propias: todo sale de crypto.subtle. Interopera con node:crypto del servicio
 * relay usando los MISMOS parametros del protocolo compartido (probado en apps/relay/test).
 *
 * ESTO NO ES CIFRADO EXTREMO A EXTREMO: protege el texto plano frente al proxy que termina TLS y a los
 * logs de plataforma; el navegador remoto (Browserbase) recibe el texto legible por CDP.
 */

function u8ToB64url(bytes: Uint8Array): string {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToU8(texto: string): Uint8Array {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const binario = atob(b64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** Copia a un ArrayBuffer limpio (evita fricciones de tipos entre Uint8Array y BufferSource). */
function ab(bytes: Uint8Array): ArrayBuffer {
  const copia = new Uint8Array(bytes.length);
  copia.set(bytes);
  return copia.buffer;
}

export interface ParEfimeroCliente {
  par: CryptoKeyPair;
  /** Clave publica X25519 en SPKI DER, base64url, para el cli_hello. */
  pubB64: string;
}

/**
 * ¿El navegador soporta X25519 en WebCrypto? En dispositivos viejos sin soporte, la UI movil cae al
 * aviso de "hazlo desde una computadora" en vez de intentar un canal que no puede cifrar.
 */
export async function soportaRelay(): Promise<boolean> {
  if (typeof crypto === 'undefined' || crypto.subtle === undefined || typeof WebSocket === 'undefined') {
    return false;
  }
  try {
    await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    return true;
  } catch {
    return false;
  }
}

/** Genera el par X25519 efimero del cliente para UNA sesion de login. */
export async function crearParEfimero(): Promise<ParEfimeroCliente> {
  const par = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', par.publicKey));
  return { par, pubB64: u8ToB64url(spki) };
}

/** Deriva la clave AES-256-GCM de sesion desde la privada del cliente y la publica del relay (SPKI b64). */
export async function derivarClaveSesion(par: CryptoKeyPair, relayPubB64: string): Promise<CryptoKey> {
  const relayPub = await crypto.subtle.importKey(
    'spki',
    ab(b64urlToU8(relayPubB64)),
    { name: 'X25519' },
    false,
    [],
  );
  const compartido = await crypto.subtle.deriveBits({ name: 'X25519', public: relayPub }, par.privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', compartido, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ab(HKDF_SALT), info: ab(HKDF_INFO) },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
}

/** Cifra una pulsacion ya codificada con el nonce derivado del contador. Devuelve base64url(ct||tag). */
export async function cifrarPulsacion(
  clave: CryptoKey,
  contador: number,
  plano: Uint8Array,
): Promise<string> {
  const cuerpo = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ab(nonceParaContador(contador)), tagLength: 128 },
    clave,
    ab(plano),
  );
  return u8ToB64url(new Uint8Array(cuerpo));
}
