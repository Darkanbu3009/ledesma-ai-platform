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

describe('NEW-4: purga de registros vencidos (acota jti Y locks por conexion)', () => {
  it('purgarVencidos elimina lo vencido y respeta lo vigente', async () => {
    let ahora = 1000;
    const a = new AutoridadEnMemoria(() => ahora);
    // Se insertan todos VIGENTES (para no gatillar la purga perezosa del consumo); luego avanza el reloj.
    await a.consumirJti('jti-corto', 1200);
    await a.consumirJti('jti-largo', 5000);
    await a.tomarConexion('con-corta', 'n1', 1300);
    await a.tomarConexion('con-larga', 'n2', 5000);
    expect(a.jtiRetenidos).toBe(2);
    expect(a.conexionesRetenidas).toBe(2);

    ahora = 2000; // jti-corto (1200) y con-corta (1300) vencieron; los largos siguen vigentes
    a.purgarVencidos();

    // Solo quedan los vigentes: la purga elimina los vencidos de AMBAS tablas.
    expect(a.jtiRetenidos).toBe(1);
    expect(a.conexionesRetenidas).toBe(1);
    // Lo vencido se puede volver a consumir/tomar (ya no ocupa lugar).
    expect(await a.consumirJti('jti-corto', 5000)).toBe(true);
    expect(await a.tomarConexion('con-corta', 'n3', 5000)).toBe(true);
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

  it('NEW-2: el MISMO nonce RENUEVA su lease aun sin vencer; otro nonce sigue bloqueado', async () => {
    let ahora = 1000;
    const a = new AutoridadEnMemoria(() => ahora);
    expect(await a.tomarConexion('con-1', 'nonce-A', 1030)).toBe(true); // lease corto: vence en 1030
    ahora = 1020; // aun vigente
    // El dueno renueva (extiende a 1050) con el mismo nonce; otra sesion no puede entrar.
    expect(await a.tomarConexion('con-1', 'nonce-A', 1050)).toBe(true);
    expect(await a.tomarConexion('con-1', 'nonce-B', 9999)).toBe(false);
    ahora = 1040; // dentro del lease renovado (1050): sigue bloqueado para otros
    expect(await a.tomarConexion('con-1', 'nonce-B', 9999)).toBe(false);
  });

  it('NEW-2: un lock HUERFANO con lease corto se retoma en SEGUNDOS (no espera el exp del token)', async () => {
    let ahora = 1000;
    const a = new AutoridadEnMemoria(() => ahora);
    // La sesion A toma el lock con un lease corto (30s) y MUERE sin liberarlo (huerfano): p.ej. consumir-jti
    // fallo y la liberacion best-effort tambien. Con el exp del token (hasta 15 min) quedaria trabado; con
    // el lease corto se libera solo en 30s.
    expect(await a.tomarConexion('con-1', 'nonce-A', ahora + 30)).toBe(true);
    ahora += 20; // reintento temprano del usuario: el lease sigue vigente
    expect(await a.tomarConexion('con-1', 'nonce-B', ahora + 30)).toBe(false);
    ahora += 15; // pasaron 35s desde la toma: el lease huerfano vencio
    expect(await a.tomarConexion('con-1', 'nonce-B', ahora + 30)).toBe(true);
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
