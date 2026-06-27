import type { AttachmentRef } from './attachments';
import { readApiEnv } from './env';
import { flushSseRest, parseSseChunks, type SseMessage } from './sse';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RunAgentByIdParams {
  agentId: string;
  providerKey: string;
  messages: ChatMessage[];
  /** Adjuntos del turno actual. El backend los incorpora al ultimo mensaje user. */
  attachments?: AttachmentRef[];
  signal: AbortSignal;
  onMessage: (message: SseMessage) => void;
}

/** Ejecuta un agente via el contrato publico POST /v1/run/:agentId. La config (cerebro, system
 * prompt, parametros) vive en la plataforma; aqui solo viajan los mensajes y la key BYOK (header,
 * en memoria). Es el MISMO contrato que usan las integraciones de clientes. */
export async function runAgentStream(params: RunAgentByIdParams): Promise<void> {
  const { apiUrl } = readApiEnv(import.meta.env as Record<string, string | undefined>);

  const response = await fetch(`${apiUrl}/v1/run/${params.agentId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-provider-key': params.providerKey,
    },
    signal: params.signal,
    // attachments solo viaja cuando hay adjuntos: asi el envio solo-texto manda el mismo body de siempre.
    body: JSON.stringify(
      params.attachments && params.attachments.length > 0
        ? { messages: params.messages, attachments: params.attachments }
        : { messages: params.messages },
    ),
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
