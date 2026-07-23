/**
 * Resolucion del connectUrl de la sesion viva en Browserbase, con una UNICA llamada REST cruda
 * (GET /v1/sessions/{id}) en vez de arrastrar el SDK entero: superficie minima, auditable de un vistazo.
 *
 * El connectUrl embebe el signing key de la sesion (acceso CDP total): por eso este servicio es
 * pequeno y aislado. JAMAS se loguea ni se devuelve; solo se usa para abrir el WebSocket CDP y muere
 * con el scope. Los errores de este modulo no incluyen la URL ni la API key.
 */

const BROWSERBASE_API = 'https://api.browserbase.com';

/** Techo de espera del connectUrl: sin esto, un proveedor lento deja el canal a medio abrir. */
const FETCH_TIMEOUT_MS = 10_000;

export interface BrowserbaseRef {
  apiKey: string;
  projectId: string;
}

interface SesionRemota {
  connectUrl?: unknown;
  status?: unknown;
}

/**
 * Pide el connectUrl de una sesion viva por su id. Valida que la sesion siga corriendo y que el
 * connectUrl tenga forma de WebSocket. Lanza (con mensaje sin secretos) si la sesion no existe, ya no
 * corre, o el proveedor no devuelve un connectUrl utilizable: el llamador cierra el canal.
 */
export async function obtenerConnectUrl(ref: BrowserbaseRef, sesionExternaId: string): Promise<string> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${BROWSERBASE_API}/v1/sessions/${encodeURIComponent(sesionExternaId)}`, {
      method: 'GET',
      headers: { 'X-BB-API-Key': ref.apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new Error('no se pudo contactar al proveedor de navegador');
  }
  if (!respuesta.ok) {
    throw new Error(`el proveedor de navegador respondio ${respuesta.status} al resolver la sesion`);
  }
  const cuerpo = (await respuesta.json().catch(() => null)) as SesionRemota | null;
  if (cuerpo === null) {
    throw new Error('respuesta ilegible del proveedor de navegador');
  }
  if (typeof cuerpo.status === 'string' && cuerpo.status !== 'RUNNING') {
    throw new Error('la sesion de navegador ya no esta corriendo');
  }
  const connectUrl = cuerpo.connectUrl;
  if (typeof connectUrl !== 'string' || !(connectUrl.startsWith('wss://') || connectUrl.startsWith('ws://'))) {
    throw new Error('la sesion de navegador no expone un connectUrl utilizable');
  }
  return connectUrl;
}
