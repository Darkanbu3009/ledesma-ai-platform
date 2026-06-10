/** Evento del agente tal como lo emite el backend. */
export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'stop'; reason: string; usage: { inputTokens: number; outputTokens: number } };

export type SseMessage =
  | { kind: 'event'; event: AgentEvent }
  | { kind: 'done' }
  | { kind: 'error'; code: string; message: string };

/**
 * Acumulador de SSE sobre chunks de texto: junta el buffer, separa bloques por doble salto y
 * devuelve los mensajes completos + el resto del buffer. Funcion pura.
 */
export function parseSseChunks(buffer: string): { messages: SseMessage[]; rest: string } {
  const messages: SseMessage[] = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const block of parts) {
    if (block.trim() === '') continue;
    let eventName = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) eventName = line.slice(7).trim();
      else if (line.startsWith('data: ')) data = line.slice(6);
    }
    if (eventName === 'done') {
      messages.push({ kind: 'done' });
    } else if (eventName === 'error') {
      try {
        const parsed = JSON.parse(data) as { code?: string; message?: string };
        messages.push({ kind: 'error', code: parsed.code ?? 'UNKNOWN', message: parsed.message ?? 'Error' });
      } catch {
        messages.push({ kind: 'error', code: 'UNKNOWN', message: 'Error' });
      }
    } else if (data !== '') {
      try {
        messages.push({ kind: 'event', event: JSON.parse(data) as AgentEvent });
      } catch {
        // bloque corrupto: ignorar
      }
    }
  }
  return { messages, rest };
}
