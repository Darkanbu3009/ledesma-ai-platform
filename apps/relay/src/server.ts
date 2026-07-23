import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { SesionRelay, type CdpInyector, type SocketRelay } from './session.js';
import type { AutoridadRelay } from './autoridad.js';
import type { LimitadorRelay } from './rate-limit.js';
import { PorteroPreAuth } from './preauth.js';
import type { Logger } from './logger.js';

/**
 * Servidor del relay: un http.Server crudo con un UNICO proposito, el upgrade WebSocket del relay. NO
 * hay rutas HTTP de aplicacion (solo un /health de liveness para el despliegue), NO se usa Fastify ni
 * pino: los frames WebSocket jamas tocan un logger de plataforma, por diseno. El Origin del upgrade se
 * valida contra una allowlist antes de aceptar; el token efimero (dentro del canal) es la autenticacion
 * real. Todo lo demas lo maneja SesionRelay.
 */

export interface DepsServidor {
  relayTokenSecret: string;
  allowedOrigins: '*' | string[];
  autoridad: AutoridadRelay;
  limitador: LimitadorRelay;
  logger: Logger;
  resolverConnectUrl(sesionExternaId: string): Promise<string>;
  crearCdp(connectUrl: string): Promise<CdpInyector>;
  /** Portero pre-auth (B-2). Opcional: si falta se crea uno con los defaults holgados. Inyectable en tests. */
  portero?: PorteroPreAuth;
}

export interface ServidorRelay {
  server: Server;
  /** Sesiones vivas, para cerrarlas en el apagado. */
  sesiones: Set<SesionRelay>;
}

export function origenPermitido(origen: string | undefined, permitidos: '*' | string[]): boolean {
  if (permitidos === '*') return true;
  return typeof origen === 'string' && permitidos.includes(origen);
}

/**
 * IP del cliente para el cupo pre-auth por IP (B-2). Detras del proxy de borde de Railway (que termina
 * TLS) la IP del socket es la del proxy, comun a TODOS los clientes; el cliente real llega en el primer
 * valor de X-Forwarded-For. Se usa ese valor (aunque sea falsificable: por eso el cap por IP es defensa
 * en profundidad y el cap global la garantia) para no agrupar a todos los moviles bajo una sola clave.
 */
export function ipCliente(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  const crudo = Array.isArray(xff) ? xff[0] : xff;
  if (typeof crudo === 'string') {
    const primero = crudo.split(',')[0]?.trim();
    if (primero !== undefined && primero.length > 0) return primero;
  }
  return req.socket.remoteAddress ?? 'desconocida';
}

export function crearServidorRelay(deps: DepsServidor): ServidorRelay {
  const sesiones = new Set<SesionRelay>();
  const portero = deps.portero ?? new PorteroPreAuth();
  // maxPayload acota el tamano de CADA frame: un handshake y una pulsacion son pequenos; un techo bajo
  // frena que un cliente hostil agote memoria con un frame gigante. 16 KiB es holgado para el token.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  const server = createServer((req, res) => {
    // SIN rutas de aplicacion: solo liveness para el health check del despliegue (Railway).
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const origen = req.headers.origin;
    if (!origenPermitido(origen, deps.allowedOrigins)) {
      deps.logger.warn('relay_upgrade_rechazado', { motivo: 'origen', origen: origen ?? null });
      socket.destroy();
      return;
    }
    // B-2: acotar los handshakes EN VUELO ANTES de completar el upgrade y de generar el par de llaves.
    // Un rechazo aqui NO abre WebSocket ni crea sesion: no cuesta un par X25519 ni retiene memoria.
    const ip = ipCliente(req);
    const admision = portero.admitir(ip);
    if (!admision.ok) {
      deps.logger.warn('relay_upgrade_rechazado', { motivo: admision.motivo });
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      conectar(ws, origen ?? null, ip, portero, deps, sesiones);
    });
  });

  return { server, sesiones };
}

function conectar(
  ws: WebSocket,
  origen: string | null,
  ip: string,
  portero: PorteroPreAuth,
  deps: DepsServidor,
  sesiones: Set<SesionRelay>,
): void {
  const socket: SocketRelay = {
    enviar: (texto) => ws.send(texto),
    cerrar: () => ws.close(),
  };
  const sesion = new SesionRelay({
    socket,
    origen,
    relayTokenSecret: deps.relayTokenSecret,
    autoridad: deps.autoridad,
    limitador: deps.limitador,
    logger: deps.logger,
    resolverConnectUrl: deps.resolverConnectUrl,
    crearCdp: deps.crearCdp,
    // El cupo pre-auth se libera cuando la sesion autentica o cierra (lo que ocurra primero): la propia
    // sesion garantiza que se llame UNA sola vez.
    liberarPreAuth: () => portero.liberar(ip),
  });
  sesiones.add(sesion);
  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      sesion.cerrar('protocolo');
      return;
    }
    sesion.recibir(data.toString());
  });
  ws.on('close', () => {
    sesion.alCerrarSocket();
    sesiones.delete(sesion);
  });
  ws.on('error', () => {
    sesion.cerrar('socket_error');
    sesiones.delete(sesion);
  });
  sesion.iniciar();
}
