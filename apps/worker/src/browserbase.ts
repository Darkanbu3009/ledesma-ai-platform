import Browserbase from '@browserbasehq/sdk';
import { ClienteCdp } from './cdp.js';
import { SalidaDeRedNoDisponibleError } from './sitios.js';
import type { NavegadorRemoto, SesionDeLoginAbierta } from './sitios.js';

/**
 * ADAPTADOR real del puerto NavegadorRemoto (sitios.ts) sobre Browserbase (@browserbasehq/sdk
 * 2.16.0, el UNICO SDK permitido en este PR: cero Stagehand, cero AI SDK, cero clientes de modelo).
 * Este modulo es el unico del worker que importa el SDK; los handlers y los tests no lo tocan.
 *
 * Como no hay Playwright/Puppeteer (prohibidos), la navegacion inicial y la extraccion de cookies
 * van por CDP crudo (cdp.ts) contra el connectUrl de la sesion. El login en si JAMAS pasa por aca:
 * lo teclea el usuario en la vista en vivo, directamente contra Browserbase.
 *
 * Decisiones atadas a la doc de Browserbase (citas en el PR):
 *  - Contextos: browserSettings.context {id, persist:true}; el proveedor guarda cookies/perfil al
 *    CERRAR la sesion ("The data will be saved when the session closes").
 *  - keepAlive: true SIEMPRE: sin el, la sesion muere al desconectarse nuestro WebSocket CDP y el
 *    usuario no llegaria a loguearse. Requiere plan pago de Browserbase (Hobby+).
 *  - Proxy: 'browserbase' usa el pool gestionado (proxies:true), que es BEST-EFFORT y NO garantiza
 *    IP fija entre sesiones; por eso la IP observada se pina y las reaperturas la VERIFICAN (fallar
 *    antes que degradar). Para salida garantizada fija existe el proxy EXTERNO propio
 *    (BROWSERBASE_PROXY_*): la doc lo senala como la via de IP estatica.
 *  - La API NO expone la IP de salida de una sesion: se OBSERVA navegando a un echo de IP a traves
 *    del proxy, antes de navegar a la URL de login.
 */

/**
 * Timeout propio de la sesion de LOGIN en Browserbase (segundos): techo duro de costo si este worker
 * muriera antes de barrer. 15 min > los 10 del barrido, asi el barrido (que ademas marca la fila)
 * casi siempre llega primero y el timeout del proveedor queda de red de seguridad.
 */
const SESSION_TIMEOUT_SECONDS = 15 * 60;

/** Echo de IP para OBSERVAR la salida real del proxy (la API no la expone). Devuelve texto plano. */
const ECHO_IP_URL = 'https://api.ipify.org';

/** Referencia de salida del pool gestionado de Browserbase (best-effort, sin IP garantizada). */
const PROXY_REF_POOL = 'browserbase';

/** Prefijo de referencia de salida por proxy EXTERNO propio (IP estatica garantizada por el operador). */
const PROXY_REF_EXTERNO = 'external:';

const IP_REGEX = /^[0-9a-fA-F:.]{3,45}$/;

export interface BrowserbaseConfig {
  apiKey: string;
  projectId: string;
  /** Proxy externo propio con IP estatica (opcional). Si esta, las conexiones NUEVAS salen por el. */
  proxyServer?: string | undefined;
  proxyUsername?: string | undefined;
  proxyPassword?: string | undefined;
}

type ProxiesParam = NonNullable<Browserbase.SessionCreateParams['proxies']>;

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
}

export class NavegadorBrowserbase implements NavegadorRemoto {
  private readonly bb: Browserbase;

  constructor(private readonly config: BrowserbaseConfig) {
    this.bb = new Browserbase({ apiKey: config.apiKey });
  }

  /**
   * Resuelve la config de proxies para el `proxyRef` pedido. null = asignar salida nueva (externa si
   * hay proxy propio configurado; si no, el pool). Un ref pineado que ya no se puede reconstruir
   * (proxy externo cambiado o retirado del entorno) lanza SalidaDeRedNoDisponibleError: JAMAS se
   * degrada en silencio a otra salida.
   */
  private resolverProxy(proxyRef: string | null): { proxies: ProxiesParam; proxyRef: string } {
    const externo = this.config.proxyServer
      ? { server: this.config.proxyServer, username: this.config.proxyUsername, password: this.config.proxyPassword }
      : null;

    if (proxyRef === null) {
      if (externo) {
        return {
          proxies: [
            {
              type: 'external',
              server: externo.server,
              ...(externo.username !== undefined ? { username: externo.username } : {}),
              ...(externo.password !== undefined ? { password: externo.password } : {}),
            },
          ],
          proxyRef: `${PROXY_REF_EXTERNO}${externo.server}`,
        };
      }
      return { proxies: true, proxyRef: PROXY_REF_POOL };
    }

    if (proxyRef === PROXY_REF_POOL) {
      return { proxies: true, proxyRef: PROXY_REF_POOL };
    }

    if (proxyRef.startsWith(PROXY_REF_EXTERNO)) {
      const server = proxyRef.slice(PROXY_REF_EXTERNO.length);
      if (!externo || externo.server !== server) {
        throw new SalidaDeRedNoDisponibleError(
          'la salida de red pineada a esta conexion era un proxy externo que ya no esta configurado ' +
            'en el worker (BROWSERBASE_PROXY_SERVER distinto o ausente); restaurala o desconecta y ' +
            'reconecta el sitio para pinear una salida nueva',
        );
      }
      return {
        proxies: [
          {
            type: 'external',
            server: externo.server,
            ...(externo.username !== undefined ? { username: externo.username } : {}),
            ...(externo.password !== undefined ? { password: externo.password } : {}),
          },
        ],
        proxyRef,
      };
    }

    throw new SalidaDeRedNoDisponibleError(
      `la referencia de salida de red pineada a esta conexion no es reconocible (${proxyRef}); ` +
        'desconecta y reconecta el sitio para pinear una salida nueva',
    );
  }

  async abrirSesionParaLogin(params: {
    url: string;
    contextoExternoId: string | null;
    proxyRef: string | null;
  }): Promise<SesionDeLoginAbierta> {
    const { proxies, proxyRef } = this.resolverProxy(params.proxyRef);

    // Contexto NUEVO para una conexion nueva; el pineado para una reapertura (cookies del proveedor).
    const contextoExternoId =
      params.contextoExternoId ??
      (await this.bb.contexts.create({ projectId: this.config.projectId })).id;

    // keepAlive: la sesion debe SOBREVIVIR a nuestra desconexion CDP para que el humano se loguee.
    // timeout: techo de costo propio (el barrido de 10 min llega antes en operacion normal).
    const session = await this.bb.sessions.create({
      projectId: this.config.projectId,
      browserSettings: { context: { id: contextoExternoId, persist: true } },
      proxies,
      keepAlive: true,
      timeout: SESSION_TIMEOUT_SECONDS,
    });

    let egressIp: string | null = null;
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      // Attach al tab inicial (flatten): los comandos page-level llevan sessionId top-level.
      const { targetInfos } = await cdp.enviar<{ targetInfos: TargetInfo[] }>('Target.getTargets');
      const pagina = targetInfos.find((t) => t.type === 'page');
      if (!pagina) throw new Error('la sesion de navegador no expone ninguna pagina');
      const { sessionId } = await cdp.enviar<{ sessionId: string }>('Target.attachToTarget', {
        targetId: pagina.targetId,
        flatten: true,
      });
      await cdp.enviar('Page.enable', {}, sessionId);

      // OBSERVAR la salida real navegando a un echo de IP A TRAVES del proxy (la API no la expone).
      // Best-effort: si el echo falla, egressIp queda null y el handler decide (una reapertura con
      // IP pineada FALLA porque no puede verificar; una conexion nueva pina null).
      try {
        const carga = cdp.esperarEvento('Page.loadEventFired', sessionId);
        await cdp.enviar('Page.navigate', { url: ECHO_IP_URL }, sessionId);
        await carga;
        const evaluado = await cdp.enviar<{ result?: { value?: unknown } }>(
          'Runtime.evaluate',
          { expression: 'document.body.innerText.trim()', returnByValue: true },
          sessionId,
        );
        const valor = evaluado.result?.value;
        if (typeof valor === 'string' && IP_REGEX.test(valor)) egressIp = valor;
      } catch {
        egressIp = null;
      }

      // Navegar a la URL de login y DESCONECTAR: el humano toma el control en la vista en vivo. No
      // se espera la carga completa (el job no espera nada del humano); si Chrome rechaza la
      // navegacion (URL irresoluble), se falla ruidosamente.
      const navegacion = await cdp.enviar<{ errorText?: string }>(
        'Page.navigate',
        { url: params.url },
        sessionId,
      );
      if (navegacion.errorText) {
        throw new Error(`el navegador no pudo abrir la URL de login: ${navegacion.errorText}`);
      }
    } catch (error) {
      // La sesion recien creada no debe quedar viva si el arranque fallo (minutos facturados).
      cdp.cerrar();
      await this.cerrarSesionSilencioso(session.id);
      throw error;
    }
    cdp.cerrar();

    const debug = await this.bb.sessions.debug(session.id);

    return {
      sesionExternaId: session.id,
      contextoExternoId,
      vistaEnVivoUrl: debug.debuggerFullscreenUrl,
      proxyRef,
      egressIp,
      // Browserbase no expone una referencia de fingerprint propia: el fingerprint/perfil viaja CON
      // el contexto del proveedor, asi que la referencia estable es el contexto mismo.
      fingerprintRef: `contexto:${contextoExternoId}`,
      expiraEn: session.expiresAt ?? null,
    };
  }

  async estadoDeSesion(sesionExternaId: string): Promise<'viva' | 'muerta'> {
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    return session.status === 'RUNNING' ? 'viva' : 'muerta';
  }

  /**
   * Extrae las cookies de la sesion viva por CDP (Storage.getCookies, browser-level) y las
   * serializa como el contexto a cifrar. El storage por origen queda del lado del contexto del
   * proveedor (persist); la copia cifrada local son las cookies, que son la credencial de sesion.
   */
  async extraerContexto(sesionExternaId: string): Promise<string> {
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    if (!session.connectUrl) {
      throw new Error('la sesion de navegador no expone un connect URL (ya no esta corriendo)');
    }
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const resultado = await cdp.enviar<{ cookies: unknown[] }>('Storage.getCookies');
      return JSON.stringify({ formato: 'cookies-cdp-v1', cookies: resultado.cookies });
    } finally {
      cdp.cerrar();
    }
  }

  async cerrarSesion(sesionExternaId: string): Promise<void> {
    await this.bb.sessions.update(sesionExternaId, {
      projectId: this.config.projectId,
      status: 'REQUEST_RELEASE',
    });
  }

  async borrarContexto(contextoExternoId: string): Promise<void> {
    await this.bb.contexts.delete(contextoExternoId);
  }

  private async cerrarSesionSilencioso(sesionExternaId: string): Promise<void> {
    try {
      await this.cerrarSesion(sesionExternaId);
    } catch {
      // best-effort: el timeout de 15 min del proveedor es la red de seguridad
    }
  }
}
