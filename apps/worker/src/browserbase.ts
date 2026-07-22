import Browserbase from '@browserbasehq/sdk';
import { ClienteCdp } from './cdp.js';
import { SalidaDeRedNoDisponibleError } from './sitios.js';
import type { NavegadorRemoto, SesionDeLoginAbierta } from './sitios.js';
import type { NavegadorParaTarea, SesionDeTareaAbierta } from './tarea-web.js';

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
 *  - Proxy: 'browserbase' usa el pool gestionado con GEOLOCALIZACION FIJA POR PAIS (doc "Proxies":
 *    proxies: [{type:'browserbase', geolocation:{country}}], country en ISO 3166-1 alpha-2). El pool
 *    es residencial ROTATIVO: la IP cambia entre sesiones aunque el pais pedido sea el mismo, y la
 *    doc advierte que sin cobertura en la ubicacion pedida usa el proxy MAS CERCANO (puede cruzar
 *    frontera). Por eso el criterio de pinning es el PAIS observado (los handlers verifican y fallan
 *    antes que degradar), no la IP exacta. Para salida garantizada fija existe el proxy EXTERNO
 *    propio (BROWSERBASE_PROXY_*): la doc lo senala como la via de IP estatica.
 *  - La API NO expone la salida (IP ni pais) de una sesion: se OBSERVA navegando a un echo a traves
 *    del proxy (cdn-cgi/trace de Cloudflare, que devuelve ip= y loc= en texto plano), antes de
 *    navegar a la URL de login.
 */

/**
 * Timeout propio de la sesion de LOGIN en Browserbase (segundos): techo duro de costo si este worker
 * muriera antes de barrer. 15 min > los 10 del barrido, asi el barrido (que ademas marca la fila)
 * casi siempre llega primero y el timeout del proveedor queda de red de seguridad.
 */
const SESSION_TIMEOUT_SECONDS = 15 * 60;

/**
 * Timeout propio de la sesion de TAREA WEB (segundos). Mas largo que el de login porque una tarea
 * puede PAUSARSE en un checkpoint de aprobacion humana (7.1e) y la sesion DEBE seguir viva mientras
 * la aprobacion este pendiente (el estado del checkout se pierde si se reabre): cubre el deadline de
 * la corrida (<= 10 min), el TTL de la aprobacion (<= 20 min, ver env.ts), la corrida de la
 * reanudacion y margen. Doc de Browserbase: `timeout` acepta 60..21600 s y "keepAlive ... keep the
 * session alive even after disconnections" (https://docs.browserbase.com/reference/api/create-a-session);
 * el barrido de aprobaciones vencidas cierra la sesion mucho antes en operacion normal, y este
 * timeout queda de techo duro de costo si el worker muriera.
 */
const TAREA_SESSION_TIMEOUT_SECONDS = 45 * 60;

/**
 * Echo para OBSERVAR la salida real del proxy (la API no la expone). El trace de Cloudflare devuelve
 * lineas clave=valor en texto plano; se usan `ip` (egress IP, informativa) y `loc` (pais ISO 3166-1
 * alpha-2, EL criterio de verificacion del pinning). loc=XX significa pais desconocido -> null.
 */
const ECHO_SALIDA_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

/** Referencia de salida del pool gestionado de Browserbase (best-effort, sin IP garantizada). */
const PROXY_REF_POOL = 'browserbase';

/** Prefijo de referencia de salida por proxy EXTERNO propio (IP estatica garantizada por el operador). */
const PROXY_REF_EXTERNO = 'external:';

/**
 * VIEWPORT de la sesion de LOGIN. La vista en vivo de Browserbase renderiza el navegador remoto al
 * tamano del viewport de la SESION, no al del iframe que la embebe: la doc de "Session Live View"
 * (https://docs.browserbase.com/features/session-live-view) no ofrece ningun parametro de escala en
 * la URL, y su propia receta para cambiar el tamano de la vista (el ejemplo "mobile live view") es
 * fijar browserSettings.viewport {width, height} AL CREAR la sesion. Sin viewport explicito, el
 * default del proveedor gobierna lo que el usuario ve y agrandar el iframe con CSS no cambia nada
 * (la leccion del intento previo, que solo agrando el modal). 1280x720 es un viewport desktop
 * estandar con el aspecto (16:9) del iframe del modal: la vista escala ~1:1 y se lee bien.
 */
export const LOGIN_VIEWPORT = { width: 1280, height: 720 } as const;

const IP_REGEX = /^[0-9a-fA-F:.]{3,45}$/;
const PAIS_REGEX = /^[A-Z]{2}$/;

/** Salida de red observada por el echo: IP (informativa) y pais (criterio de pinning). */
interface SalidaEcho {
  egressIp: string | null;
  egressCountry: string | null;
}

/**
 * Parsea el texto del trace de Cloudflare (lineas clave=valor). Tolerante: cualquier cosa que no
 * matchee el formato esperado queda null (y con pais null el handler NO verifica -> aborta).
 */
export function parsearTraceDeSalida(texto: string): SalidaEcho {
  let egressIp: string | null = null;
  let egressCountry: string | null = null;
  for (const linea of texto.split('\n')) {
    const [clave, valor] = linea.split('=', 2);
    if (clave === 'ip' && valor !== undefined && IP_REGEX.test(valor.trim())) {
      egressIp = valor.trim();
    }
    if (clave === 'loc' && valor !== undefined) {
      const pais = valor.trim().toUpperCase();
      // XX = pais desconocido para Cloudflare: no sirve para verificar el pin.
      if (PAIS_REGEX.test(pais) && pais !== 'XX') egressCountry = pais;
    }
  }
  return { egressIp, egressCountry };
}

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

export class NavegadorBrowserbase implements NavegadorRemoto, NavegadorParaTarea {
  private readonly bb: Browserbase;

  constructor(private readonly config: BrowserbaseConfig) {
    this.bb = new Browserbase({ apiKey: config.apiKey });
  }

  /**
   * Resuelve la config de proxies para el `proxyRef` pedido. null = asignar salida nueva (externa si
   * hay proxy propio configurado; si no, el pool). El pool SIEMPRE se pide con la geolocalizacion
   * del PAIS pineado (`proxyCountry`): es best-effort del proveedor (sin cobertura puede enrutar por
   * el pais mas cercano), asi que el llamador VERIFICA el pais observado y aborta si difiere. Un ref
   * pineado que ya no se puede reconstruir (proxy externo cambiado o retirado del entorno) lanza
   * SalidaDeRedNoDisponibleError: JAMAS se degrada en silencio a otra salida.
   */
  private resolverProxy(
    proxyRef: string | null,
    proxyCountry: string,
  ): { proxies: ProxiesParam; proxyRef: string } {
    const externo = this.config.proxyServer
      ? { server: this.config.proxyServer, username: this.config.proxyUsername, password: this.config.proxyPassword }
      : null;

    // Pool gestionado con geolocalizacion fija por pais (doc de Browserbase, seccion Proxies).
    const pool: ProxiesParam = [
      { type: 'browserbase', geolocation: { country: proxyCountry } },
    ];

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
      return { proxies: pool, proxyRef: PROXY_REF_POOL };
    }

    if (proxyRef === PROXY_REF_POOL) {
      return { proxies: pool, proxyRef: PROXY_REF_POOL };
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

  /**
   * OBSERVA la salida de red real (IP + pais) navegando la pagina dada al echo A TRAVES del proxy.
   * Best-effort: si el echo falla, ambos campos quedan null y el handler decide (pais null NO
   * verifica el pin -> aborta; en una conexion nueva el pais observado null tampoco verifica).
   */
  private async observarSalidaEnPagina(cdp: ClienteCdp, sessionId: string): Promise<SalidaEcho> {
    try {
      const carga = cdp.esperarEvento('Page.loadEventFired', sessionId);
      await cdp.enviar('Page.navigate', { url: ECHO_SALIDA_URL }, sessionId);
      await carga;
      const evaluado = await cdp.enviar<{ result?: { value?: unknown } }>(
        'Runtime.evaluate',
        { expression: 'document.body.innerText.trim()', returnByValue: true },
        sessionId,
      );
      const valor = evaluado.result?.value;
      if (typeof valor !== 'string') return { egressIp: null, egressCountry: null };
      return parsearTraceDeSalida(valor);
    } catch {
      return { egressIp: null, egressCountry: null };
    }
  }

  async abrirSesionParaLogin(params: {
    url: string;
    contextoExternoId: string | null;
    proxyRef: string | null;
    proxyCountry: string;
  }): Promise<SesionDeLoginAbierta> {
    const { proxies, proxyRef } = this.resolverProxy(params.proxyRef, params.proxyCountry);

    // Contexto NUEVO para una conexion nueva; el pineado para una reapertura (cookies del proveedor).
    const contextoExternoId =
      params.contextoExternoId ??
      (await this.bb.contexts.create({ projectId: this.config.projectId })).id;

    // keepAlive: la sesion debe SOBREVIVIR a nuestra desconexion CDP para que el humano se loguee.
    // timeout: techo de costo propio (el barrido de 10 min llega antes en operacion normal).
    // viewport: EXPLICITO porque es lo que dimensiona la vista en vivo (ver LOGIN_VIEWPORT).
    const session = await this.bb.sessions.create({
      projectId: this.config.projectId,
      browserSettings: {
        context: { id: contextoExternoId, persist: true },
        viewport: { width: LOGIN_VIEWPORT.width, height: LOGIN_VIEWPORT.height },
      },
      proxies,
      keepAlive: true,
      timeout: SESSION_TIMEOUT_SECONDS,
    });

    let salida: SalidaEcho;
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const sessionId = await this.attachPaginaInicial(cdp);

      // OBSERVAR la salida real (IP + pais) por el echo A TRAVES del proxy (la API no la expone).
      // Best-effort: si el echo falla queda null y el handler decide (pais no verificable -> aborta).
      salida = await this.observarSalidaEnPagina(cdp, sessionId);

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
      egressIp: salida.egressIp,
      egressCountry: salida.egressCountry,
      // Browserbase no expone una referencia de fingerprint propia: el fingerprint/perfil viaja CON
      // el contexto del proveedor, asi que la referencia estable es el contexto mismo.
      fingerprintRef: `contexto:${contextoExternoId}`,
      expiraEn: session.expiresAt ?? null,
    };
  }

  /**
   * Abre la sesion de una TAREA WEB (7.1d): RECONECTA el contexto guardado y FUERZA la salida
   * pineada con la geolocalizacion del pais pineado (proxyRef y proxyCountry OBLIGATORIOS: una
   * tarea jamas sortea salida nueva; resolverProxy lanza SalidaDeRedNoDisponibleError si el pin no
   * es reconstruible). Observa la salida (IP + pais) por el echo (igual que el login) y DEVUELVE sin
   * navegar a ninguna URL del sitio: la verificacion del pin POR PAIS la hace el handler ANTES de
   * permitir navegar. keepAlive:true porque Stagehand se conecta y desconecta por CDP durante la
   * tarea y la sesion debe sobrevivir entre medio.
   */
  async abrirSesionParaTarea(params: {
    contextoExternoId: string;
    proxyRef: string;
    proxyCountry: string;
  }): Promise<SesionDeTareaAbierta> {
    const { proxies } = this.resolverProxy(params.proxyRef, params.proxyCountry);

    const session = await this.bb.sessions.create({
      projectId: this.config.projectId,
      browserSettings: { context: { id: params.contextoExternoId, persist: true } },
      proxies,
      keepAlive: true,
      timeout: TAREA_SESSION_TIMEOUT_SECONDS,
    });

    let salida: SalidaEcho;
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const sessionId = await this.attachPaginaInicial(cdp);
      // OBSERVAR la salida real por el echo, ANTES de tocar el sitio. Best-effort: si falla, el
      // pais queda null y el handler NO puede verificar el pin -> aborta.
      salida = await this.observarSalidaEnPagina(cdp, sessionId);
    } catch (error) {
      cdp.cerrar();
      await this.cerrarSesionSilencioso(session.id);
      throw error;
    }
    cdp.cerrar();

    return {
      sesionExternaId: session.id,
      egressIp: salida.egressIp,
      egressCountry: salida.egressCountry,
    };
  }

  /**
   * Inyecta el contexto de sesion DESCIFRADO (cookies-cdp-v1, el formato que extraerContexto
   * serializo) en la sesion viva via Storage.setCookies (browser-level). El claro no se loguea ni
   * persiste: entra por parametro y muere con este scope.
   */
  async inyectarContexto(sesionExternaId: string, contexto: string): Promise<void> {
    let cookies: unknown[];
    try {
      const parsed = JSON.parse(contexto) as { formato?: unknown; cookies?: unknown };
      if (parsed.formato !== 'cookies-cdp-v1' || !Array.isArray(parsed.cookies)) {
        throw new Error('formato desconocido');
      }
      cookies = parsed.cookies;
    } catch {
      // Sin detalle del blob: el contexto guardado no es usable (corrupto o de otra version).
      throw new Error('el contexto de sesion guardado no es interpretable; reconecta el sitio');
    }
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    if (!session.connectUrl) {
      throw new Error('la sesion de navegador no expone un connect URL (ya no esta corriendo)');
    }
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      await cdp.enviar('Storage.setCookies', { cookies });
    } finally {
      cdp.cerrar();
    }
  }

  /**
   * Navega a `url` y detecta DETERMINISTICAMENTE (sin modelo) una pantalla de login: presencia de un
   * campo de contrasena en el documento. Es el pre-chequeo de caducidad de 7.1d; el resto de la
   * deteccion (login a mitad de tarea) la hace el prompt del motor con su marcador.
   */
  async detectarPantallaDeLogin(sesionExternaId: string, url: string): Promise<boolean> {
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    if (!session.connectUrl) {
      throw new Error('la sesion de navegador no expone un connect URL (ya no esta corriendo)');
    }
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const sessionId = await this.attachPaginaInicial(cdp);
      const carga = cdp.esperarEvento('Page.loadEventFired', sessionId);
      const navegacion = await cdp.enviar<{ errorText?: string }>('Page.navigate', { url }, sessionId);
      if (navegacion.errorText) {
        throw new Error(`el navegador no pudo abrir el sitio: ${navegacion.errorText}`);
      }
      await carga;
      const evaluado = await cdp.enviar<{ result?: { value?: unknown } }>(
        'Runtime.evaluate',
        { expression: "!!document.querySelector('input[type=password]')", returnByValue: true },
        sessionId,
      );
      return evaluado.result?.value === true;
    } finally {
      cdp.cerrar();
    }
  }

  /** Attach (flatten) al primer tab de la sesion y Page.enable; devuelve el sessionId page-level. */
  private async attachPaginaInicial(cdp: ClienteCdp): Promise<string> {
    const { targetInfos } = await cdp.enviar<{ targetInfos: TargetInfo[] }>('Target.getTargets');
    const pagina = targetInfos.find((t) => t.type === 'page');
    if (!pagina) throw new Error('la sesion de navegador no expone ninguna pagina');
    const { sessionId } = await cdp.enviar<{ sessionId: string }>('Target.attachToTarget', {
      targetId: pagina.targetId,
      flatten: true,
    });
    await cdp.enviar('Page.enable', {}, sessionId);
    return sessionId;
  }

  /**
   * Captura un SCREENSHOT PNG (base64) de la pagina actual de la sesion viva, SIN navegarla ni
   * tocarla (Page.captureScreenshot es de solo lectura). Es la evidencia que el humano ve en el
   * modal del checkpoint de aprobacion (7.1e): exactamente lo que el agente tenia en pantalla.
   */
  async capturarPantalla(sesionExternaId: string): Promise<string> {
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    if (!session.connectUrl) {
      throw new Error('la sesion de navegador no expone un connect URL (ya no esta corriendo)');
    }
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const sessionId = await this.attachPaginaInicial(cdp);
      const captura = await cdp.enviar<{ data: string }>(
        'Page.captureScreenshot',
        { format: 'png' },
        sessionId,
      );
      return captura.data;
    } finally {
      cdp.cerrar();
    }
  }

  /**
   * OBSERVA la salida de red actual (IP + pais) de la sesion viva SIN tocar la pagina de la tarea:
   * abre una PESTANA NUEVA (Target.createTarget), navega el echo ahi y la cierra. Es la
   * re-verificacion del pin POR PAIS al REANUDAR un checkpoint (7.1e): navegar la pestana principal
   * al echo destruiria el estado del checkout que la pausa preservo. Best-effort: si el echo falla
   * devuelve nulls (y el handler, sin pais observado, NO verifica -> aborta, igual que en 7.1d).
   */
  async observarSalida(sesionExternaId: string): Promise<SalidaEcho> {
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    if (!session.connectUrl) {
      throw new Error('la sesion de navegador no expone un connect URL (ya no esta corriendo)');
    }
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const { targetId } = await cdp.enviar<{ targetId: string }>('Target.createTarget', {
        url: 'about:blank',
      });
      try {
        const { sessionId } = await cdp.enviar<{ sessionId: string }>('Target.attachToTarget', {
          targetId,
          flatten: true,
        });
        await cdp.enviar('Page.enable', {}, sessionId);
        return await this.observarSalidaEnPagina(cdp, sessionId);
      } finally {
        // La pestana del echo se cierra SIEMPRE: la de la tarea queda intacta.
        await cdp.enviar('Target.closeTarget', { targetId }).catch(() => undefined);
      }
    } catch {
      return { egressIp: null, egressCountry: null };
    } finally {
      cdp.cerrar();
    }
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
