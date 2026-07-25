import Browserbase from '@browserbasehq/sdk';
import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';
import { ClienteCdp } from './cdp.js';
import { SalidaDeRedNoDisponibleError } from './sitios.js';
import type { NavegadorRemoto, SesionDeLoginAbierta } from './sitios.js';
import type { NavegadorParaTarea, SesionDeTareaAbierta } from './tarea-web.js';
import type { CampoDeLaPagina } from './verificacion.js';
import type {
  InstruccionDePaso,
  NavegadorDeterminista,
  ResultadoPasoDeterminista,
} from './ejecutor-receta.js';
import {
  EXPRESION_VACIAR_CAMPO_ENFOCADO,
  expresionLeerEstrategias,
  expresionResolverElemento,
  leerElementoResuelto,
  parsearCombinacionDeTeclas,
  sanearEstrategias,
  type PuntoDeLaPagina,
  type ReferenciaDeElemento,
} from './localizacion.js';

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

/** Tope del texto visible que se lee de una pagina (evidencia de apoyo, no un scrape). */
const MAX_TEXTO_VISIBLE_CHARS = 4000;

/** Nombre del mundo aislado donde corre la lectura de la verificacion (ver evaluarEnLaPagina). */
const MUNDO_DE_VERIFICACION = 'ledesma-verificacion';

/**
 * Espera tras una accion determinista (ms) para que el sitio reaccione (render, XHR, navegacion)
 * antes del paso siguiente. Corta a proposito: la receta repite un flujo que ya funciono, no explora.
 */
const PAUSA_TRAS_ACCION_MS = 400;

/** Tope de espera de la carga tras una navegacion de receta. Vencido, se sigue igual (best-effort). */
const ESPERA_DE_CARGA_MS = 10_000;

const EXPRESION_TEXTO_BODY =
  `(() => (document.body ? String(document.body.innerText || '').slice(0, ${MAX_TEXTO_VISIBLE_CHARS}) : ''))()`;

/**
 * Expresion de SOLO LECTURA que recolecta los campos del formulario con su valor ACTUAL y el
 * contexto que los identifica. Va como String.raw para que las expresiones regulares de adentro
 * lleguen intactas al navegador.
 *
 * Decisiones que importan para la seguridad de la verificacion:
 *  - input[type=password] se OMITE entero: su valor no hace falta para verificar nada.
 *  - los campos OCULTOS y los de tipo hidden SI se incluyen: un destinatario o un monto colado en un
 *    campo invisible es precisamente lo que hay que detectar.
 *  - contenteditable se incluye porque los redactores de correo modernos no usan <textarea>.
 *  - todo va acotado (60 campos, 200 caracteres por valor y por contexto): la verificacion compara
 *    datos concretos, no vuelca la pagina.
 */
const EXPRESION_LEER_CAMPOS = String.raw`(() => {
  const MAX_CAMPOS = 60, MAX_VALOR = 200, MAX_CONTEXTO = 200;
  const salida = [];
  const nodos = document.querySelectorAll('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
  for (const nodo of nodos) {
    if (salida.length >= MAX_CAMPOS) break;
    const tag = (nodo.tagName || '').toLowerCase();
    const tipo = (nodo.getAttribute('type') || '').toLowerCase();
    if (tipo === 'password') continue;
    let valor = '';
    if (tag === 'select') {
      const opcion = nodo.selectedOptions && nodo.selectedOptions[0];
      valor = opcion ? (opcion.textContent || opcion.value || '') : (nodo.value || '');
    } else if (tag === 'input' || tag === 'textarea') {
      valor = (tipo === 'checkbox' || tipo === 'radio')
        ? (nodo.checked ? (nodo.value || 'on') : '')
        : (nodo.value || '');
    } else {
      valor = nodo.innerText || nodo.textContent || '';
    }
    valor = String(valor).trim();
    if (valor === '') continue;
    let etiqueta = '';
    try {
      const id = nodo.getAttribute('id');
      if (id && window.CSS && window.CSS.escape) {
        const asociada = document.querySelector('label[for="' + window.CSS.escape(id) + '"]');
        if (asociada) etiqueta = asociada.innerText || asociada.textContent || '';
      }
      if (!etiqueta && nodo.closest) {
        const contenedora = nodo.closest('label');
        if (contenedora) etiqueta = contenedora.innerText || contenedora.textContent || '';
      }
    } catch (e) {
      etiqueta = '';
    }
    const contexto = [
      tag,
      tipo,
      nodo.getAttribute('name') || '',
      nodo.getAttribute('id') || '',
      nodo.getAttribute('placeholder') || '',
      nodo.getAttribute('aria-label') || '',
      etiqueta,
    ].join(' ').replace(/\s+/g, ' ').trim();
    salida.push({ contexto: contexto.slice(0, MAX_CONTEXTO), valor: valor.slice(0, MAX_VALOR) });
  }
  return JSON.stringify(salida);
})()`;

/** Pausa acotada (los pasos de una receta necesitan dejar respirar al sitio entre acciones). */
function pausar(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * MANDO minimo sobre una pagina ya adherida por CDP: evaluar en el MUNDO AISLADO, disparar entrada
 * REAL (Input.*) y navegar. Existe para que un paso de receta gaste UNA conexion CDP en vez de una
 * por primitiva, y para que toda la ejecucion determinista comparta un solo lugar donde se decide
 * como se toca la pagina.
 *
 * POR QUE ENTRADA REAL Y NO `element.click()`: un sitio puede distinguir un evento sintetico de uno
 * del usuario (isTrusted) y muchos formularios reales no reaccionan al sintetico. Input.* genera los
 * mismos eventos que una persona, que es lo que hace que repetir el flujo aprendido funcione.
 *
 * POR QUE MUNDO AISLADO: identico motivo que la verificacion (ver evaluarEnLaPagina). El JavaScript
 * del sitio no puede parchear lo que la resolucion del elemento ve, asi que no puede hacer que la
 * receta actue sobre un boton distinto del que aprendio.
 */
class PaginaCdp {
  constructor(
    private readonly cdp: ClienteCdp,
    private readonly sessionId: string,
  ) {}

  /** Evalua una expresion en un mundo aislado nuevo y devuelve su valor si es texto. */
  async evaluar(expresion: string): Promise<string | null> {
    const { frameTree } = await this.cdp.enviar<{ frameTree: { frame: { id: string } } }>(
      'Page.getFrameTree',
      {},
      this.sessionId,
    );
    const { executionContextId } = await this.cdp.enviar<{ executionContextId: number }>(
      'Page.createIsolatedWorld',
      { frameId: frameTree.frame.id, worldName: MUNDO_DE_VERIFICACION },
      this.sessionId,
    );
    const evaluado = await this.cdp.enviar<{ result?: { value?: unknown } }>(
      'Runtime.evaluate',
      { expression: expresion, returnByValue: true, contextId: executionContextId },
      this.sessionId,
    );
    const valor = evaluado.result?.value;
    return typeof valor === 'string' ? valor : null;
  }

  /** Click REAL (mover, presionar, soltar) en el punto dado. */
  async click(punto: PuntoDeLaPagina): Promise<void> {
    const base = { x: punto.x, y: punto.y, button: 'left', clickCount: 1 };
    await this.cdp.enviar('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' }, this.sessionId);
    await this.cdp.enviar('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' }, this.sessionId);
    await this.cdp.enviar('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' }, this.sessionId);
  }

  /** Pulsacion REAL de una tecla (down + up), con sus modificadores. */
  async pulsar(pulsacion: {
    key: string;
    windowsVirtualKeyCode: number;
    modifiers: number;
    text: string | null;
  }): Promise<void> {
    const base = {
      key: pulsacion.key,
      windowsVirtualKeyCode: pulsacion.windowsVirtualKeyCode,
      nativeVirtualKeyCode: pulsacion.windowsVirtualKeyCode,
      modifiers: pulsacion.modifiers,
      ...(pulsacion.text !== null ? { text: pulsacion.text } : {}),
    };
    await this.cdp.enviar('Input.dispatchKeyEvent', { ...base, type: 'keyDown' }, this.sessionId);
    await this.cdp.enviar('Input.dispatchKeyEvent', { ...base, type: 'keyUp' }, this.sessionId);
  }

  /** Inserta texto en el elemento enfocado como lo haria el teclado (dispara los eventos de input). */
  async insertarTexto(texto: string): Promise<void> {
    await this.cdp.enviar('Input.insertText', { text: texto }, this.sessionId);
  }

  /**
   * Navega y espera la carga. La espera es BEST-EFFORT: vencida, se sigue igual (una pagina que
   * nunca dispara load no debe colgar la receta; el paso siguiente fallara en localizar y escalara).
   */
  async navegar(url: string): Promise<void> {
    const carga = this.cdp.esperarEvento('Page.loadEventFired', this.sessionId).catch(() => undefined);
    const navegacion = await this.cdp.enviar<{ errorText?: string }>(
      'Page.navigate',
      { url },
      this.sessionId,
    );
    if (navegacion.errorText) {
      throw new Error(`el navegador no pudo abrir la pagina: ${navegacion.errorText}`);
    }
    await Promise.race([carga, pausar(ESPERA_DE_CARGA_MS)]);
  }
}

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

export class NavegadorBrowserbase
  implements NavegadorRemoto, NavegadorParaTarea, NavegadorDeterminista
{
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

  /**
   * LEE los valores ACTUALES de los campos del formulario de la pagina, con el contexto que los
   * identifica (name, id, tipo, placeholder, aria-label y la etiqueta asociada). Es la lectura
   * DETERMINISTA sobre la que se hace la verificacion previa a ejecutar una accion irreversible: lo
   * que se compara contra el objetivo del usuario es lo que el agente TECLEO O ELIGIO, no lo que la
   * pagina dice de si misma.
   *
   * Es de SOLO LECTURA (Runtime.evaluate sobre el DOM, sin tocar la pagina) y JAMAS lee un campo de
   * contrasena: su valor no se necesita para verificar nada y no debe salir del navegador. Incluye
   * los campos OCULTOS a proposito: un destinatario agregado en un input hidden es exactamente el
   * caso que la verificacion tiene que atrapar.
   */
  async leerCamposDeLaPagina(sesionExternaId: string): Promise<CampoDeLaPagina[]> {
    const crudo = await this.evaluarEnLaPagina(sesionExternaId, EXPRESION_LEER_CAMPOS);
    if (crudo === null) return [];
    try {
      const parsed: unknown = JSON.parse(crudo);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((item): CampoDeLaPagina[] => {
        if (typeof item !== 'object' || item === null) return [];
        const { contexto, valor } = item as { contexto?: unknown; valor?: unknown };
        if (typeof contexto !== 'string' || typeof valor !== 'string') return [];
        return [{ contexto, valor }];
      });
    } catch {
      return [];
    }
  }

  /**
   * LEE el TEXTO VISIBLE de la pagina (o del elemento que indique `selector`), acotado. Complementa
   * la lectura de campos para los datos que un sitio muestra como texto y no como campo (el total de
   * un checkout, el nombre del producto). Evidencia mas DEBIL que un valor de campo: lo escribe el
   * sitio, asi que la verificacion solo lo usa como ultimo recurso.
   */
  async leerTextoVisible(sesionExternaId: string, selector?: string): Promise<string> {
    const expresion =
      selector === undefined
        ? EXPRESION_TEXTO_BODY
        : `(() => { const el = document.querySelector(${JSON.stringify(selector)}); ` +
          `return el ? String(el.innerText || el.textContent || '').slice(0, ${MAX_TEXTO_VISIBLE_CHARS}) : ''; })()`;
    return (await this.evaluarEnLaPagina(sesionExternaId, expresion)) ?? '';
  }

  /**
   * Evalua una expresion de SOLO LECTURA sobre la pagina actual y devuelve su valor si es texto.
   *
   * MUNDO AISLADO (Page.createIsolatedWorld), no el mundo de la pagina: es lo que hace confiable a la
   * verificacion determinista. En el mundo principal, el JavaScript del sitio (o el inyectado en el)
   * puede redefinir lo que la lectura ve -- un getter sobre HTMLInputElement.prototype.value, un
   * querySelectorAll propio, un JSON.stringify parcheado -- y devolver el valor que el usuario pidio
   * mientras el formulario lleva otro. Un mundo aislado comparte el MISMO DOM pero tiene sus propios
   * objetos globales y sus propios wrappers de los nodos, asi que ningun parche hecho por la pagina
   * lo alcanza (es el mismo mecanismo con el que las extensiones leen paginas hostiles).
   *
   * Best-effort: cualquier fallo (sesion caida, evaluacion rechazada) devuelve null y el llamador
   * decide; en la verificacion, no poder leer NUNCA autoriza a ejecutar.
   */
  private async evaluarEnLaPagina(sesionExternaId: string, expresion: string): Promise<string | null> {
    return this.conPaginaCdp(sesionExternaId, (pagina) => pagina.evaluar(expresion));
  }

  /**
   * Abre UNA conexion CDP contra la sesion, se adhiere a la pagina y le entrega a `fn` un pequeno
   * mando (evaluar en el mundo aislado, disparar entrada real, navegar). Existe para que un paso de
   * receta (resolver el elemento, actuar y releer sus estrategias) gaste UNA sola conexion en vez de
   * una por primitiva.
   */
  private async conPaginaCdp<T>(
    sesionExternaId: string,
    fn: (pagina: PaginaCdp) => Promise<T>,
  ): Promise<T> {
    const session = await this.bb.sessions.retrieve(sesionExternaId);
    if (!session.connectUrl) {
      throw new Error('la sesion de navegador no expone un connect URL (ya no esta corriendo)');
    }
    const cdp = await ClienteCdp.conectar(session.connectUrl);
    try {
      const sessionId = await this.attachPaginaInicial(cdp);
      return await fn(new PaginaCdp(cdp, sessionId));
    } finally {
      cdp.cerrar();
    }
  }

  /**
   * LEE del DOM las formas estables de volver a encontrar un elemento (CAMBIO 1). Solo lectura, en
   * el mundo aislado. Best-effort: si el elemento ya no esta (un click que navego), devuelve lista
   * vacia y ese paso simplemente no se podra promover a receta.
   */
  async leerEstrategiasDeElemento(
    sesionExternaId: string,
    referencia: ReferenciaDeElemento,
  ): Promise<EstrategiaLocalizacion[]> {
    const crudo = await this.evaluarEnLaPagina(
      sesionExternaId,
      expresionLeerEstrategias(referencia),
    );
    return crudo === null || crudo === '' ? [] : sanearEstrategias(crudo);
  }

  /**
   * EJECUTA UN PASO de una receta con primitivas de bajo nivel, SIN modelo (CAMBIO 4). Resuelve el
   * elemento probando las estrategias en orden, actua con eventos de entrada REALES (los mismos que
   * genera una persona: un sitio que exige eventos confiables funciona igual) y devuelve las
   * estrategias que el elemento tiene ahora, para la auto reparacion.
   *
   * Nunca lanza por un paso que no resolvio: eso es un desenlace normal ('no_localizado') que el
   * ejecutor convierte en escalada. Solo un fallo de la propia sesion se propaga.
   */
  async ejecutarPasoDeterminista(
    sesionExternaId: string,
    instruccion: InstruccionDePaso,
  ): Promise<ResultadoPasoDeterminista> {
    if (instruccion.accion === 'esperar') {
      await pausar(Math.min(instruccion.esperaMs ?? 0, ESPERA_DE_CARGA_MS));
      return { estado: 'ok', estrategias: [], detalle: null };
    }
    return this.conPaginaCdp(sesionExternaId, async (pagina) => {
      if (instruccion.accion === 'navegar') {
        if (instruccion.url === null) {
          return { estado: 'fallo', estrategias: [], detalle: 'navegacion sin url' } as const;
        }
        await pagina.navegar(instruccion.url);
        return { estado: 'ok', estrategias: [], detalle: null } as const;
      }

      const crudo = await pagina.evaluar(expresionResolverElemento(instruccion.estrategias));
      const elemento = crudo === null || crudo === '' ? null : leerElementoResuelto(crudo);
      if (elemento === null) {
        return {
          estado: 'no_localizado',
          estrategias: [],
          detalle: 'ninguna estrategia resolvio el elemento',
        } as const;
      }

      if (instruccion.accion === 'click') {
        await pagina.click(elemento);
        await pausar(PAUSA_TRAS_ACCION_MS);
        return { estado: 'ok', estrategias: elemento.estrategias, detalle: null } as const;
      }

      if (instruccion.accion === 'escribir') {
        if (instruccion.texto === null) {
          return { estado: 'fallo', estrategias: [], detalle: 'escritura sin texto' } as const;
        }
        // Click para enfocar, seleccionar lo que hubiera y sustituirlo: un campo prellenado por el
        // sitio no debe quedar concatenado con el valor nuevo.
        await pagina.click(elemento);
        await pagina.evaluar(EXPRESION_VACIAR_CAMPO_ENFOCADO);
        await pagina.pulsar({ key: 'Delete', windowsVirtualKeyCode: 46, modifiers: 0, text: null });
        await pagina.insertarTexto(instruccion.texto);
        await pausar(PAUSA_TRAS_ACCION_MS);
        return { estado: 'ok', estrategias: elemento.estrategias, detalle: null } as const;
      }

      const pulsacion =
        instruccion.teclas === null ? null : parsearCombinacionDeTeclas(instruccion.teclas);
      if (pulsacion === null) {
        return { estado: 'fallo', estrategias: [], detalle: 'combinacion de teclas no admitida' } as const;
      }
      await pagina.click(elemento);
      await pagina.pulsar(pulsacion);
      await pausar(PAUSA_TRAS_ACCION_MS);
      return { estado: 'ok', estrategias: elemento.estrategias, detalle: null } as const;
    });
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
