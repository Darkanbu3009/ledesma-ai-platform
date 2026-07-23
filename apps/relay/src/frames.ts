import { createDecipheriv } from 'node:crypto';
import { nonceParaContador } from '@ledesma-platform/shared/relay-protocol';

/**
 * Descifrado de un FRAME de pulsacion (AES-256-GCM). El nonce se DERIVA del contador monotono del
 * mensaje (protocolo compartido): no viaja en el frame, y como el contador es unico por sesion, el
 * nonce nunca se repite bajo la misma clave. El cuerpo cifrado es `ciphertext || authTag` (los ultimos
 * 16 bytes son el tag GCM, tal como lo produce WebCrypto en el cliente).
 *
 * Lanza si el tag no autentica (frame manipulado, contador alterado -> nonce distinto -> falla) o si el
 * cuerpo es demasiado corto. El texto plano devuelto es un Buffer que el llamador SOBREESCRIBE (fill 0)
 * tras reenviar; ese borrado solo alcanza al Buffer, porque decodificarlo para CDP obliga a copiarlo a un
 * string inmutable que no se puede borrar de forma determinista y solo libera el GC. Jamas se loguea.
 */

const AUTH_TAG_LENGTH = 16;

export function descifrarFrame(clave: Buffer, contador: number, cuerpoCifrado: Buffer): Buffer {
  if (cuerpoCifrado.length < AUTH_TAG_LENGTH) {
    throw new Error('frame demasiado corto');
  }
  const nonce = Buffer.from(nonceParaContador(contador));
  const tag = cuerpoCifrado.subarray(cuerpoCifrado.length - AUTH_TAG_LENGTH);
  const ciphertext = cuerpoCifrado.subarray(0, cuerpoCifrado.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', clave, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
