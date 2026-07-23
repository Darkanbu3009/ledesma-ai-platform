// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  generateKeyPairSync,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  createDecipheriv,
} from 'node:crypto';
import {
  HKDF_INFO,
  HKDF_SALT,
  nonceParaContador,
  codificarTexto,
  decodificarPulsacion,
} from '@ledesma-platform/shared/relay-protocol';
import { crearParEfimero, derivarClaveSesion, cifrarPulsacion } from '../src/lib/relay-crypto';

/**
 * Prueba que la capa de cifrado del CLIENTE (relay-crypto.ts, WebCrypto) interopera con el SERVICIO
 * RELAY (node:crypto). El "relay" de este test reproduce exactamente handshake.ts/frames.ts del relay.
 * Si el cliente cifra y el relay descifra, el canal real funciona.
 */
function relayDerivaClave(relayPriv: import('node:crypto').KeyObject, clientePubB64: string): Buffer {
  const der = Buffer.from(clientePubB64, 'base64url');
  const pub = createPublicKey({ key: der, format: 'der', type: 'spki' });
  const compartido = diffieHellman({ privateKey: relayPriv, publicKey: pub });
  return Buffer.from(hkdfSync('sha256', compartido, HKDF_SALT, HKDF_INFO, 32));
}

function relayDescifra(clave: Buffer, contador: number, ctB64: string): Uint8Array {
  const cuerpo = Buffer.from(ctB64, 'base64url');
  const tag = cuerpo.subarray(cuerpo.length - 16);
  const ct = cuerpo.subarray(0, cuerpo.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', clave, Buffer.from(nonceParaContador(contador)));
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ct), decipher.final()]));
}

describe('relay-crypto (cliente) interopera con node:crypto (relay)', () => {
  it('handshake ECDH + AES-GCM: el relay descifra lo que cifra el cliente', async () => {
    // Lado relay: par X25519 y su publica en SPKI.
    const relay = generateKeyPairSync('x25519');
    const relayPubB64 = Buffer.from(relay.publicKey.export({ type: 'spki', format: 'der' })).toString(
      'base64url',
    );

    // Lado cliente (el modulo real del console).
    const cliente = await crearParEfimero();
    const claveCliente = await derivarClaveSesion(cliente.par, relayPubB64);

    // El relay deriva su clave desde la publica del cliente: deben coincidir.
    const claveRelay = relayDerivaClave(relay.privateKey, cliente.pubB64);

    const ct = await cifrarPulsacion(claveCliente, 1, codificarTexto('hunter2-Ñ'));
    const plano = relayDescifra(claveRelay, 1, ct);
    const pulsacion = decodificarPulsacion(plano);
    expect(pulsacion).toEqual({ tipo: 'texto', texto: 'hunter2-Ñ' });
  });

  it('nonce por contador: distinto contador, distinto nonce (no reuso bajo la misma clave)', async () => {
    const relay = generateKeyPairSync('x25519');
    const relayPubB64 = Buffer.from(relay.publicKey.export({ type: 'spki', format: 'der' })).toString(
      'base64url',
    );
    const cliente = await crearParEfimero();
    const clave = await derivarClaveSesion(cliente.par, relayPubB64);
    const a = await cifrarPulsacion(clave, 1, codificarTexto('x'));
    const b = await cifrarPulsacion(clave, 2, codificarTexto('x'));
    expect(a).not.toBe(b); // mismo plano, distinto contador -> distinto ciphertext
  });
});
