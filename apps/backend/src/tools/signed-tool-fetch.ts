import type { ToolCall, ToolExecutionResult } from '../agent/index.js';
import { signWebhookPayload } from './webhook-signature.js';

/** Cotas compartidas por el POST firmado de tools (webhook de cliente y nativas de plataforma). */
export const SIGNED_POST_LIMITS = {
  timeoutMs: 10_000,
  maxResponseChars: 100_000,
} as const;

export interface SignedToolPostOptions {
  /** Palabra usada en los mensajes de error/advertencia: 'webhook' (cliente) o 'native'
   * (plataforma). Mantener 'webhook' reproduce textualmente los mensajes del ejecutor de cliente. */
  channel: string;
  /** Reporta cada fallo con su detalle (nombre y mensaje del error); jamas recibe el secreto. */
  warn: (message: string) => void;
  /** fetch inyectable para tests. */
  fetchImpl: typeof fetch;
  /** Signal externo del request: aborta el fetch si la corrida se cancela. */
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResponseChars?: number;
}

/**
 * POST firmado { tool, input } a `url`, con la MISMA mecanica para webhooks de cliente y tools
 * nativas de plataforma. El body es EXACTAMENTE la cadena firmada (el receptor verifica con su
 * raw body); la firma es HMAC-SHA256 de "{timestamp}.{body}" en x-ledesma-timestamp /
 * x-ledesma-signature (v1=...). No sigue redirecciones (un 3xx regresa isError, para que un
 * redirect no rebote hacia una IP interna), recorta la respuesta a maxResponseChars y parsea
 * { content, isError }. NUNCA lanza: todo fallo regresa { content, isError: true } con el detalle
 * (nombre y mensaje del error) y se reporta via warn. El secreto JAMAS aparece en el content, los
 * headers o el warn: solo viaja la firma derivada.
 */
export async function performSignedToolPost(
  url: string,
  secret: string,
  call: ToolCall,
  options: SignedToolPostOptions,
): Promise<ToolExecutionResult> {
  const { channel, warn, fetchImpl, signal } = options;
  const timeoutMs = options.timeoutMs ?? SIGNED_POST_LIMITS.timeoutMs;
  const maxResponseChars = options.maxResponseChars ?? SIGNED_POST_LIMITS.maxResponseChars;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);

  try {
    const body = JSON.stringify({ tool: call.name, input: call.input });
    const ts = Math.floor(Date.now() / 1000);
    const response = await fetchImpl(url, {
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
    if (response.status >= 300 && response.status < 400) {
      return { content: `Tool ${call.name} ${channel} returned a redirect, which is not allowed`, isError: true };
    }
    const text = await response.text();
    const clipped = text.length > maxResponseChars ? text.slice(0, maxResponseChars) : text;
    if (!response.ok) {
      return { content: `Tool ${call.name} ${channel} returned ${response.status}`, isError: true };
    }
    try {
      const parsed = JSON.parse(clipped) as { content?: unknown; isError?: unknown };
      if (typeof parsed.content === 'string') {
        return { content: parsed.content, isError: parsed.isError === true };
      }
      return { content: clipped, isError: parsed.isError === true };
    } catch {
      return { content: clipped, isError: false };
    }
  } catch (error) {
    // Nada de fallos opacos: el content y el log llevan el nombre y mensaje del error (nunca el
    // secreto, headers o body; un TypeError de crypto/fetch no contiene esos valores).
    const aborted = error instanceof Error && error.name === 'AbortError';
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
    warn(`${channel} tool ${call.name} ${aborted ? 'timed out' : `failed: ${detail}`}`);
    return {
      content: aborted
        ? `Tool ${call.name} ${channel} timed out`
        : `Tool ${call.name} ${channel} failed: ${detail}`,
      isError: true,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}
