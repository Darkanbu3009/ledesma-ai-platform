// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import net from 'node:net';
import { WebSocket } from 'ws';
import { crearServidorRelay, ipCliente } from '../src/server.js';
import { PorteroPreAuth } from '../src/preauth.js';
import { AutoridadEnMemoria } from '../src/autoridad.js';
import { LimitadorRelay } from '../src/rate-limit.js';
import { createLogger } from '../src/logger.js';
import type { ServidorRelay } from '../src/server.js';
import type { IncomingMessage } from 'node:http';

const SECRET = 'r'.repeat(48);

let vivo: { srv: ServidorRelay; puerto: number; clientes: WebSocket[] } | null = null;

afterEach(async () => {
  if (vivo === null) return;
  for (const ws of vivo.clientes) ws.terminate();
  await new Promise<void>((resolve) => vivo?.srv.server.close(() => resolve()));
  vivo = null;
});

/** Levanta el servidor real con un portero inyectado. Devuelve el puerto para ws:// y http://. */
async function levantar(portero: PorteroPreAuth): Promise<{ srv: ServidorRelay; puerto: number }> {
  const srv = crearServidorRelay({
    relayTokenSecret: SECRET,
    allowedOrigins: '*',
    autoridad: new AutoridadEnMemoria(),
    limitador: new LimitadorRelay(),
    logger: createLogger('silent'),
    resolverConnectUrl: async () => 'wss://no.se.usa',
    crearCdp: async () => {
      throw new Error('no deberia crearse CDP en esta prueba');
    },
    portero,
  });
  const puerto = await new Promise<number>((resolve) => {
    srv.server.listen(0, '127.0.0.1', () => {
      const dir = srv.server.address();
      if (dir === null || typeof dir === 'string') throw new Error('sin puerto');
      resolve(dir.port);
    });
  });
  return { srv, puerto };
}

/**
 * Envia un handshake WebSocket MALFORMADO por un socket TCP crudo: `Sec-WebSocket-Version: 99` hace que
 * ws@8 ABORTE dentro de handleUpgrade SIN llamar al callback (no se crea sesion). El server dispara el
 * evento 'upgrade' (hay Connection/Upgrade), reserva el cupo pre-auth y recien despues handleUpgrade aborta:
 * ese es el escenario NEW-1. Resuelve cuando el socket se cierra (el server respondio 400 y lo termino).
 */
function handshakeMalformado(puerto: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const sock = net.connect(puerto, '127.0.0.1', () => {
      sock.write(
        'GET / HTTP/1.1\r\n' +
          'Host: 127.0.0.1\r\n' +
          'Connection: Upgrade\r\n' +
          'Upgrade: websocket\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          'Sec-WebSocket-Version: 99\r\n' +
          '\r\n',
      );
    });
    // Consumir la respuesta 400 (flowing mode) para que el socket alcance EOF y emita 'close': sin esto
    // quedaria pausado con la respuesta sin leer y el 'close' no llegaria.
    sock.resume();
    sock.on('error', () => resolve());
    sock.on('close', () => resolve());
  });
}

/** Abre un cliente ws legitimo y resuelve 'srv_hello' si el relay acepto el upgrade, o 'rechazado' si no. */
function abrirLegitimo(puerto: number, clientes: WebSocket[]): Promise<'srv_hello' | 'rechazado'> {
  const ws = new WebSocket(`ws://127.0.0.1:${puerto}`);
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

describe('NEW-1: un handshake que ABORTA en handleUpgrade NO fuga el cupo pre-auth', () => {
  it('tras N handshakes malformados, el cupo vuelve a 0 y un cliente legitimo SIGUE siendo admitido', async () => {
    // Cap global chico: si cada handshake malformado fugara su cupo, con 4 ya se agota y el legitimo seria
    // rechazado. maxPorIp holgado para no interferir (todos vienen de 127.0.0.1).
    const portero = new PorteroPreAuth({ maxGlobal: 4, maxPorIp: 100 });
    const { srv, puerto } = await levantar(portero);
    const clientes: WebSocket[] = [];
    vivo = { srv, puerto, clientes };

    // N = maxGlobal handshakes malformados que abortan sin crear sesion.
    for (let i = 0; i < 4; i += 1) {
      await handshakeMalformado(puerto);
    }

    // El cupo se libero en TODOS: sin la correccion quedaria en 4 para siempre. Se espera a que el evento
    // 'close' del socket crudo del server ejecute el respaldo de liberacion.
    await vi.waitFor(() => expect(portero.enVueloTotal).toBe(0));
    expect(srv.sesiones.size).toBe(0); // ninguna sesion se creo por los malformados

    // Un cliente legitimo es admitido (recibe srv_hello): el cupo NO quedo agotado por la fuga.
    expect(await abrirLegitimo(puerto, clientes)).toBe('srv_hello');
  });

  it('un handshake legitimo que se cierra sin autenticar tambien libera su cupo (respaldo del socket)', async () => {
    const portero = new PorteroPreAuth({ maxGlobal: 2, maxPorIp: 100 });
    const { srv, puerto } = await levantar(portero);
    const clientes: WebSocket[] = [];
    vivo = { srv, puerto, clientes };

    // Abre y cierra de inmediato: la sesion se crea y se cierra sin autenticar; el cupo se libera.
    expect(await abrirLegitimo(puerto, clientes)).toBe('srv_hello');
    clientes[0]?.close();
    await vi.waitFor(() => expect(portero.enVueloTotal).toBe(0));
  });
});

describe('NEW-1: el health check refleja el estado real (falla si no puede aceptar handshakes)', () => {
  it('GET /health responde 503 con el cupo global saturado, y 200 cuando hay lugar', async () => {
    const portero = new PorteroPreAuth({ maxGlobal: 1, maxPorIp: 100 });
    const { srv, puerto } = await levantar(portero);
    vivo = { srv, puerto, clientes: [] };

    // Con lugar: 200.
    const ok = await fetch(`http://127.0.0.1:${puerto}/health`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('ok');

    // Saturar el cupo global (sin liberar): el relay no puede aceptar handshakes -> /health debe fallar.
    portero.admitir('1.2.3.4');
    expect(portero.saturadoGlobal).toBe(true);
    const saturado = await fetch(`http://127.0.0.1:${puerto}/health`);
    expect(saturado.status).toBe(503);

    // Al liberar, vuelve a 200 (la plataforma no reinicia de mas).
    portero.liberar('1.2.3.4');
    const recuperado = await fetch(`http://127.0.0.1:${puerto}/health`);
    expect(recuperado.status).toBe(200);
  });
});

describe('NEW-3: ipCliente prefiere una cabecera mas confiable y cae a X-Forwarded-For', () => {
  const conHeaders = (headers: Record<string, string | string[]>): IncomingMessage =>
    ({ headers, socket: { remoteAddress: '10.0.0.1' } }) as unknown as IncomingMessage;

  it('usa x-envoy-external-address cuando esta presente', () => {
    expect(ipCliente(conHeaders({ 'x-envoy-external-address': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }))).toBe(
      '203.0.113.7',
    );
  });

  it('cae al primer X-Forwarded-For si no hay cabecera de envoy', () => {
    expect(ipCliente(conHeaders({ 'x-forwarded-for': '198.51.100.9, 10.0.0.2' }))).toBe('198.51.100.9');
  });

  it('cae a la IP del socket si no hay ninguna cabecera', () => {
    expect(ipCliente(conHeaders({}))).toBe('10.0.0.1');
  });
});
