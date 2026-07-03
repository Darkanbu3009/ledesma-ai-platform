import OpenAI from 'openai';
import type {
  ModelProvider,
  ProviderStreamEvent,
  ProviderStreamInput,
} from '@ledesma-platform/shared';
import { mapRequestToOpenAI } from '../openai/map-request.js';
import { translateOpenAIStream } from '../openai/translate-stream.js';
import { toProviderError } from '../errors.js';
import { resolvesToForbiddenIp, type LookupFn } from '../../tools/ip-guard.js';

/**
 * Guarda anti-SSRF del egress del proveedor: valida la baseUrl BYOK ANTES de instanciar el cliente y
 * emitir cualquier peticion. Reusa la MISMA primitiva que ya protege las webhook tools (ip-guard):
 *  (1) ESQUEMA: exige `https://`. La apiKey viaja como `Authorization: Bearer` hacia esa baseUrl y
 *      JAMAS debe egresar en claro por `http://` (cierra H-03 de la auditoria 03).
 *  (2) HOST: corre `resolvesToForbiddenIp` sobre el hostname; rechaza loopback/privadas/link-local y
 *      el endpoint de metadata de nube (169.254.169.254) tal como en los webhooks (cierra H-01 de las
 *      auditorias 01 y 07). Fail-closed: un host que no resuelve (o resuelve a una IP prohibida) se
 *      rechaza.
 * El mensaje de rechazo es GENERICO y el mismo para cualquier host interno: no filtra detalles de red
 * ni sirve de oraculo de puertos (la conexion nunca se abre). Se lanza como Error plano (no
 * ProviderError) y FUERA del try, igual que la guarda de baseUrl ausente, para que no se emita nada.
 *
 * Solo valida el HOST INICIAL de la baseUrl. El salto por redireccion 3xx (que evadiria esta guarda
 * apuntando a un host interno) lo cierra `makeNoRedirectFetch` mas abajo, no esta funcion.
 *
 * Riesgo residual TOCTOU (DNS-rebinding): el DNS puede re-resolverse a otra IP entre este check y el
 * fetch del SDK; mitigarlo por completo requeriria fijar la conexion a la IP ya validada (futuro). Es
 * la MISMA limitacion conocida y documentada del ejecutor de webhooks (ver tools/webhook-tools.ts).
 */
async function assertBaseUrlAllowed(baseURL: string, lookupFn?: LookupFn): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new Error('openai-compatible provider baseUrl is not a valid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('openai-compatible provider baseUrl must use https');
  }
  if (await resolvesToForbiddenIp(parsed.hostname, lookupFn)) {
    throw new Error('openai-compatible provider baseUrl is not allowed');
  }
}

/**
 * Envuelve el fetch del SDK para que NO siga redirecciones (`redirect: 'manual'`) y rechace cualquier
 * 3xx. Sin esto, la guarda de baseUrl (que solo valida el host INICIAL) seria evadible: un host
 * publico valido podria responder 302/307 con `Location` hacia un destino interno
 * (169.254.169.254 metadata, 10.x, 127.0.0.1, [::1]) y el fetch global (undici) seguiria el salto
 * hasta 20 veces SIN revalidar el destino contra ip-guard, abriendo la conexion interna. Es el MISMO
 * control que ya aplica el POST firmado de las tools (tools/signed-tool-fetch.ts: redirect 'manual' +
 * rechazo de 3xx); un proveedor openai-compatible legitimo responde 200 al POST de /chat/completions,
 * no redirige, asi que no se pierde funcionalidad. baseFetch es inyectable para tests.
 */
export function makeNoRedirectFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, { ...init, redirect: 'manual' });
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw new Error('openai-compatible provider baseUrl redirected to another host, which is not allowed');
    }
    return response;
  };
}

/**
 * Adaptador OpenAI-compatible. Mismo protocolo que OpenAI (Chat Completions, function calling +
 * streaming) apuntando a un endpoint configurable via baseURL. Cubre modelos open source
 * autohospedados (vLLM, Ollama, TGI) y agregadores/proveedores compatibles (OpenRouter, Together,
 * Groq, etc.). La plataforma NO hospeda modelos: el cliente/tercero corre el endpoint.
 * BYOK: key y baseURL viajan por llamada; NO se guardan ni se loguean.
 *
 * La baseURL es controlable por el cliente, asi que pasa por la guarda anti-SSRF (ip-guard) ANTES de
 * conectar. Como este es el punto COMUN por el que bajan los tres caminos de ejecucion
 * (POST /v1/agent/run, POST /v1/run/:agentId y el worker autonomo -> runAgent -> runModel -> este
 * provider), un solo control aqui cubre a los tres.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  public readonly id = 'openai-compatible';

  /**
   * lookupFn: resolucion DNS inyectable para la guarda anti-SSRF (tests). En produccion el factory
   * construye el provider sin argumentos y ip-guard usa `dns.lookup` real.
   */
  constructor(private readonly lookupFn?: LookupFn) {}

  async *stream(input: ProviderStreamInput): AsyncIterable<ProviderStreamEvent> {
    const baseURL = input.credentials.baseUrl;
    if (baseURL === undefined || baseURL.trim() === '') {
      throw new Error('openai-compatible provider requires credentials.baseUrl');
    }

    // Anti-SSRF: solo https y host no privado/metadata. Se valida antes de instanciar el cliente, asi
    // un baseUrl interno nunca genera una peticion saliente. Un fix aqui cubre los tres caminos.
    await assertBaseUrlAllowed(baseURL, this.lookupFn);

    try {
      // fetch endurecido: no sigue redirecciones (un 3xx hacia un host interno evadiria la guarda de
      // arriba, que solo valida el host inicial). Mismo control que el POST firmado de las tools.
      const client = new OpenAI({
        apiKey: input.credentials.apiKey,
        baseURL,
        fetch: makeNoRedirectFetch(),
      });
      const params = mapRequestToOpenAI(input.request);

      const stream = await client.chat.completions.create(params, { signal: input.signal });

      yield* translateOpenAIStream(stream);
    } catch (error) {
      throw toProviderError(error, this.id);
    }
  }
}
