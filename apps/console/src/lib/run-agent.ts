import type { AttachmentRef } from './attachments';
import { getAccessToken } from './api';
import { readApiEnv } from './env';
import { flushSseRest, parseSseChunks, type SseMessage } from './sse';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Fuente de la credencial para ejecutar el agente. Aditivo sobre el flujo BYOK original; las dos
 * variantes son mutuamente excluyentes:
 *  - 'paste': una key pegada AL MOMENTO -> viaja en x-provider-key (contrato publico, sin identidad
 *    de usuario). Camino intacto de siempre.
 *  - 'saved': una credencial GUARDADA de la boveda -> viaja x-credential-id + el JWT del usuario; el
 *    backend resuelve key/providerId/baseUrl server-side y valida que el proveedor coincida con el
 *    del agente. Una credencial guardada solo es usable por su owner, de ahi el JWT.
 * La key al momento vive SOLO en memoria: nunca se persiste ni se loguea.
 */
export type RunCredential =
  | { mode: 'paste'; apiKey: string }
  | { mode: 'saved'; credentialId: string };

/**
 * Cota de iteraciones que el Playground pide por turno. Es el CAP server-side (AGENT_LIMITS.
 * maxIterationsCap del backend, que el contrato publico de /v1/run/:agentId ya acepta y valida);
 * el default del motor (10) se quedaba corto para narrar tareas web de 3 a 5 minutos: cada llamada
 * a la tool de revisar espera hasta ~45s (su long-poll, calibrado con margen por debajo del umbral
 * de corte por inactividad de los proxies del SSE; subirlo mas exigiria un latido en el stream),
 * asi que con 20 iteraciones el chat aguanta bastante mas de 5 minutos de tarea.
 */
export const PLAYGROUND_MAX_ITERATIONS = 20;

export interface RunAgentByIdParams {
  agentId: string;
  credential: RunCredential;
  messages: ChatMessage[];
  /** Adjuntos del turno actual. El backend los incorpora al ultimo mensaje user. */
  attachments?: AttachmentRef[];
  signal: AbortSignal;
  onMessage: (message: SseMessage) => void;
}

/**
 * Headers de la fuente de la key del turno. La key al momento usa x-provider-key SIN Authorization
 * (igual que el contrato publico de integraciones). La credencial guardada exige identidad: manda
 * x-credential-id + Authorization Bearer, porque el backend (requireUser) solo resuelve la
 * credencial para su owner.
 */
async function credentialHeaders(credential: RunCredential): Promise<Record<string, string>> {
  if (credential.mode === 'saved') {
    const token = await getAccessToken();
    return { 'x-credential-id': credential.credentialId, Authorization: `Bearer ${token}` };
  }
  return { 'x-provider-key': credential.apiKey };
}

/** Ejecuta un agente via el contrato publico POST /v1/run/:agentId. La config (cerebro, system
 * prompt, parametros) vive en la plataforma; aqui solo viajan los mensajes y la fuente de la key
 * (key al momento en header, o el id de una credencial guardada + el JWT del usuario). Es el MISMO
 * contrato que usan las integraciones de clientes. */
export async function runAgentStream(params: RunAgentByIdParams): Promise<void> {
  const { apiUrl } = readApiEnv(import.meta.env as Record<string, string | undefined>);

  const response = await fetch(`${apiUrl}/v1/run/${params.agentId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await credentialHeaders(params.credential)),
    },
    signal: params.signal,
    // attachments solo viaja cuando hay adjuntos: asi el envio solo-texto manda el mismo body de
    // siempre (mas la cota de iteraciones del Playground, ver PLAYGROUND_MAX_ITERATIONS).
    body: JSON.stringify(
      params.attachments && params.attachments.length > 0
        ? {
            messages: params.messages,
            attachments: params.attachments,
            maxIterations: PLAYGROUND_MAX_ITERATIONS,
          }
        : { messages: params.messages, maxIterations: PLAYGROUND_MAX_ITERATIONS },
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
