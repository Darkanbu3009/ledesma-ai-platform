import { randomUUID } from 'node:crypto';
import { verifyRelayToken } from '@ledesma-platform/shared/relay-token';
import { decodificarPulsacion, type TeclaControl } from '@ledesma-platform/shared/relay-protocol';
import { generarParEfimero, derivarClaveSesion, verificarMacCliente, macRelay } from './handshake.js';
import { descifrarFrame } from './frames.js';
import type { AutoridadRelay } from './autoridad.js';
import type { LimitadorRelay } from './rate-limit.js';
import type { Logger } from './logger.js';

/**
 * SESION DE RELAY: la maquina de estados de UN canal (handshake -> ready -> pulsaciones -> cierre).
 * Concentra toda la logica sensible y esta INYECTADA por dependencias (socket, CDP, resolver de
 * connectUrl, autoridad de coordinacion, reloj) para poder testearla entera sin red real.
 *
 * HANDSHAKE AUTENTICADO (A-1): el ECDH X25519 no basta contra un MITM en el proxy que termina TLS. El
 * cliente prueba, con una MAC sobre el transcript (ambas publicas + el token) keyada por el secreto de
 * enlace del token, que las publicas que ve son las mismas que ve el relay. Si el MITM sustituyo
 * cualquier publica, la MAC no valida y el relay RECHAZA. El relay a su vez firma su propia MAC en el
 * `ready` para que el cliente no teclee hacia un relay impostor.
 *
 * ESTADO COMPARTIDO (B-1): el uso unico del jti y el lock por conexion se consultan en una autoridad
 * COMPARTIDA por todas las instancias (fail-closed: si no responde, se rechaza el canal). Asi la ventana
 * de un rolling deploy no permite consumir el mismo token dos veces ni abrir dos canales a la conexion.
 *
 * CERO PERSISTENCIA / CERO LOGS DE CONTENIDO: el texto plano de una pulsacion se descifra en un Buffer
 * que se sobreescribe (fill 0) en cuanto se reenvia por CDP. Ese fill NO borra TODO el texto plano:
 * decodificarlo para CDP (TextDecoder en decodificarPulsacion y el JSON.stringify del frame CDP) produce
 * copias en strings de JavaScript, INMUTABLES, que no se pueden borrar de forma determinista y solo
 * desaparecen cuando el recolector de basura las libera. Por eso la mitigacion REAL no es el fill sino el
 * AISLAMIENTO DEL PROCESO (un servicio relay minimo, de un solo proposito, sin VAULT_SECRET ni
 * DATABASE_URL) y la AUSENCIA DE PERSISTENCIA: el texto plano nunca se escribe a disco/base/cola y nunca
 * se loguea. Tampoco se registra el conteo de pulsaciones (equivalia al numero de teclas y filtraba la
 * longitud de lo tecleado). La auditoria (logger) recibe SOLO metadatos no sensibles.
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
  /** Autoridad COMPARTIDA de uso unico del jti y lock por conexion (B-1). */
  autoridad: AutoridadRelay;
  /** Limitador LOCAL best-effort (flood + concurrencia por owner). */
  limitador: LimitadorRelay;
  logger: Logger;
  resolverConnectUrl(sesionExternaId: string): Promise<string>;
  crearCdp(connectUrl: string): Promise<CdpInyector>;
  /**
   * Libera el cupo PRE-AUTH del portero (B-2). La sesion lo llama UNA sola vez: al autenticar el
   * handshake (deja de ser anonima) o al cerrar, lo que ocurra primero. Opcional (los tests no lo pasan).
   */
  liberarPreAuth?: () => void;
  /** Reloj inyectable (ms). Default Date.now. */
  ahora?: () => number;
  handshakeTimeoutMs?: number;
  idleTimeoutMs?: number;
}

type Estado = 'hello' | 'estableciendo' | 'relevando' | 'cerrada';

// Ventana de retencion pre-auth (B-2): tras el srv_hello, un cliente legitimo responde el cli_hello en
// sub-segundos (un solo round trip de aplicacion sobre un WebSocket ya establecido). 5s deja margen de
// sobra para redes moviles lentas y a la vez acota cuanto puede un atacante retener una sesion sin
// autenticar (antes eran 10s).
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

/**
 * Codigo UNICO de rechazo hacia el cliente (C-2). No distingue el motivo (token invalido, reuso, limite,
 * conexion ocupada, protocolo, ...): todos se ven igual desde afuera para no filtrar un oraculo. El
 * detalle vive solo en el log de metadatos del servidor.
 */
const CODIGO_RECHAZO_CLIENTE = 'rechazado';

export class SesionRelay {
  private readonly id = randomUUID();
  /** Nonce del lock por conexion de ESTA sesion: solo ella libera su propio lock en la autoridad. */
  private readonly lockNonce = randomUUID();
  private estado: Estado = 'hello';
  private readonly par = generarParEfimero();
  private claveSesion: Buffer | null = null;
  private cdp: CdpInyector | null = null;
  private cdpSessionId: string | null = null;
  private ultimoContador = 0;
  private cupoReservado: { ownerId: string } | null = null;
  private conexionTomada: { connectionId: string } | null = null;
  /** El cupo pre-auth (B-2) se libera una sola vez; este flag garantiza la idempotencia. */
  private preAuthLiberado = false;
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
    const mac = mensaje.mac;
    if (typeof pub !== 'string' || typeof token !== 'string' || typeof mac !== 'string') {
      this.rechazar('protocolo');
      return;
    }
    const claims = verifyRelayToken(token, this.deps.relayTokenSecret);
    if (claims === null) {
      this.rechazar('token_invalido');
      return;
    }
    // A-1: AUTENTICAR EL HANDSHAKE antes de reservar/consumir nada (asi un MITM no puede quemar el
    // token del usuario con una MAC invalida). La MAC del cliente liga la publica del relay que ENVIAMOS
    // y la del cliente que RECIBIMOS al token; si el MITM sustituyo alguna, no coincide.
    if (!verificarMacCliente(mac, this.par.publicKeyB64, pub, token, claims.bindingKey)) {
      this.rechazar('handshake_no_autenticado');
      return;
    }
    // AUTENTICADO (A-1): el cliente probo poseer el secreto de enlace, ya no es un handshake anonimo.
    // Se libera el cupo PRE-AUTH (B-2): de aca en mas la sesion la gobierna el limitador por owner, no
    // el portero. Asi el cupo cuenta handshakes en vuelo y no se retiene mientras el usuario teclea.
    this.liberarPreAuth();
    // Rate limiting LOCAL best-effort por owner ANTES de reservar recursos (flood + concurrencia).
    const intento = this.deps.limitador.intentar(claims.ownerId, this.ahora());
    if (!intento.ok) {
      this.rechazar('limite');
      return;
    }
    this.cupoReservado = { ownerId: claims.ownerId };
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

    // Coordinacion COMPARTIDA (lock + uso unico) y luego CDP. Todo async: si la autoridad no responde,
    // se rechaza el canal (fail-closed).
    void this.autorizarYEstablecer(claims.connectionId, claims.jti, claims.sesionExternaId, claims.exp, pub, token, claims.bindingKey);
  }

  private async autorizarYEstablecer(
    connectionId: string,
    jti: string,
    sesionExternaId: string,
    exp: number,
    clientPubB64: string,
    token: string,
    bindingKey: string,
  ): Promise<void> {
    // 1) LOCK por conexion COMPARTIDO (atomico cross-instancia). Se toma ANTES de consumir el jti para
    //    que la contienda por la conexion no queme el token. Fail-closed si la autoridad no responde.
    let tomado: boolean;
    try {
      tomado = await this.deps.autoridad.tomarConexion(connectionId, this.lockNonce, exp);
    } catch {
      this.rechazar('autoridad_no_disponible');
      return;
    }
    if (this.estado !== 'estableciendo') {
      // Se cerro mientras consultabamos: si alcanzamos a tomar el lock, liberarlo.
      if (tomado) void this.deps.autoridad.liberarConexion(connectionId, this.lockNonce);
      return;
    }
    if (!tomado) {
      this.rechazar('conexion_ocupada');
      return;
    }
    this.conexionTomada = { connectionId };

    // 2) USO UNICO del jti COMPARTIDO (atomico). Reuso -> rechazo (el lock lo libera cerrar()).
    let consumido: boolean;
    try {
      consumido = await this.deps.autoridad.consumirJti(jti, exp);
    } catch {
      this.rechazar('autoridad_no_disponible');
      return;
    }
    if (this.estado !== 'estableciendo') return; // se cerro mientras consultabamos
    if (!consumido) {
      this.rechazar('reuso');
      return;
    }

    // 3) Resolver el connectUrl, abrir CDP y confirmar con el ready (que lleva la MAC del relay).
    await this.establecerCdp(connectionId, sesionExternaId, clientPubB64, token, bindingKey);
  }

  private async establecerCdp(
    connectionId: string,
    sesionExternaId: string,
    clientPubB64: string,
    token: string,
    bindingKey: string,
  ): Promise<void> {
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
      // El ready lleva la MAC del RELAY: el cliente la verifica antes de teclear, asi no habla con un
      // relay impostor (un MITM que sustituyo la pata del relay no conoce el secreto de enlace).
      this.enviarControl({ t: 'ready', mac: macRelay(this.par.publicKeyB64, clientPubB64, token, bindingKey) });
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
    // Descifrar y reenviar en una cola secuencial (preserva el orden de tecleo). El Buffer del texto
    // plano se sobreescribe al terminar, pero las copias en strings que CDP necesita no se pueden borrar
    // (ver la nota de la clase): el texto plano vive dentro de esta tarea y, como strings inmutables,
    // hasta que el GC los recolecte.
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
      } finally {
        // Sobreescribir el Buffer del texto plano en cuanto se reenvio. Solo alcanza al Buffer: las
        // copias en strings inmutables que produjo decodificarlo para CDP no se pueden borrar aqui y
        // solo desaparecen cuando el GC las libera.
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

  /**
   * Rechaza el canal (C-2). Hacia el CLIENTE va SIEMPRE el mismo codigo generico: "token ya usado",
   * "limite excedido", "conexion ocupada", "token invalido", etc. son INDISTINGUIBLES para quien esta
   * afuera, para no darle un oraculo que le diga por que fue rechazado. El MOTIVO especifico queda SOLO
   * en el log de metadatos del servidor (via `cerrar` -> `relay_cerrado.motivo`).
   */
  private rechazar(motivo: string): void {
    if (this.estado === 'cerrada') return;
    this.enviarControl({ t: 'error', code: CODIGO_RECHAZO_CLIENTE });
    this.cerrar(motivo);
  }

  /** Libera el cupo pre-auth (B-2) una sola vez (al autenticar o al cerrar, lo que ocurra primero). */
  private liberarPreAuth(): void {
    if (this.preAuthLiberado) return;
    this.preAuthLiberado = true;
    this.deps.liberarPreAuth?.();
  }

  private enviarControl(objeto: Record<string, unknown>): void {
    try {
      this.deps.socket.enviar(JSON.stringify(objeto));
    } catch {
      // un socket ya caido no es un fallo del flujo
    }
  }

  /** Cierre GARANTIZADO e idempotente: timers, CDP, lock, cupo, clave y socket. Audita SOLO metadatos. */
  cerrar(motivo: string): void {
    if (this.estado === 'cerrada') return;
    this.estado = 'cerrada';
    // Respaldo del cupo pre-auth (B-2): si se cierra antes de autenticar, se libera aqui (idempotente).
    this.liberarPreAuth();
    this.limpiarTemporizador('temporizadorHandshake');
    this.limpiarTemporizador('temporizadorIdle');
    this.limpiarTemporizador('temporizadorExp');
    if (this.cdp !== null) {
      this.cdp.cerrar();
      this.cdp = null;
    }
    // Liberar el lock por conexion COMPARTIDO (best-effort: si falla, caduca solo por exp).
    if (this.conexionTomada !== null) {
      void this.deps.autoridad.liberarConexion(this.conexionTomada.connectionId, this.lockNonce);
      this.conexionTomada = null;
    }
    if (this.cupoReservado !== null) {
      this.deps.limitador.liberar(this.cupoReservado.ownerId);
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
