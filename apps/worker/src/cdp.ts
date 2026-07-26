/**
 * Cliente MINIMO de Chrome DevTools Protocol (CDP) sobre el WebSocket GLOBAL de Node (implementacion
 * undici embebida; NO la libreria `ws`). Existe porque este PR tiene PROHIBIDO agregar Playwright,
 * Puppeteer o cualquier otra dependencia ademas de @browserbasehq/sdk (cliente REST puro que no sabe
 * navegar): la unica via para poner la sesion remota en la URL de login y extraer cookies es hablar
 * CDP crudo contra el connect URL de la sesion.
 *
 * Alcance DELIBERADAMENTE chico: request/response JSON-RPC correlacionado por id, espera de UN
 * evento, y attach a un target con flatten (los comandos page-level llevan sessionId en el TOP LEVEL
 * del mensaje, no en params). Nada mas: la navegacion por IA (7.1d) usara su propia infraestructura.
 *
 * Requisito de runtime: el WebSocket global existe desde Node 20.10 DETRAS del flag
 * --experimental-websocket (estable y por defecto desde Node 22). Este repo pinea Node 20, asi que
 * el script start del worker pasa el flag; si falta, conectar() falla con un mensaje accionable.
 *
 * SEGURIDAD: el connect URL embebe el signing key de la sesion -> JAMAS se loguea (ni aca ni en los
 * llamadores). Los errores de este modulo no incluyen la URL.
 */

/** Timeout por comando/evento CDP (ms). Cubre blips sin colgar el job: todo lo de aca es acotado. */
const CDP_DEFAULT_TIMEOUT_MS = 15_000;

interface MensajeCdp {
  id?: number;
  method?: string;
  sessionId?: string;
  result?: unknown;
  error?: { message?: string };
  params?: unknown;
}

interface Pendiente {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** El WebSocket global (undici) con la superficie minima que usamos, sin depender de tipos DOM. */
interface WebSocketMinimo {
  addEventListener(type: string, listener: (event: { data?: unknown; message?: string }) => void): void;
  send(data: string): void;
  close(): void;
}

type ConstructorWebSocket = new (url: string) => WebSocketMinimo;

export class ClienteCdp {
  private siguienteId = 1;
  private readonly pendientes = new Map<number, Pendiente>();
  private esperasDeEvento: Array<{
    method: string;
    sessionId: string | undefined;
    resolve(params: unknown): void;
  }> = [];
  /**
   * Suscripciones CONTINUAS a un evento (a diferencia de esperarEvento, que resuelve una sola vez).
   * Existe para la grabacion de tareas: el guion que corre en la pagina le habla al worker por
   * Runtime.bindingCalled, que llega N veces mientras el usuario hace la tarea.
   */
  private suscripciones: Array<{
    method: string;
    sessionId: string | undefined;
    manejador(params: unknown): void;
  }> = [];
  private cerrado = false;

  private constructor(
    private readonly ws: WebSocketMinimo,
    private readonly timeoutMs: number,
  ) {}

  /** Abre el WebSocket contra el connect URL CDP (browser-level) y queda listo para enviar. */
  static async conectar(connectUrl: string, timeoutMs = CDP_DEFAULT_TIMEOUT_MS): Promise<ClienteCdp> {
    const Ctor = (globalThis as { WebSocket?: unknown }).WebSocket as ConstructorWebSocket | undefined;
    if (typeof Ctor !== 'function') {
      throw new Error(
        'el WebSocket global de Node no esta disponible: en Node 20 el worker debe arrancar con ' +
          '--experimental-websocket (ver el script start de apps/worker)',
      );
    }
    const ws = new Ctor(connectUrl);
    const cliente = new ClienteCdp(ws, timeoutMs);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timeout al conectar el WebSocket CDP a la sesion')),
        timeoutMs,
      );
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('fallo el WebSocket CDP contra la sesion de navegador'));
      });
    });
    ws.addEventListener('message', (event) => cliente.alRecibir(String(event.data ?? '')));
    ws.addEventListener('close', () => cliente.alCerrar());
    return cliente;
  }

  private alRecibir(data: string): void {
    let mensaje: MensajeCdp;
    try {
      mensaje = JSON.parse(data) as MensajeCdp;
    } catch {
      return; // un frame no-JSON no corresponde a nada nuestro
    }
    if (typeof mensaje.id === 'number') {
      const pendiente = this.pendientes.get(mensaje.id);
      if (!pendiente) return;
      this.pendientes.delete(mensaje.id);
      clearTimeout(pendiente.timer);
      if (mensaje.error) {
        pendiente.reject(new Error(`CDP ${mensaje.error.message ?? 'error del protocolo'}`));
      } else {
        pendiente.resolve(mensaje.result);
      }
      return;
    }
    if (typeof mensaje.method === 'string') {
      for (const suscripcion of this.suscripciones) {
        const coincide =
          suscripcion.method === mensaje.method &&
          (suscripcion.sessionId === undefined || suscripcion.sessionId === mensaje.sessionId);
        if (!coincide) continue;
        try {
          suscripcion.manejador(mensaje.params);
        } catch {
          // Un manejador que lanza no puede romper la lectura del socket ni el resto de las esperas.
        }
      }
      const restantes: typeof this.esperasDeEvento = [];
      for (const espera of this.esperasDeEvento) {
        const coincide =
          espera.method === mensaje.method &&
          (espera.sessionId === undefined || espera.sessionId === mensaje.sessionId);
        if (coincide) espera.resolve(mensaje.params);
        else restantes.push(espera);
      }
      this.esperasDeEvento = restantes;
    }
  }

  private alCerrar(): void {
    this.cerrado = true;
    for (const [, pendiente] of this.pendientes) {
      clearTimeout(pendiente.timer);
      pendiente.reject(new Error('el WebSocket CDP se cerro con comandos en vuelo'));
    }
    this.pendientes.clear();
  }

  /**
   * Envia un comando y espera su respuesta (correlacion por id, timeout acotado). `sessionId` (modo
   * flatten) va en el TOP LEVEL del mensaje para comandos page-level; ausente = comando browser-level.
   */
  enviar<T = unknown>(method: string, params?: unknown, sessionId?: string): Promise<T> {
    if (this.cerrado) return Promise.reject(new Error('el WebSocket CDP ya esta cerrado'));
    const id = this.siguienteId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendientes.delete(id);
        reject(new Error(`timeout esperando la respuesta CDP de ${method}`));
      }, this.timeoutMs);
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

  /** Espera UN evento CDP (opcionalmente de una sesion flatten concreta), con timeout acotado. */
  esperarEvento<T = unknown>(method: string, sessionId?: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.esperasDeEvento = this.esperasDeEvento.filter((e) => e.resolve !== envoltura);
        reject(new Error(`timeout esperando el evento CDP ${method}`));
      }, this.timeoutMs);
      const envoltura = (params: unknown): void => {
        clearTimeout(timer);
        resolve(params as T);
      };
      this.esperasDeEvento.push({ method, sessionId, resolve: envoltura });
    });
  }

  /**
   * SUSCRIBE un manejador a TODAS las apariciones de un evento CDP (opcionalmente de una sesion
   * flatten concreta). Devuelve la funcion que cancela la suscripcion. Sin timeout a proposito: quien
   * suscribe decide cuando dejar de escuchar.
   */
  suscribirEvento(
    method: string,
    manejador: (params: unknown) => void,
    sessionId?: string,
  ): () => void {
    const entrada = { method, sessionId, manejador };
    this.suscripciones.push(entrada);
    return () => {
      this.suscripciones = this.suscripciones.filter((s) => s !== entrada);
    };
  }

  /** Cierra el WebSocket. La sesion remota sigue viva (keep alive del proveedor); solo se desconecta. */
  cerrar(): void {
    this.cerrado = true;
    try {
      this.ws.close();
    } catch {
      // un close sobre un socket ya caido no es un fallo del flujo
    }
  }
}
