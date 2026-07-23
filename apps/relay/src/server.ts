import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { SesionRelay, type CdpInyector, type SocketRelay } from './session.js';
import type { AutoridadRelay } from './autoridad.js';
import type { LimitadorRelay } from './rate-limit.js';
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

export function crearServidorRelay(deps: DepsServidor): ServidorRelay {
  const sesiones = new Set<SesionRelay>();
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
    wss.handleUpgrade(req, socket, head, (ws) => {
      conectar(ws, origen ?? null, deps, sesiones);
    });
  });

  return { server, sesiones };
}

function conectar(
  ws: WebSocket,
  origen: string | null,
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
