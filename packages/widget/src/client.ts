import { flushSseRest, parseSseChunks, type SseMessage } from './sse.js';
import type { ChatMessage } from './turns.js';

export interface StreamParams {
  /** URL completa a la que se hace el POST (contrato publico {endpoint} con { messages }). */
  endpoint: string;
  /** Opcional: modo directo/demo. En produccion la key nunca viaja al navegador. */
  providerKey?: string;
  /** Opcional: token de sesion efimero (emitido por el backend del cliente). Tiene precedencia
   * sobre providerKey: si viene, viaja en x-session-token y la key NO se manda. */
  sessionToken?: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  onMessage: (m: SseMessage) => void;
}

/**
 * Ejecuta un turno contra el contrato publico del agente: POST {endpoint} con { messages } y
 * respuesta SSE. La credencial viaja en x-session-token si hay token de sesion; si no, en
 * x-provider-key SOLO si la key viene (modo directo/demo).
 */
export async function streamAgent(
  params: StreamParams,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.sessionToken !== undefined && params.sessionToken !== '') {
    headers['x-session-token'] = params.sessionToken;
  } else if (params.providerKey !== undefined && params.providerKey !== '') {
    headers['x-provider-key'] = params.providerKey;
  }

  const response = await fetchImpl(params.endpoint, {
    method: 'POST',
    headers,
    signal: params.signal,
    body: JSON.stringify({ messages: params.messages }),
  });

  if (!response.ok || !response.body) {
    let code = 'UNKNOWN';
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* sin body */
    }
    params.onMessage({ kind: 'error', code, message });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { messages, rest } = parseSseChunks(buffer);
    buffer = rest;
    for (const message of messages) params.onMessage(message);
  }
  // Un ultimo bloque sin \n\n de cierre quedaria en el buffer: lo parseamos para no perder
  // un done o un error con su code real.
  buffer += decoder.decode();
  for (const message of flushSseRest(buffer)) params.onMessage(message);
}
