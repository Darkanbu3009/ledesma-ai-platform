import { readApiEnv } from './env';
import type { AgentConfig } from './agents';
import { parseSseChunks, type SseMessage } from './sse';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RunAgentParams {
  agent: AgentConfig;
  providerKey: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  onMessage: (message: SseMessage) => void;
}

/** Llama POST /v1/agent/run con la config del agente y la key BYOK (solo en headers, solo en
 * memoria). Streamea los eventos SSE via onMessage. */
export async function runAgentStream(params: RunAgentParams): Promise<void> {
  const { apiUrl } = readApiEnv(import.meta.env as Record<string, string | undefined>);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-provider-key': params.providerKey,
  };
  if (params.agent.providerId === 'openai-compatible' && params.agent.baseUrl) {
    headers['x-provider-base-url'] = params.agent.baseUrl;
  }

  const response = await fetch(`${apiUrl}/v1/agent/run`, {
    method: 'POST',
    headers,
    signal: params.signal,
    body: JSON.stringify({
      providerId: params.agent.providerId,
      model: params.agent.model,
      ...(params.agent.systemPrompt ? { system: params.agent.systemPrompt } : {}),
      maxTokens: params.agent.maxTokens,
      ...(params.agent.temperature !== null ? { temperature: params.agent.temperature } : {}),
      messages: params.messages,
    }),
  });

  if (!response.ok || !response.body) {
    let code = 'UNKNOWN';
    try {
      const body = (await response.json()) as { error?: { code?: string } };
      code = body.error?.code ?? 'UNKNOWN';
    } catch {
      /* sin body */
    }
    params.onMessage({ kind: 'error', code, message: `HTTP ${response.status}` });
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
}
