/** Una tool solicitada por el modelo durante el loop. */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Resultado de ejecutar una tool. */
export interface ToolExecutionResult {
  content: string;
  isError: boolean;
}

/**
 * Ejecuta una tool y devuelve su resultado. Interfaz inyectable: el REGISTRO concreto de tools
 * (declaracion y validacion de inputs) es P2.2; el loop solo depende de esta firma.
 */
export type ToolExecutor = (call: ToolCall, signal?: AbortSignal) => Promise<ToolExecutionResult>;
