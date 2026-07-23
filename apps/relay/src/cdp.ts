import WebSocket from 'ws';
import type { TeclaControl } from '@ledesma-platform/shared/relay-protocol';

/**
 * Cliente CDP MINIMO del relay sobre `ws`, con UN solo proposito: inyectar teclas en la sesion de
 * navegador viva (Input.insertText / Input.dispatchKeyEvent). Es un primo recortado del cliente CDP del
 * worker (apps/worker/src/cdp.ts): request/response JSON-RPC por id, attach flatten a la pagina. No hay
 * navegacion, ni lectura de cookies, ni nada mas: si no sirve para relevar una tecla, no esta aca.
 *
 * SEGURIDAD: el connectUrl embebe el signing key de la sesion -> JAMAS se loguea (ni aca ni en los
 * llamadores) y NINGUN error de este modulo lo incluye. El texto de Input.insertText es contenido de la
 * pulsacion: no se loguea y solo se reenvia. No se retiene a proposito, pero armar el frame CDP
 * (JSON.stringify) crea una copia en un string INMUTABLE que no se puede borrar de forma determinista y
 * vive hasta que el GC la recolecta; por eso la proteccion real es el aislamiento del proceso, no un
 * borrado en memoria.
 */

const CDP_TIMEOUT_MS = 15_000;

interface MensajeCdp {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { message?: string };
}

interface Pendiente {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface TargetInfo {
  targetId: string;
  type: string;
}

/** Parametros de Input.dispatchKeyEvent por tecla de control (keyDown/rawKeyDown + keyUp). */
const TECLAS: Record<TeclaControl, { code: string; key: string; vk: number; text?: string; raw: boolean }> = {
  Enter: { code: 'Enter', key: 'Enter', vk: 13, text: '\r', raw: false },
  Backspace: { code: 'Backspace', key: 'Backspace', vk: 8, raw: true },
  Tab: { code: 'Tab', key: 'Tab', vk: 9, raw: true },
};

export class ClienteCdp {
  private siguienteId = 1;
  private readonly pendientes = new Map<number, Pendiente>();
  private cerrado = false;

  private constructor(private readonly ws: WebSocket) {}

  static async conectar(connectUrl: string): Promise<ClienteCdp> {
    const ws = new WebSocket(connectUrl);
    const cliente = new ClienteCdp(ws);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout al conectar CDP a la sesion')), CDP_TIMEOUT_MS);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', () => {
        clearTimeout(timer);
        // Sin detalle: el mensaje de error del socket podria incluir la URL con el signing key.
        reject(new Error('fallo el WebSocket CDP contra la sesion'));
      });
    });
    ws.on('message', (data: WebSocket.RawData) => cliente.alRecibir(data.toString()));
    ws.on('close', () => cliente.alCerrar());
    return cliente;
  }

  private alRecibir(data: string): void {
    let mensaje: MensajeCdp;
    try {
      mensaje = JSON.parse(data) as MensajeCdp;
    } catch {
      return;
    }
    if (typeof mensaje.id !== 'number') return; // eventos: no los usamos
    const pendiente = this.pendientes.get(mensaje.id);
    if (!pendiente) return;
    this.pendientes.delete(mensaje.id);
    clearTimeout(pendiente.timer);
    if (mensaje.error) {
      pendiente.reject(new Error(`CDP ${mensaje.error.message ?? 'error del protocolo'}`));
    } else {
      pendiente.resolve(mensaje.result);
    }
  }

  private alCerrar(): void {
    this.cerrado = true;
    for (const [, pendiente] of this.pendientes) {
      clearTimeout(pendiente.timer);
      pendiente.reject(new Error('el WebSocket CDP se cerro'));
    }
    this.pendientes.clear();
  }

  private enviar<T = unknown>(method: string, params?: unknown, sessionId?: string): Promise<T> {
    if (this.cerrado) return Promise.reject(new Error('el WebSocket CDP ya esta cerrado'));
    const id = this.siguienteId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendientes.delete(id);
        reject(new Error(`timeout esperando la respuesta CDP de ${method}`));
      }, CDP_TIMEOUT_MS);
      this.pendientes.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.ws.send(
        JSON.stringify({
          id,
          method,
          ...(params !== undefined ? { params } : {}),
          ...(sessionId !== undefined ? { sessionId } : {}),
        }),
      );
    });
  }

  /** Attach (flatten) a la primera pagina de la sesion; devuelve el sessionId page-level. */
  async attachAPagina(): Promise<string> {
    const { targetInfos } = await this.enviar<{ targetInfos: TargetInfo[] }>('Target.getTargets');
    const pagina = targetInfos.find((t) => t.type === 'page');
    if (!pagina) throw new Error('la sesion no expone ninguna pagina');
    const { sessionId } = await this.enviar<{ sessionId: string }>('Target.attachToTarget', {
      targetId: pagina.targetId,
      flatten: true,
    });
    return sessionId;
  }

  /**
   * Inserta TEXTO en el elemento enfocado de la pagina remota (Input.insertText). `texto` es contenido
   * de la pulsacion: se reenvia y no se retiene a proposito, aunque el JSON.stringify del frame deja una
   * copia inmutable en memoria hasta el GC (ver la nota de SEGURIDAD del modulo). No devuelve nada al
   * cliente (fire-and-forget) para no eco de contenido ni latencia extra.
   */
  async insertarTexto(texto: string, sessionId: string): Promise<void> {
    await this.enviar('Input.insertText', { text: texto }, sessionId);
  }

  /** Despacha una tecla de control (keyDown/rawKeyDown + keyUp) en la pagina remota. */
  async despacharTecla(tecla: TeclaControl, sessionId: string): Promise<void> {
    const t = TECLAS[tecla];
    const base = { windowsVirtualKeyCode: t.vk, nativeVirtualKeyCode: t.vk, key: t.key, code: t.code };
    await this.enviar(
      'Input.dispatchKeyEvent',
      { type: t.raw ? 'rawKeyDown' : 'keyDown', ...base, ...(t.text !== undefined ? { text: t.text } : {}) },
      sessionId,
    );
    await this.enviar('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
  }

  cerrar(): void {
    this.cerrado = true;
    try {
      this.ws.close();
    } catch {
      // cerrar un socket ya caido no es un fallo del flujo
    }
  }
}
