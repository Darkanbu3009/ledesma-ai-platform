import { codificarTexto, codificarTecla, type TeclaControl } from '@ledesma-platform/shared/relay-protocol';
import { apiFetch } from './api';
import { crearParEfimero, derivarClaveSesion, cifrarPulsacion, type ParEfimeroCliente } from './relay-crypto';

/**
 * Cliente del RELAY DE TECLADO MOVIL (conocimiento minimo). Abre el WebSocket contra el servicio relay,
 * hace el handshake ECDH y reenvia cada pulsacion CIFRADA (AES-256-GCM, contador monotono). El texto
 * plano se codifica, se cifra y se suelta: no se acumula ni se guarda. NO es cifrado extremo a extremo.
 */

export type { TeclaControl };

export interface TokenRelay {
  token: string;
  expiresAt: string;
  relayUrl: string;
}

/** Pide al backend (autenticado) el token efimero + la URL del relay. Lanza ApiError si no aplica. */
export async function solicitarTokenRelay(sitioId: string): Promise<TokenRelay> {
  return apiFetch<TokenRelay>(`/v1/sitios/${sitioId}/relay-token`, { method: 'POST' });
}

export type EstadoConexionRelay = 'conectando' | 'listo' | 'error' | 'cerrado';

export interface OpcionesConexion {
  relayUrl: string;
  token: string;
  onEstado: (estado: EstadoConexionRelay) => void;
  /** Inyectable en tests: fabrica de WebSocket. Default: el WebSocket global del navegador. */
  crearSocket?: (url: string) => WebSocket;
}

export class ConexionRelayTeclado {
  private ws: WebSocket | null = null;
  private par: ParEfimeroCliente | null = null;
  private clave: CryptoKey | null = null;
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
    let mensaje: { t?: unknown; pub?: unknown };
    try {
      mensaje = JSON.parse(data) as { t?: unknown; pub?: unknown };
    } catch {
      return;
    }
    if (mensaje.t === 'srv_hello' && typeof mensaje.pub === 'string' && this.par !== null) {
      try {
        this.clave = await derivarClaveSesion(this.par.par, mensaje.pub);
      } catch {
        this.pasarA('error');
        return;
      }
      this.enviar({ t: 'cli_hello', pub: this.par.pubB64, token: this.opts.token });
      return;
    }
    if (mensaje.t === 'ready') {
      this.pasarA('listo');
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
