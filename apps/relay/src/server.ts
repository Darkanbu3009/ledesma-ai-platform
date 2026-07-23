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
 * IP del cliente para el cupo pre-auth POR IP (B-2). Es una clave BEST-EFFORT (NEW-3): detras del proxy de
 * borde de Railway (que termina TLS) la IP del socket es la del proxy, comun a TODOS los clientes, asi que
 * hay que confiar en una cabecera. Railway da guias CONTRADICTORIAS sobre cual usar (a veces "strip +
 * primer X-Forwarded-For", a veces "append + ultimo valor"), asi que NINGUNA es no-falsificable con
 * certeza. Se prefiere `x-envoy-external-address` -un valor UNICO que fija Envoy, no una lista que el
 * cliente arma- y si falta se cae al primer X-Forwarded-For (comportamiento previo). En NINGUN caso esto es
 * peor que antes; y como puede ser evadible, el cap por IP es defensa en profundidad y la GARANTIA es el
 * cap GLOBAL. Nunca se agrupa por la IP del socket: seria una sola clave para todos los moviles detras del
 * proxy/CGNAT y castigaria el flujo legitimo.
 */
export function ipCliente(req: IncomingMessage): string {
  const envoy = req.headers['x-envoy-external-address'];
  const envoyIp = Array.isArray(envoy) ? envoy[0] : envoy;
  if (typeof envoyIp === 'string' && envoyIp.trim().length > 0) return envoyIp.trim();
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
      // NEW-1: el health refleja el ESTADO REAL. Si el cupo global esta agotado el relay no puede aceptar
      // NINGUN handshake nuevo: responde 503 para que la plataforma reinicie en vez de quedar colgado
      // respondiendo 200. Con la fuga de cupo corregida esto solo se sostiene ante una anomalia (una fuga
      // desconocida o un flood), no ante la operacion normal, donde el cupo siempre se libera.
      if (portero.saturadoGlobal) {
        res.writeHead(503, { 'content-type': 'text/plain' });
        res.end('saturado');
        return;
      }
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
    // NEW-1: el cupo se libera en TODA ruta de salida. `liberar` es idempotente (una sola baja del cupo por
    // cada admitir). Se engancha al SOCKET CRUDO (close/error) como respaldo: si `handleUpgrade` ABORTA sin
    // llamar al callback (handshake WebSocket malformado, p.ej. `Sec-WebSocket-Version: 99`), no se crea
    // sesion y el UNICO evento que ocurre es el cierre del socket. Asi es imposible que un cupo quede
    // reservado sin una sesion viva que lo respalde: si hay sesion, ella lo libera (al autenticar o cerrar)
    // y este respaldo es un no-op idempotente; si NO hay sesion, lo libera el cierre del socket.
    let liberado = false;
    const liberar = (): void => {
      if (liberado) return;
      liberado = true;
      portero.liberar(ip);
    };
    socket.once('close', liberar);
    socket.once('error', liberar);
    wss.handleUpgrade(req, socket, head, (ws) => {
      conectar(ws, origen ?? null, liberar, deps, sesiones);
    });
  });

  return { server, sesiones };
}

function conectar(
  ws: WebSocket,
  origen: string | null,
  liberarPreAuth: () => void,
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
    // El cupo pre-auth se libera cuando la sesion autentica o cierra (lo que ocurra primero). `liberar` es
    // idempotente (compartido con el respaldo del socket crudo), asi que llamarlo varias veces es seguro.
    liberarPreAuth,
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
