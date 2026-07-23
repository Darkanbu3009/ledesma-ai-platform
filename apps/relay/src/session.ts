import { randomUUID } from 'node:crypto';
import { verifyRelayToken } from '@ledesma-platform/shared/relay-token';
import { decodificarPulsacion, type TeclaControl } from '@ledesma-platform/shared/relay-protocol';
import { generarParEfimero, derivarClaveSesion } from './handshake.js';
import { descifrarFrame } from './frames.js';
import type { RegistroUsoUnico } from './single-use.js';
import type { LimitadorRelay } from './rate-limit.js';
import type { Logger } from './logger.js';

/**
 * SESION DE RELAY: la maquina de estados de UN canal (handshake -> ready -> pulsaciones -> cierre).
 * Concentra toda la logica sensible y esta INYECTADA por dependencias (socket, CDP, resolver de
 * connectUrl, reloj) para poder testearla entera sin red real.
 *
 * CERO PERSISTENCIA / CERO LOGS DE CONTENIDO: el texto plano de una pulsacion vive solo entre el
 * descifrado y el reenvio por CDP, en un Buffer que se sobreescribe (fill 0) tras reenviar. Nunca se
 * escribe a disco/base/cola, nunca se loguea (ni completo, ni truncado, ni su longitud), y los errores
 * son codigos genericos sin contenido. La auditoria (logger) recibe SOLO metadatos.
 */

/** El socket del cliente, visto por la sesion (lo cablea el servidor sobre el WebSocket real). */
export interface SocketRelay {
  enviar(texto: string): void;
  cerrar(): void;
}

/** Inyector CDP hacia la sesion de navegador viva (lo implementa ClienteCdp). */
export interface CdpInyector {
  attachAPagina(): Promise<string>;
  insertarTexto(texto: string, sessionId: string): Promise<void>;
  despacharTecla(tecla: TeclaControl, sessionId: string): Promise<void>;
  cerrar(): void;
}

export interface DepsSesion {
  socket: SocketRelay;
  /** Origen validado del upgrade (solo para auditoria de metadatos). */
  origen: string | null;
  relayTokenSecret: string;
  usoUnico: RegistroUsoUnico;
  limitador: LimitadorRelay;
  logger: Logger;
  resolverConnectUrl(sesionExternaId: string): Promise<string>;
  crearCdp(connectUrl: string): Promise<CdpInyector>;
  /** Reloj inyectable (ms). Default Date.now. */
  ahora?: () => number;
  handshakeTimeoutMs?: number;
  idleTimeoutMs?: number;
}

type Estado = 'hello' | 'estableciendo' | 'relevando' | 'cerrada';

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

export class SesionRelay {
  private readonly id = randomUUID();
  private estado: Estado = 'hello';
  private readonly par = generarParEfimero();
  private claveSesion: Buffer | null = null;
  private cdp: CdpInyector | null = null;
  private cdpSessionId: string | null = null;
  private ultimoContador = 0;
  private eventos = 0;
  private cupoReservado: { ownerId: string; connectionId: string } | null = null;
  private cola: Promise<void> = Promise.resolve();
  private readonly inicioMs: number;

  private temporizadorHandshake: ReturnType<typeof setTimeout> | null = null;
  private temporizadorIdle: ReturnType<typeof setTimeout> | null = null;
  private temporizadorExp: ReturnType<typeof setTimeout> | null = null;

  private readonly ahora: () => number;
  private readonly handshakeTimeoutMs: number;
  private readonly idleTimeoutMs: number;

  constructor(private readonly deps: DepsSesion) {
    this.ahora = deps.ahora ?? Date.now;
    this.handshakeTimeoutMs = deps.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.idleTimeoutMs = deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.inicioMs = this.ahora();
  }

  /** Envia el server_hello con la publica efimera del relay y arranca el timeout de handshake. */
  iniciar(): void {
    this.enviarControl({ t: 'srv_hello', v: 1, pub: this.par.publicKeyB64 });
    this.temporizadorHandshake = setTimeout(() => this.cerrar('handshake_timeout'), this.handshakeTimeoutMs);
  }

  /** Entrada de cada mensaje del cliente (texto del WebSocket). Nunca lanza al llamador. */
  recibir(data: string): void {
    if (this.estado === 'cerrada') return;
    let mensaje: unknown;
    try {
      mensaje = JSON.parse(data);
    } catch {
      this.rechazar('protocolo');
      return;
    }
    if (typeof mensaje !== 'object' || mensaje === null || typeof (mensaje as { t?: unknown }).t !== 'string') {
      this.rechazar('protocolo');
      return;
    }
    const tipo = (mensaje as { t: string }).t;
    if (this.estado === 'hello' && tipo === 'cli_hello') {
      this.manejarHello(mensaje as Record<string, unknown>);
      return;
    }
    if (this.estado === 'relevando' && tipo === 'k') {
      this.manejarFrame(mensaje as Record<string, unknown>);
      return;
    }
    // Mensaje inesperado para el estado actual (incluye frames durante 'estableciendo'): se corta.
    this.rechazar('protocolo');
  }

  /** El WebSocket se cerro (el usuario confirmo, cancelo, cerro el modal o cayo la red). */
  alCerrarSocket(): void {
    this.cerrar('socket_cerrado');
  }

  private manejarHello(mensaje: Record<string, unknown>): void {
    const pub = mensaje.pub;
    const token = mensaje.token;
    if (typeof pub !== 'string' || typeof token !== 'string') {
      this.rechazar('protocolo');
      return;
    }
    const claims = verifyRelayToken(token, this.deps.relayTokenSecret);
    if (claims === null) {
      this.rechazar('token_invalido');
      return;
    }
    // Rate limiting por owner y por sesion ANTES de reservar recursos.
    const intento = this.deps.limitador.intentar(claims.ownerId, claims.connectionId, this.ahora());
    if (!intento.ok) {
      this.rechazar('limite');
      return;
    }
    this.cupoReservado = { ownerId: claims.ownerId, connectionId: claims.connectionId };
    // Uso UNICO: un token, una sesion de relay. Reuso -> rechazo (y se libera el cupo recien tomado).
    if (!this.deps.usoUnico.consumir(claims.jti, claims.exp, Math.floor(this.ahora() / 1000))) {
      this.rechazar('reuso');
      return;
    }
    // Derivar la clave de sesion (ECDH X25519 + HKDF). Entrada invalida -> corte generico.
    try {
      this.claveSesion = derivarClaveSesion(this.par.privateKey, pub);
    } catch {
      this.rechazar('handshake');
      return;
    }

    this.estado = 'estableciendo';
    this.limpiarTemporizador('temporizadorHandshake');

    // El deadline duro del canal es la expiracion del token (alineada a esperando_login).
    const restanteMs = Math.max(0, claims.exp * 1000 - this.ahora());
    this.temporizadorExp = setTimeout(() => this.cerrar('token_expirado'), restanteMs);

    // Resolver el connectUrl y abrir CDP. sesionExternaId viene del token (no se toca la base).
    void this.establecerCdp(claims.sesionExternaId, claims.connectionId);
  }

  private async establecerCdp(sesionExternaId: string, connectionId: string): Promise<void> {
    try {
      const connectUrl = await this.deps.resolverConnectUrl(sesionExternaId);
      if (this.estado !== 'estableciendo') return; // se cerro mientras resolviamos
      const cdp = await this.deps.crearCdp(connectUrl);
      if (this.estado !== 'estableciendo') {
        cdp.cerrar();
        return;
      }
      this.cdp = cdp;
      this.cdpSessionId = await cdp.attachAPagina();
      if (this.estado !== 'estableciendo') return;
      this.estado = 'relevando';
      this.reiniciarIdle();
      this.enviarControl({ t: 'ready' });
      this.deps.logger.info('relay_abierto', {
        relaySesionId: this.id,
        connectionId,
        origen: this.deps.origen,
      });
    } catch {
      // La sesion no esta disponible (confirmada, expirada, o el proveedor no respondio). Sin detalle.
      this.rechazar('sesion_no_disponible');
    }
  }

  private manejarFrame(mensaje: Record<string, unknown>): void {
    const contador = mensaje.c;
    const ct = mensaje.ct;
    if (typeof contador !== 'number' || !Number.isInteger(contador) || typeof ct !== 'string') {
      this.rechazar('protocolo');
      return;
    }
    // ANTI REPLAY / REORDENAMIENTO: el contador debe crecer estrictamente en orden de llegada.
    if (contador <= this.ultimoContador) {
      this.rechazar('contador');
      return;
    }
    this.ultimoContador = contador;
    this.reiniciarIdle();
    // Descifrar y reenviar en una cola secuencial (preserva el orden de tecleo). El texto plano vive
    // solo dentro de esta tarea y su Buffer se sobreescribe al terminar.
    this.encolar(async () => {
      if (this.estado !== 'relevando' || this.claveSesion === null || this.cdp === null || this.cdpSessionId === null) {
        return;
      }
      let plano: Buffer;
      try {
        plano = descifrarFrame(this.claveSesion, contador, Buffer.from(ct, 'base64url'));
      } catch {
        // Tag que no autentica (frame manipulado): se corta el canal sin filtrar nada.
        this.rechazar('descifrado');
        return;
      }
      try {
        // Se decodifica sobre `plano` mismo (Buffer es Uint8Array): sin copia extra del texto plano.
        const pulsacion = decodificarPulsacion(plano);
        if (pulsacion === null) return; // forma invalida: se descarta la pulsacion, el canal sigue
        if (pulsacion.tipo === 'texto') {
          await this.cdp.insertarTexto(pulsacion.texto, this.cdpSessionId);
        } else {
          await this.cdp.despacharTecla(pulsacion.tecla, this.cdpSessionId);
        }
        this.eventos += 1;
      } finally {
        // Sobreescribir el texto plano en cuanto se reenvio (donde el runtime lo permite: el Buffer).
        plano.fill(0);
      }
    });
  }

  private encolar(tarea: () => Promise<void>): void {
    this.cola = this.cola.then(tarea).catch(() => this.cerrar('error_reenvio'));
  }

  private reiniciarIdle(): void {
    this.limpiarTemporizador('temporizadorIdle');
    this.temporizadorIdle = setTimeout(() => this.cerrar('idle'), this.idleTimeoutMs);
  }

  /** Envia un codigo de error GENERICO (sin contenido) y cierra el canal. */
  private rechazar(codigo: string): void {
    if (this.estado === 'cerrada') return;
    this.enviarControl({ t: 'error', code: codigo });
    this.cerrar(codigo);
  }

  private enviarControl(objeto: Record<string, unknown>): void {
    try {
      this.deps.socket.enviar(JSON.stringify(objeto));
    } catch {
      // un socket ya caido no es un fallo del flujo
    }
  }

  /** Cierre GARANTIZADO e idempotente: timers, CDP, cupo, clave y socket. Audita SOLO metadatos. */
  cerrar(motivo: string): void {
    if (this.estado === 'cerrada') return;
    this.estado = 'cerrada';
    this.limpiarTemporizador('temporizadorHandshake');
    this.limpiarTemporizador('temporizadorIdle');
    this.limpiarTemporizador('temporizadorExp');
    if (this.cdp !== null) {
      this.cdp.cerrar();
      this.cdp = null;
    }
    if (this.cupoReservado !== null) {
      this.deps.limitador.liberar(this.cupoReservado.ownerId, this.cupoReservado.connectionId);
      this.cupoReservado = null;
    }
    // Descartar la clave de sesion (la privada efimera muere con el par al salir de scope).
    if (this.claveSesion !== null) {
      this.claveSesion.fill(0);
      this.claveSesion = null;
    }
    try {
      this.deps.socket.cerrar();
    } catch {
      // idem
    }
    this.deps.logger.info('relay_cerrado', {
      relaySesionId: this.id,
      motivo,
      eventos: this.eventos,
      duracionMs: this.ahora() - this.inicioMs,
    });
  }

  private limpiarTemporizador(nombre: 'temporizadorHandshake' | 'temporizadorIdle' | 'temporizadorExp'): void {
    const timer = this[nombre];
    if (timer !== null) {
      clearTimeout(timer);
      this[nombre] = null;
    }
  }
}
