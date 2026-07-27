import { codificarTexto, codificarTecla, type TeclaControl } from '@ledesma-platform/shared/relay-protocol';
import { apiFetch } from './api';
import {
  crearParEfimero,
  derivarClaveSesion,
  cifrarPulsacion,
  macClienteHandshake,
  verificarMacRelay,
  type ParEfimeroCliente,
} from './relay-crypto';

/**
 * Cliente del RELAY DE TECLADO MOVIL (conocimiento minimo). Abre el WebSocket contra el servicio relay,
 * hace el handshake ECDH AUTENTICADO y reenvia cada pulsacion CIFRADA (AES-256-GCM, contador monotono).
 * El texto plano se codifica, se cifra y se suelta: no se acumula ni se guarda. NO es cifrado extremo a
 * extremo.
 *
 * HANDSHAKE AUTENTICADO (A-1): el ECDH X25519 no basta contra un MITM en el proxy que termina TLS. El
 * cliente firma una MAC sobre el transcript (ambas publicas + el token) con la clave derivada del secreto
 * de enlace `hs` que el backend le entrego, y NO teclea hasta verificar la MAC del relay en el `ready`.
 * Si un MITM sustituyo cualquier publica, alguna de las dos MAC no valida y el canal se corta.
 */

export type { TeclaControl };

export interface TokenRelay {
  token: string;
  expiresAt: string;
  relayUrl: string;
  /** Secreto de enlace del handshake (base64url): raiz de confianza de la MAC de canal (A-1). */
  hs: string;
}

/** Pide al backend (autenticado) el token efimero + la URL del relay. Lanza ApiError si no aplica. */
export async function solicitarTokenRelay(sitioId: string): Promise<TokenRelay> {
  return apiFetch<TokenRelay>(`/v1/sitios/${sitioId}/relay-token`, { method: 'POST' });
}

/**
 * Igual que solicitarTokenRelay pero para una GRABACION en curso: el token queda ligado a la sesion
 * de navegador de la grabacion (no a la del login). Mismo contrato de respuesta y mismos errores.
 */
export async function solicitarTokenRelayGrabacion(grabacionId: string): Promise<TokenRelay> {
  return apiFetch<TokenRelay>(`/v1/grabaciones/${grabacionId}/relay-token`, { method: 'POST' });
}

export type EstadoConexionRelay = 'conectando' | 'listo' | 'error' | 'cerrado';

export interface OpcionesConexion {
  relayUrl: string;
  token: string;
  /** Secreto de enlace del handshake (base64url) que el backend devolvio junto al token (A-1). */
  hs: string;
  onEstado: (estado: EstadoConexionRelay) => void;
  /** Inyectable en tests: fabrica de WebSocket. Default: el WebSocket global del navegador. */
  crearSocket?: (url: string) => WebSocket;
}

export class ConexionRelayTeclado {
  private ws: WebSocket | null = null;
  private par: ParEfimeroCliente | null = null;
  private clave: CryptoKey | null = null;
  /** Publica del relay recibida en srv_hello: entra en el transcript de ambas MAC. */
  private relayPubB64: string | null = null;
  private contador = 0;
  private estado: EstadoConexionRelay = 'conectando';

  constructor(private readonly opts: OpcionesConexion) {}

  /** Abre el socket y arranca el handshake. El estado se reporta por onEstado. */
  async conectar(): Promise<void> {
    try {
      this.par = await crearParEfimero();
    } catch {
      this.pasarA('error');
      return;
    }
    const crear = this.opts.crearSocket ?? ((url: string) => new WebSocket(url));
    const ws = crear(this.opts.relayUrl);
    this.ws = ws;
    ws.onmessage = (ev) => {
      void this.alMensaje(typeof ev.data === 'string' ? ev.data : '');
    };
    ws.onerror = () => this.pasarA('error');
    ws.onclose = () => this.pasarA('cerrado');
  }

  private async alMensaje(data: string): Promise<void> {
    let mensaje: { t?: unknown; pub?: unknown; mac?: unknown };
    try {
      mensaje = JSON.parse(data) as { t?: unknown; pub?: unknown; mac?: unknown };
    } catch {
      return;
    }
    if (mensaje.t === 'srv_hello' && typeof mensaje.pub === 'string' && this.par !== null) {
      this.relayPubB64 = mensaje.pub;
      try {
        this.clave = await derivarClaveSesion(this.par.par, mensaje.pub);
        // A-1: firmar la MAC del cliente sobre el transcript (publica del relay recibida + la propia +
        // token) con la clave derivada de `hs`. El relay la verifica y rechaza si no corresponde.
        const mac = await macClienteHandshake(this.opts.hs, mensaje.pub, this.par.pubB64, this.opts.token);
        this.enviar({ t: 'cli_hello', pub: this.par.pubB64, token: this.opts.token, mac });
      } catch {
        this.pasarA('error');
      }
      return;
    }
    if (mensaje.t === 'ready' && this.par !== null && this.relayPubB64 !== null) {
      // A-1: NO teclear hasta confirmar que el relay conoce `hs` (que no es un impostor/MITM). La MAC del
      // relay va sobre el mismo transcript; si falta o no valida, se corta el canal.
      const macRelay = typeof mensaje.mac === 'string' ? mensaje.mac : '';
      let ok = false;
      try {
        ok = await verificarMacRelay(this.opts.hs, this.relayPubB64, this.par.pubB64, this.opts.token, macRelay);
      } catch {
        // MAC del relay ilegible: se trata como invalida (ok queda en false).
      }
      this.pasarA(ok ? 'listo' : 'error');
      return;
    }
    if (mensaje.t === 'error') {
      this.pasarA('error');
    }
  }

  /** Reenvia texto tecleado (cifrado). Se ignora si el canal aun no esta listo. */
  async enviarTexto(texto: string): Promise<void> {
    if (texto.length === 0) return;
    await this.enviarPulsacion(codificarTexto(texto));
  }

  /** Reenvia una tecla de control (cifrada). */
  async enviarTecla(tecla: TeclaControl): Promise<void> {
    await this.enviarPulsacion(codificarTecla(tecla));
  }

  private async enviarPulsacion(plano: Uint8Array): Promise<void> {
    if (this.estado !== 'listo' || this.clave === null || this.ws === null) return;
    this.contador += 1;
    const ct = await cifrarPulsacion(this.clave, this.contador, plano);
    this.enviar({ t: 'k', c: this.contador, ct });
  }

  private enviar(objeto: Record<string, unknown>): void {
    try {
      this.ws?.send(JSON.stringify(objeto));
    } catch {
      // un socket ya caido no es un fallo del flujo
    }
  }

  private pasarA(estado: EstadoConexionRelay): void {
    if (this.estado === 'cerrado') return;
    this.estado = estado;
    this.opts.onEstado(estado);
  }

  /** Cierre garantizado: descarta la clave y cierra el socket. */
  cerrar(): void {
    this.clave = null;
    try {
      this.ws?.close();
    } catch {
      // idem
    }
    this.pasarA('cerrado');
  }
}
