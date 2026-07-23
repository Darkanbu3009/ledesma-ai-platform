// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  HKDF_SALT,
  HKDF_MAC_INFO,
  MAC_ROLE_RELAY,
  mensajeMacHandshake,
} from '@ledesma-platform/shared/relay-protocol';

// relay-teclado importa `solicitarTokenRelay` desde ./api (que carga supabase y su env). Aca solo se
// ejercita ConexionRelayTeclado (que no usa la API): se mockea ./api para no arrastrar esa cadena.
vi.mock('../src/lib/api', () => ({ apiFetch: vi.fn() }));

import { ConexionRelayTeclado, type EstadoConexionRelay } from '../src/lib/relay-teclado';

/**
 * Verifica el lado CLIENTE del handshake autenticado (A-1): el cliente NO debe pasar a 'listo' (ni
 * teclear) hasta confirmar la MAC del relay en el `ready`. Un `ready` sin MAC valida (un MITM que
 * sustituyo la pata del relay y no conoce `hs`) lo deja en 'error'.
 */

function ab(bytes: Uint8Array): ArrayBuffer {
  const copia = new Uint8Array(bytes.length);
  copia.set(bytes);
  return copia.buffer;
}

function b64url(buf: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(buf)).toString('base64url');
}

/** Fabrica una publica X25519 del "relay" (SPKI base64url) y calcula la MAC del relay. */
async function relayFalso() {
  const par = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pubB64 = b64url(await crypto.subtle.exportKey('spki', par.publicKey));
  const hs = b64url(ab(crypto.getRandomValues(new Uint8Array(32))));
  async function claveMac(): Promise<CryptoKey> {
    const hkdf = await crypto.subtle.importKey('raw', ab(Buffer.from(hs, 'base64url')), 'HKDF', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: ab(HKDF_SALT), info: ab(HKDF_MAC_INFO) },
      hkdf,
      256,
    );
    return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  async function macRelay(clientPubB64: string, token: string): Promise<string> {
    const clave = await claveMac();
    const mensaje = mensajeMacHandshake(MAC_ROLE_RELAY, pubB64, clientPubB64, token);
    return b64url(await crypto.subtle.sign('HMAC', clave, ab(mensaje)));
  }
  return { pubB64, hs, macRelay };
}

interface SocketFake {
  ws: WebSocket;
  enviados: Array<Record<string, unknown>>;
  emitir(obj: Record<string, unknown>): void;
}

function crearSocketFake(): SocketFake {
  const enviados: Array<Record<string, unknown>> = [];
  const ws = {
    send: (data: string) => enviados.push(JSON.parse(data) as Record<string, unknown>),
    close: () => undefined,
    onmessage: null as ((ev: { data: string }) => void) | null,
    onerror: null as (() => void) | null,
    onclose: null as (() => void) | null,
  };
  return {
    ws: ws as unknown as WebSocket,
    enviados,
    emitir(obj) {
      ws.onmessage?.({ data: JSON.stringify(obj) });
    },
  };
}

async function correrHastaCliHello(hs: string, relayPubB64: string, token: string) {
  const estados: EstadoConexionRelay[] = [];
  const sock = crearSocketFake();
  const conexion = new ConexionRelayTeclado({
    relayUrl: 'wss://relay.example',
    token,
    hs,
    onEstado: (e) => estados.push(e),
    crearSocket: () => sock.ws,
  });
  await conexion.conectar();
  sock.emitir({ t: 'srv_hello', v: 1, pub: relayPubB64 });
  // El cliente deriva la clave y envia el cli_hello (async).
  await vi.waitFor(() => expect(sock.enviados.some((m) => m.t === 'cli_hello')).toBe(true));
  const cliHello = sock.enviados.find((m) => m.t === 'cli_hello') as { pub: string; mac: string };
  expect(typeof cliHello.mac).toBe('string');
  expect(cliHello.mac.length).toBeGreaterThan(0);
  return { estados, sock, clientPubB64: cliHello.pub };
}

describe('ConexionRelayTeclado: verificacion de la MAC del relay (A-1)', () => {
  it('pasa a listo con un ready cuya MAC del relay es valida', async () => {
    const relay = await relayFalso();
    const token = 'tok-123';
    const { estados, sock, clientPubB64 } = await correrHastaCliHello(relay.hs, relay.pubB64, token);

    sock.emitir({ t: 'ready', mac: await relay.macRelay(clientPubB64, token) });
    await vi.waitFor(() => expect(estados).toContain('listo'));
    expect(estados).not.toContain('error');
  });

  it('NO pasa a listo (queda en error) con un ready SIN MAC (MITM sin hs)', async () => {
    const relay = await relayFalso();
    const token = 'tok-123';
    const { estados, sock } = await correrHastaCliHello(relay.hs, relay.pubB64, token);

    sock.emitir({ t: 'ready' }); // sin mac
    await vi.waitFor(() => expect(estados).toContain('error'));
    expect(estados).not.toContain('listo');
  });

  it('NO pasa a listo con un ready cuya MAC es de OTRO hs (impostor)', async () => {
    const relay = await relayFalso();
    const impostor = await relayFalso();
    const token = 'tok-123';
    const { estados, sock, clientPubB64 } = await correrHastaCliHello(relay.hs, relay.pubB64, token);

    // MAC firmada con el hs del impostor (no el que el backend le dio al cliente): no valida.
    sock.emitir({ t: 'ready', mac: await impostor.macRelay(clientPubB64, token) });
    await vi.waitFor(() => expect(estados).toContain('error'));
    expect(estados).not.toContain('listo');
  });
});
