// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { crearServidorRelay } from '../src/server.js';
import { PorteroPreAuth } from '../src/preauth.js';
import { AutoridadEnMemoria } from '../src/autoridad.js';
import { LimitadorRelay } from '../src/rate-limit.js';
import { createLogger } from '../src/logger.js';
import type { ServidorRelay } from '../src/server.js';

const SECRET = 'r'.repeat(48);

describe('PorteroPreAuth (B-2): topes de handshakes en vuelo', () => {
  it('admite hasta el cap GLOBAL y luego rechaza con motivo cap_global', () => {
    const portero = new PorteroPreAuth({ maxGlobal: 2, maxPorIp: 100 });
    expect(portero.admitir('1.1.1.1')).toEqual({ ok: true });
    expect(portero.admitir('2.2.2.2')).toEqual({ ok: true });
    // Un tercero (otra IP, asi el cap por IP no interviene) supera el cap global.
    expect(portero.admitir('3.3.3.3')).toEqual({ ok: false, motivo: 'cap_global' });
    expect(portero.enVueloTotal).toBe(2);
  });

  it('admite hasta el cap POR IP y luego rechaza con motivo cap_ip (sin tocar el global)', () => {
    const portero = new PorteroPreAuth({ maxGlobal: 100, maxPorIp: 2 });
    expect(portero.admitir('9.9.9.9')).toEqual({ ok: true });
    expect(portero.admitir('9.9.9.9')).toEqual({ ok: true });
    expect(portero.admitir('9.9.9.9')).toEqual({ ok: false, motivo: 'cap_ip' });
    // Otra IP sigue teniendo lugar: el cap por IP no castiga a terceros.
    expect(portero.admitir('8.8.8.8')).toEqual({ ok: true });
  });

  it('liberar devuelve el cupo (global y por IP) para admitir de nuevo', () => {
    const portero = new PorteroPreAuth({ maxGlobal: 1, maxPorIp: 1 });
    expect(portero.admitir('7.7.7.7')).toEqual({ ok: true });
    expect(portero.admitir('7.7.7.7')).toEqual({ ok: false, motivo: 'cap_global' });
    portero.liberar('7.7.7.7');
    expect(portero.enVueloTotal).toBe(0);
    expect(portero.admitir('7.7.7.7')).toEqual({ ok: true });
  });

  it('liberar de mas no baja los contadores por debajo de cero', () => {
    const portero = new PorteroPreAuth({ maxGlobal: 2, maxPorIp: 2 });
    portero.liberar('0.0.0.0');
    expect(portero.enVueloTotal).toBe(0);
    expect(portero.admitir('0.0.0.0')).toEqual({ ok: true });
  });
});

// ---- Integracion sobre el servidor real: el rechazo ocurre ANTES de generar el par de llaves ----

let vivo: { srv: ServidorRelay; url: string; clientes: WebSocket[] } | null = null;

afterEach(async () => {
  if (vivo === null) return;
  for (const ws of vivo.clientes) ws.terminate();
  await new Promise<void>((resolve) => vivo?.srv.server.close(() => resolve()));
  vivo = null;
});

/** Levanta el servidor real con un portero de topes chicos y devuelve su URL ws. */
async function levantar(portero: PorteroPreAuth): Promise<{ srv: ServidorRelay; url: string }> {
  const srv = crearServidorRelay({
    relayTokenSecret: SECRET,
    allowedOrigins: '*', // el cliente ws no manda Origin; '*' deja pasar el chequeo de origen
    autoridad: new AutoridadEnMemoria(),
    limitador: new LimitadorRelay(),
    logger: createLogger('silent'),
    // Nunca se alcanzan: los clientes de prueba no completan el handshake.
    resolverConnectUrl: async () => 'wss://no.se.usa',
    crearCdp: async () => {
      throw new Error('no deberia crearse CDP en esta prueba');
    },
    portero,
  });
  const url = await new Promise<string>((resolve) => {
    srv.server.listen(0, '127.0.0.1', () => {
      const dir = srv.server.address();
      if (dir === null || typeof dir === 'string') throw new Error('sin puerto');
      resolve(`ws://127.0.0.1:${dir.port}`);
    });
  });
  return { srv, url };
}

/**
 * Abre un cliente ws y resuelve en cuanto sabe el resultado: 'srv_hello' si el relay ACEPTO el upgrade
 * (solo se envia tras generar el par de llaves), o 'rechazado' si el socket se corto antes (el upgrade no
 * se completo, no hubo par de llaves ni sesion). Deja el socket ABIERTO para retener el cupo pre-auth.
 */
function abrir(url: string, ip: string, clientes: WebSocket[]): Promise<'srv_hello' | 'rechazado'> {
  const ws = new WebSocket(url, { headers: { 'x-forwarded-for': ip } });
  clientes.push(ws);
  return new Promise((resolve) => {
    let resuelto = false;
    const fin = (r: 'srv_hello' | 'rechazado'): void => {
      if (!resuelto) {
        resuelto = true;
        resolve(r);
      }
    };
    ws.on('message', (data) => {
      try {
        const obj = JSON.parse(data.toString()) as { t?: unknown };
        if (obj.t === 'srv_hello') fin('srv_hello');
      } catch {
        // ignorar
      }
    });
    ws.on('error', () => fin('rechazado'));
    ws.on('close', () => fin('rechazado'));
  });
}

describe('B-2 sobre el servidor real: el cap rechaza ANTES de generar llaves', () => {
  it('cap GLOBAL: superarlo rechaza el upgrade sin crear sesion (sin srv_hello)', async () => {
    const portero = new PorteroPreAuth({ maxGlobal: 2, maxPorIp: 100 });
    const { srv, url } = await levantar(portero);
    const clientes: WebSocket[] = [];
    vivo = { srv, url, clientes };

    // Dos handshakes distintos (IPs distintas) son admitidos y reciben srv_hello (hubo par de llaves).
    expect(await abrir(url, '1.1.1.1', clientes)).toBe('srv_hello');
    expect(await abrir(url, '2.2.2.2', clientes)).toBe('srv_hello');
    // El tercero supera el cap global: se corta ANTES de completar el upgrade -> nunca hay srv_hello.
    expect(await abrir(url, '3.3.3.3', clientes)).toBe('rechazado');

    // No se creo sesion para el rechazado (una sesion SIEMPRE genera par de llaves y envia srv_hello).
    expect(srv.sesiones.size).toBe(2);
    expect(portero.enVueloTotal).toBe(2);
  });

  it('cap POR IP: superarlo rechaza, pero otra IP (usuario legitimo) sigue pasando', async () => {
    const portero = new PorteroPreAuth({ maxGlobal: 100, maxPorIp: 2 });
    const { srv, url } = await levantar(portero);
    const clientes: WebSocket[] = [];
    vivo = { srv, url, clientes };

    // Dos handshakes desde la MISMA IP son admitidos.
    expect(await abrir(url, '9.9.9.9', clientes)).toBe('srv_hello');
    expect(await abrir(url, '9.9.9.9', clientes)).toBe('srv_hello');
    // El tercero desde esa misma IP supera el cap por IP: rechazado sin srv_hello.
    expect(await abrir(url, '9.9.9.9', clientes)).toBe('rechazado');
    // Una IP DISTINTA (otro usuario) no se ve afectada: el flujo legitimo pasa.
    expect(await abrir(url, '8.8.8.8', clientes)).toBe('srv_hello');

    expect(srv.sesiones.size).toBe(3);
  });
});
