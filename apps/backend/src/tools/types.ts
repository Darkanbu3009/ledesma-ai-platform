import type { z } from 'zod';
import type { ToolExecutionResult } from '../agent/index.js';

/** Salida que puede devolver el handler de una tool: un string corto o el resultado completo. */
export type ToolHandlerOutput = string | ToolExecutionResult;

/**
 * Definicion de una tool registrada. El inputSchema es un ZodType; el handler recibe el input ya
 * validado y tipado segun ese schema.
 */
export interface RegisteredTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TSchema;
  handler: (input: z.infer<TSchema>, signal?: AbortSignal) => Promise<ToolHandlerOutput> | ToolHandlerOutput;
}
