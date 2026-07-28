import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { hashIp } from '../src/privacy/ip-hash.js';

const SESSION = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const DEDICADO = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

const soloSesion = { SESSION_TOKEN_SECRET: SESSION };
const conDedicado = { SESSION_TOKEN_SECRET: SESSION, CONSENT_IP_HASH_SECRET: DEDICADO };

describe('privacy/ip-hash', () => {
  it('devuelve un HMAC-SHA256 en hex (64 chars) y JAMAS la IP', () => {
    const hash = hashIp('203.0.113.7', soloSesion);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('203.0.113.7');
  });

  it('es DETERMINISTA: la misma IP y el mismo secreto dan el mismo valor (permite correlacionar)', () => {
    expect(hashIp('203.0.113.7', soloSesion)).toBe(hashIp('203.0.113.7', soloSesion));
  });

  it('IPs distintas dan hashes distintos', () => {
    expect(hashIp('203.0.113.7', soloSesion)).not.toBe(hashIp('203.0.113.8', soloSesion));
  });

  it('usa el secreto DEDICADO cuando esta configurado, y rotarlo cambia el hash', () => {
    const conSesion = hashIp('203.0.113.7', soloSesion);
    const conPropio = hashIp('203.0.113.7', conDedicado);
    expect(conPropio).not.toBe(conSesion);
    // Rotar el secreto dedicado invalida la correlacion previa, que es lo esperado de un seudonimo.
    const rotado = hashIp('203.0.113.7', {
      SESSION_TOKEN_SECRET: SESSION,
      CONSENT_IP_HASH_SECRET: `${DEDICADO}-rotado`,
    });
    expect(rotado).not.toBe(conPropio);
  });

  it('SEPARACION DE DOMINIO: no coincide con el HMAC crudo del mismo secreto sobre la IP', () => {
    // Si el prefijo de dominio faltara, el digest de este uso podria colisionar con otro uso del mismo
    // secreto compartido. Este test falla si alguien lo quita.
    const crudo = createHmac('sha256', SESSION).update('203.0.113.7').digest('hex');
    expect(hashIp('203.0.113.7', soloSesion)).not.toBe(crudo);
  });

  it('sin IP (null, undefined o cadena vacia) -> null, no un hash de la cadena vacia', () => {
    expect(hashIp(null, soloSesion)).toBeNull();
    expect(hashIp(undefined, soloSesion)).toBeNull();
    expect(hashIp('   ', soloSesion)).toBeNull();
  });
});
