import {
  HKDF_INFO,
  HKDF_SALT,
  HKDF_MAC_INFO,
  MAC_ROLE_CLIENTE,
  MAC_ROLE_RELAY,
  mensajeMacHandshake,
  nonceParaContador,
} from '@ledesma-platform/shared/relay-protocol';

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

/**
 * Deriva la clave de la MAC de confirmacion del handshake (A-1) desde el secreto de enlace `hs` que el
 * backend entrego al cliente (base64url). HKDF-SHA256 con un `info` DISTINTO al de la clave AES: la MAC
 * no comparte material con el cifrado. Interopera byte a byte con node:crypto del relay (mismo ikm/salt/
 * info/hash -> misma clave). La clave se importa para 'sign' y 'verify' (el cliente firma la suya y
 * verifica la del relay).
 */
async function derivarClaveMac(hsB64: string): Promise<CryptoKey> {
  const hkdf = await crypto.subtle.importKey('raw', ab(b64urlToU8(hsB64)), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: ab(HKDF_SALT), info: ab(HKDF_MAC_INFO) },
    hkdf,
    256,
  );
  return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/**
 * Calcula la MAC del CLIENTE sobre el transcript del handshake (la publica del relay que RECIBIO, la
 * propia que ENVIA, el token). El relay la verifica: si un MITM sustituyo cualquier publica, el
 * transcript difiere y la MAC no valida. Devuelve base64url.
 */
export async function macClienteHandshake(
  hsB64: string,
  relayPubB64: string,
  clientPubB64: string,
  token: string,
): Promise<string> {
  const clave = await derivarClaveMac(hsB64);
  const mensaje = mensajeMacHandshake(MAC_ROLE_CLIENTE, relayPubB64, clientPubB64, token);
  const firma = await crypto.subtle.sign('HMAC', clave, ab(mensaje));
  return u8ToB64url(new Uint8Array(firma));
}

/**
 * Verifica la MAC del RELAY (base64url) sobre el mismo transcript antes de teclear: si no valida, el otro
 * extremo no conoce el secreto de enlace (es un impostor / MITM) y el cliente NO debe enviar pulsaciones.
 */
export async function verificarMacRelay(
  hsB64: string,
  relayPubB64: string,
  clientPubB64: string,
  token: string,
  macB64: string,
): Promise<boolean> {
  const clave = await derivarClaveMac(hsB64);
  const mensaje = mensajeMacHandshake(MAC_ROLE_RELAY, relayPubB64, clientPubB64, token);
  return crypto.subtle.verify('HMAC', clave, ab(b64urlToU8(macB64)), ab(mensaje));
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
