// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { AutoridadEnMemoria } from '../src/autoridad.js';
import { LimitadorRelay } from '../src/rate-limit.js';
import { origenPermitido } from '../src/server.js';

describe('AutoridadEnMemoria: uso unico del jti', () => {
  it('consume una vez y rechaza el reuso', async () => {
    const a = new AutoridadEnMemoria(() => 1000);
    expect(await a.consumirJti('jti-1', 2000)).toBe(true);
    expect(await a.consumirJti('jti-1', 2000)).toBe(false);
  });

  it('purga los jti vencidos (acota la memoria)', async () => {
    let ahora = 1000;
    const a = new AutoridadEnMemoria(() => ahora);
    await a.consumirJti('jti-1', 1500);
    expect(a.jtiRetenidos).toBe(1);
    ahora = 2000; // mas alla del exp de jti-1
    await a.consumirJti('jti-2', 3000); // purga el vencido en el intento
    expect(a.jtiRetenidos).toBe(1);
    // jti-1 ya no esta: se puede volver a consumir (aunque el token ya no verificaria)
    expect(await a.consumirJti('jti-1', 4000)).toBe(true);
  });
});

describe('AutoridadEnMemoria: lock por conexion', () => {
  it('un solo canal por conexion a la vez; libera solo con el nonce correcto', async () => {
    const a = new AutoridadEnMemoria(() => 1000);
    expect(await a.tomarConexion('con-1', 'nonce-A', 5000)).toBe(true);
    // Vigente y tomado: otra sesion no lo toma.
    expect(await a.tomarConexion('con-1', 'nonce-B', 5000)).toBe(false);
    // Liberar con un nonce ajeno no hace nada.
    await a.liberarConexion('con-1', 'nonce-ajeno');
    expect(await a.tomarConexion('con-1', 'nonce-B', 5000)).toBe(false);
    // Liberar con el nonce correcto libera el lock.
    await a.liberarConexion('con-1', 'nonce-A');
    expect(await a.tomarConexion('con-1', 'nonce-B', 5000)).toBe(true);
  });

  it('un lock VENCIDO se puede retomar (auto-liberacion ante crash del relay)', async () => {
    let ahora = 1000;
    const a = new AutoridadEnMemoria(() => ahora);
    expect(await a.tomarConexion('con-1', 'nonce-A', 2000)).toBe(true);
    ahora = 2500; // el lock de nonce-A vencio (exp 2000)
    expect(await a.tomarConexion('con-1', 'nonce-B', 5000)).toBe(true);
  });
});

describe('LimitadorRelay (best-effort por instancia)', () => {
  it('techo de concurrencia por owner', () => {
    const l = new LimitadorRelay({ maxPorOwner: 2, maxNuevasPorVentana: 100 });
    expect(l.intentar('o', 0).ok).toBe(true);
    expect(l.intentar('o', 0).ok).toBe(true);
    expect(l.intentar('o', 0)).toEqual({ ok: false, motivo: 'concurrencia_owner' });
    l.liberar('o');
    expect(l.intentar('o', 0).ok).toBe(true);
  });

  it('anti flood: techo de sesiones nuevas por ventana', () => {
    const l = new LimitadorRelay({ maxPorOwner: 100, maxNuevasPorVentana: 2, ventanaMs: 1000 });
    expect(l.intentar('o', 0).ok).toBe(true);
    l.liberar('o');
    expect(l.intentar('o', 100).ok).toBe(true);
    l.liberar('o');
    expect(l.intentar('o', 200)).toEqual({ ok: false, motivo: 'flood' });
    // pasada la ventana, vuelve a admitir
    expect(l.intentar('o', 1300).ok).toBe(true);
  });
});

describe('origenPermitido', () => {
  it("'*' permite cualquiera; una lista solo los suyos", () => {
    expect(origenPermitido('https://cualquiera', '*')).toBe(true);
    expect(origenPermitido(undefined, '*')).toBe(true);
    expect(origenPermitido('https://app.ledesma', ['https://app.ledesma'])).toBe(true);
    expect(origenPermitido('https://malicioso', ['https://app.ledesma'])).toBe(false);
    expect(origenPermitido(undefined, ['https://app.ledesma'])).toBe(false);
  });
});
