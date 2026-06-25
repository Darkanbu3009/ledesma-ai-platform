import type { ToolDefinition } from '@ledesma-platform/shared';
import type { StoredTool } from '../agents/types.js';
import type { ToolCall, ToolExecutionResult, ToolExecutor } from '../agent/index.js';
import { resolvesToForbiddenIp, type LookupFn } from './ip-guard.js';
import { performSignedToolPost, SIGNED_POST_LIMITS } from './signed-tool-fetch.js';

/** Misma cota que el POST firmado compartido (una sola fuente de verdad). */
export const WEBHOOK_LIMITS = SIGNED_POST_LIMITS;

/** Hostnames privados/locales rechazados (guarda rapida por nombre; se complementa con la
 * validacion de IPs resueltas por DNS de ip-guard.ts, ver createWebhookExecutor). */
export function isForbiddenWebhookUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }
  if (parsed.protocol !== 'https:') return true;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.railway.internal')) return true;
  // IP literales privadas comunes
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)) return true;
  return false;
}

/** Definiciones para el modelo, directo del JSON Schema guardado. */
export function storedToolsToDefinitions(tools: StoredTool[]): ToolDefinition[] {
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

/** Ejecutor por webhook: POST { tool, input } a la url de la tool, firmado con el secreto del
 * agente (HMAC-SHA256 de "{timestamp}.{body}" en x-ledesma-timestamp / x-ledesma-signature).
 * Respuesta esperada { content: string, isError?: boolean }; si no hay content string, se
 * serializa el body. No sigue redirecciones (3xx regresa isError). NUNCA lanza: todo fallo
 * regresa isError: true con el detalle (nombre y mensaje del error; el secreto y los headers
 * jamas se incluyen) y se reporta via deps.warn (console.warn por default). Sin secreto
 * (undefined/null/'') ninguna ejecucion toca la red: regresa webhook secret missing.
 * deps.lookupFn permite inyectar la resolucion DNS en tests. */
export function createWebhookExecutor(
  tools: StoredTool[],
  secret: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
  deps: { lookupFn?: LookupFn; warn?: (message: string) => void } = {},
): ToolExecutor {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const warn = deps.warn ?? ((message: string) => console.warn(message));

  return async (call: ToolCall, signal?: AbortSignal): Promise<ToolExecutionResult> => {
    // Guarda del secreto: sin el no hay firma posible. Antes un undefined (p.ej. fila de DB sin
    // webhook_secret) llegaba hasta createHmac, que lanzaba un TypeError tragado por el catch.
    if (secret === undefined || secret === null || secret === '') {
      warn(`webhook tool ${call.name} cannot run: webhook secret missing`);
      return { content: `Tool ${call.name} cannot run: webhook secret missing`, isError: true };
    }
    const tool = byName.get(call.name);
    if (!tool) return { content: `Unknown tool: ${call.name}`, isError: true };
    if (isForbiddenWebhookUrl(tool.url)) {
      return { content: `Tool ${call.name} has a forbidden webhook URL`, isError: true };
    }
    // Anti-SSRF: rechazar si el hostname resuelve a IPs privadas/reservadas. Mismo mensaje
    // generico que la guarda por hostname para no filtrar detalles de red. Riesgo residual
    // TOCTOU: el DNS puede re-resolverse a otra IP entre este check y el fetch; mitigarlo
    // por completo requeriria fijar la conexion a la IP ya validada (futuro).
    if (await resolvesToForbiddenIp(new URL(tool.url).hostname, deps.lookupFn)) {
      return { content: `Tool ${call.name} has a forbidden webhook URL`, isError: true };
    }

    // Mecanica firma/fetch compartida con las tools nativas (channel 'webhook' conserva los
    // mensajes del flujo de cliente). El secreto del agente solo viaja como firma derivada.
    return performSignedToolPost(tool.url, secret, call, {
      channel: 'webhook',
      warn,
      fetchImpl,
      signal,
    });
  };
}
