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

/** Conteo de tokens reportado por el proveedor al cierre del stream. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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
