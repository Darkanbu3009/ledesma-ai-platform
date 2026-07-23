import { describe, it, expect } from 'vitest';
import {
  MAC_ROLE_CLIENTE,
  MAC_ROLE_RELAY,
  mensajeMacHandshake,
  transcriptoHandshake,
} from '../src/relay/protocol.js';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('transcriptoHandshake', () => {
  it('es determinista para las mismas entradas', () => {
    const a = transcriptoHandshake('relayPub', 'clientPub', 'token');
    const b = transcriptoHandshake('relayPub', 'clientPub', 'token');
    expect(hex(a)).toBe(hex(b));
  });

  it('cambia si cambia CUALQUIER campo (liga las dos publicas y el token)', () => {
    const base = hex(transcriptoHandshake('R', 'C', 'T'));
    expect(hex(transcriptoHandshake('R2', 'C', 'T'))).not.toBe(base);
    expect(hex(transcriptoHandshake('R', 'C2', 'T'))).not.toBe(base);
    expect(hex(transcriptoHandshake('R', 'C', 'T2'))).not.toBe(base);
  });

  it('el prefijo de longitud evita ambiguedad entre campos (no hay corrimiento que colisione)', () => {
    // Sin prefijo de longitud, "ab"+"c" y "a"+"bc" concatenarian igual. Con prefijo, difieren.
    expect(hex(transcriptoHandshake('ab', 'c', 'T'))).not.toBe(hex(transcriptoHandshake('a', 'bc', 'T')));
  });
});

describe('mensajeMacHandshake', () => {
  it('antepone el byte de rol y separa cliente de relay bajo el mismo transcript', () => {
    const cliente = mensajeMacHandshake(MAC_ROLE_CLIENTE, 'R', 'C', 'T');
    const relay = mensajeMacHandshake(MAC_ROLE_RELAY, 'R', 'C', 'T');
    expect(cliente[0]).toBe(MAC_ROLE_CLIENTE);
    expect(relay[0]).toBe(MAC_ROLE_RELAY);
    expect(hex(cliente)).not.toBe(hex(relay));
    // El resto (tras el byte de rol) es el mismo transcript.
    expect(hex(cliente.subarray(1))).toBe(hex(transcriptoHandshake('R', 'C', 'T')));
  });
});
