/**
 * Eventos normalizados del stream de salida.
 * Todo adaptador emite esta secuencia, sin importar el proveedor.
 */

/** Razon normalizada por la que el modelo detuvo la generacion. */
export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | 'content_filter'
  | 'error';

/**
 * Conteo de tokens reportado por el proveedor al cierre del stream.
 *
 * `inputTokens`/`outputTokens` son los tokens facturados a precio pleno. Con prompt caching el
 * proveedor separa el input en tres cubos con precios distintos: `inputTokens` pasa a ser SOLO el
 * input no cacheado (1x), `cacheWriteTokens` los tokens escritos a la cache (~1.25x) y
 * `cacheReadTokens` los leidos de la cache (~0.1x). Los dos ultimos son OPCIONALES: solo se pueblan
 * cuando el proveedor los reporta (Anthropic los expone en la usage del stream); un proveedor sin
 * caching los deja ausentes y el conteo actual no cambia. El total de input procesado es
 * `inputTokens + (cacheWriteTokens ?? 0) + (cacheReadTokens ?? 0)`.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens escritos a la cache de prompt este turno (Anthropic: cache_creation_input_tokens). */
  cacheWriteTokens?: number;
  /** Tokens servidos desde la cache de prompt este turno (Anthropic: cache_read_input_tokens). */
  cacheReadTokens?: number;
}

/** Fragmento incremental de texto generado por el modelo. */
export interface TextDeltaEvent {
  type: 'text_delta';
  text: string;
}

/** El modelo solicita ejecutar una tool. La entrada llega completa y parseada. */
export interface ToolUseEvent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Evento terminal del stream. */
export interface StopEvent {
  type: 'stop';
  reason: StopReason;
  usage?: TokenUsage;
}

export type ProviderStreamEvent = TextDeltaEvent | ToolUseEvent | StopEvent;
