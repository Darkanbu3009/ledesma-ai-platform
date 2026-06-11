import { flushSseRest, parseSseChunks, type SseMessage } from './sse.js';
import type { ChatMessage } from './turns.js';

export interface StreamParams {
  /** URL completa a la que se hace el POST (contrato publico {endpoint} con { messages }). */
  endpoint: string;
  /** Opcional: modo directo/demo. En produccion el proxy del cliente agrega la key. */
  providerKey?: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  onMessage: (m: SseMessage) => void;
}

/**
 * Ejecuta un turno contra el contrato publico del agente: POST {endpoint} con { messages } y
 * respuesta SSE. La key del proveedor viaja en x-provider-key SOLO si viene (en produccion la
 * agrega el proxy del cliente, nunca el navegador).
 */
export async function streamAgent(
  params: StreamParams,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.providerKey !== undefined && params.providerKey !== '') {
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
