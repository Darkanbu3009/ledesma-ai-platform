import type { ToolDefinition } from '@ledesma-platform/shared';
import type { StoredTool } from '../agents/types.js';
import type { ToolCall, ToolExecutionResult, ToolExecutor } from '../agent/index.js';
import { signWebhookPayload } from './webhook-signature.js';

export const WEBHOOK_LIMITS = {
  timeoutMs: 10_000,
  maxResponseChars: 100_000,
} as const;

/** Hostnames privados/locales rechazados (guarda basica anti-SSRF; no es exhaustiva: la
 * proteccion completa requiere resolver DNS y filtrar rangos IP, TODO etapa de seguridad). */
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
 * serializa el body. NUNCA lanza: todo fallo regresa isError: true. */
export function createWebhookExecutor(
  tools: StoredTool[],
  secret: string,
  fetchImpl: typeof fetch = fetch,
): ToolExecutor {
  const byName = new Map(tools.map((t) => [t.name, t]));

  return async (call: ToolCall, signal?: AbortSignal): Promise<ToolExecutionResult> => {
    const tool = byName.get(call.name);
    if (!tool) return { content: `Unknown tool: ${call.name}`, isError: true };
    if (isForbiddenWebhookUrl(tool.url)) {
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
        body,
      });
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
      const aborted = error instanceof Error && error.name === 'AbortError';
      return {
        content: aborted ? `Tool ${call.name} webhook timed out` : `Tool ${call.name} webhook failed`,
        isError: true,
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  };
}
