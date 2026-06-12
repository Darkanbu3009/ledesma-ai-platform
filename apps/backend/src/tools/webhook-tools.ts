import type { ToolDefinition } from '@ledesma-platform/shared';
import type { StoredTool } from '../agents/types.js';
import type { ToolCall, ToolExecutionResult, ToolExecutor } from '../agent/index.js';
import { resolvesToForbiddenIp, type LookupFn } from './ip-guard.js';
import { signWebhookPayload } from './webhook-signature.js';

export const WEBHOOK_LIMITS = {
  timeoutMs: 10_000,
  maxResponseChars: 100_000,
} as const;

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
 * jamas se incluyen) y se reporta via deps.warn (console.warn por default). deps.lookupFn
 * permite inyectar la resolucion DNS en tests. */
export function createWebhookExecutor(
  tools: StoredTool[],
  secret: string,
  fetchImpl: typeof fetch = fetch,
  deps: { lookupFn?: LookupFn; warn?: (message: string) => void } = {},
): ToolExecutor {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const warn = deps.warn ?? ((message: string) => console.warn(message));

  return async (call: ToolCall, signal?: AbortSignal): Promise<ToolExecutionResult> => {
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_LIMITS.timeoutMs);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener('abort', onOuterAbort);

    try {
      // El body enviado es EXACTAMENTE la cadena firmada: el cliente verifica con su raw body.
      const body = JSON.stringify({ tool: call.name, input: call.input });
      const ts = Math.floor(Date.now() / 1000);
      const response = await fetchImpl(tool.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ledesma-timestamp': String(ts),
          'x-ledesma-signature': `v1=${signWebhookPayload(body, ts, secret)}`,
        },
        signal: controller.signal,
        redirect: 'manual',
        body,
      });
      // No seguimos redirecciones: un redirect podria rebotar hacia una IP interna.
      if (response.status >= 300 && response.status < 400) {
        return { content: `Tool ${call.name} webhook returned a redirect, which is not allowed`, isError: true };
      }
      const text = await response.text();
      const clipped = text.length > WEBHOOK_LIMITS.maxResponseChars
        ? text.slice(0, WEBHOOK_LIMITS.maxResponseChars)
        : text;
      if (!response.ok) {
        return { content: `Tool ${call.name} webhook returned ${response.status}`, isError: true };
      }
      try {
        const body = JSON.parse(clipped) as { content?: unknown; isError?: unknown };
        if (typeof body.content === 'string') {
          return { content: body.content, isError: body.isError === true };
        }
        return { content: clipped, isError: body.isError === true };
      } catch {
        return { content: clipped, isError: false };
      }
    } catch (error) {
      // Nada de fallos opacos: el content y el log llevan el nombre y mensaje del error (nunca
      // el secreto, headers o body; un TypeError de crypto/fetch no contiene esos valores).
      const aborted = error instanceof Error && error.name === 'AbortError';
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
      warn(`webhook tool ${call.name} ${aborted ? 'timed out' : `failed: ${detail}`}`);
      return {
        content: aborted
          ? `Tool ${call.name} webhook timed out`
          : `Tool ${call.name} webhook failed: ${detail}`,
        isError: true,
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  };
}
