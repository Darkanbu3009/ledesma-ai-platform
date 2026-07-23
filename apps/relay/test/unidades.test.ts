// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { RegistroUsoUnico } from '../src/single-use.js';
import { LimitadorRelay } from '../src/rate-limit.js';
import { origenPermitido } from '../src/server.js';

describe('RegistroUsoUnico', () => {
  it('consume una vez y rechaza el reuso', () => {
    const r = new RegistroUsoUnico();
    expect(r.consumir('jti-1', 2000, 1000)).toBe(true);
    expect(r.consumir('jti-1', 2000, 1000)).toBe(false);
  });

  it('purga los jti vencidos (acota la memoria)', () => {
    const r = new RegistroUsoUnico();
    r.consumir('jti-1', 1500, 1000);
    expect(r.tamano).toBe(1);
    // un consumo posterior con reloj mas alla del exp purga el vencido
    r.consumir('jti-2', 3000, 2000);
    expect(r.tamano).toBe(1);
    // jti-1 ya no esta: se puede volver a consumir (aunque el token ya no verificaria)
    expect(r.consumir('jti-1', 4000, 2000)).toBe(true);
  });
});

describe('LimitadorRelay', () => {
  it('una sola sesion por conexion a la vez', () => {
    const l = new LimitadorRelay();
    expect(l.intentar('o', 'c1', 0)).toEqual({ ok: true });
    expect(l.intentar('o', 'c1', 0)).toEqual({ ok: false, motivo: 'conexion_ocupada' });
    l.liberar('o', 'c1');
    expect(l.intentar('o', 'c1', 0)).toEqual({ ok: true });
  });

  it('techo de concurrencia por owner', () => {
    const l = new LimitadorRelay({ maxPorOwner: 2, maxNuevasPorVentana: 100 });
    expect(l.intentar('o', 'c1', 0).ok).toBe(true);
    expect(l.intentar('o', 'c2', 0).ok).toBe(true);
    expect(l.intentar('o', 'c3', 0)).toEqual({ ok: false, motivo: 'concurrencia_owner' });
  });

  it('anti flood: techo de sesiones nuevas por ventana', () => {
    const l = new LimitadorRelay({ maxPorOwner: 100, maxNuevasPorVentana: 2, ventanaMs: 1000 });
    expect(l.intentar('o', 'c1', 0).ok).toBe(true);
    l.liberar('o', 'c1');
    expect(l.intentar('o', 'c2', 100).ok).toBe(true);
    l.liberar('o', 'c2');
    expect(l.intentar('o', 'c3', 200)).toEqual({ ok: false, motivo: 'flood' });
    // pasada la ventana, vuelve a admitir
    expect(l.intentar('o', 'c4', 1300).ok).toBe(true);
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
