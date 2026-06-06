import { z } from 'zod';
import type { JsonSchema, ToolDefinition } from '@ledesma-platform/shared';
import type { ToolCall, ToolExecutionResult, ToolExecutor } from '../agent/index.js';
import type { RegisteredTool, ToolHandlerOutput } from './types.js';
import { zodToJsonSchema } from './json-schema.js';

function normalizeOutput(output: ToolHandlerOutput): ToolExecutionResult {
  if (typeof output === 'string') {
    return { content: output, isError: false };
  }
  return output;
}

/**
 * Registro de tools en memoria (nucleo determinista enchufable). Valida el input del modelo con
 * Zod antes de ejecutar, y produce un ToolExecutor para el loop agentico. Nunca lanza desde
 * execute(): los fallos se devuelven como tool_result con isError=true para que el modelo se
 * corrija.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register<TSchema extends z.ZodTypeAny>(tool: RegisteredTool<TSchema>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as unknown as RegisteredTool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Tools declaradas en formato del contrato, para pasar al modelo en request.tools. */
  toToolDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema) as JsonSchema,
    }));
  }

  /** Ejecuta una tool solicitada por el modelo. Valida el input antes de correr el handler. */
  async execute(call: ToolCall, signal?: AbortSignal): Promise<ToolExecutionResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { content: `Unknown tool: ${call.name}`, isError: true };
    }

    const parsed = tool.inputSchema.safeParse(call.input);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      return { content: `Invalid input for tool ${call.name}: ${issues}`, isError: true };
    }

    try {
      const output = await tool.handler(parsed.data, signal);
      return normalizeOutput(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return { content: `Tool ${call.name} failed: ${message}`, isError: true };
    }
  }

  /** Devuelve el ToolExecutor que consume el loop agentico (P2.1). */
  toExecutor(): ToolExecutor {
    return (call: ToolCall, signal?: AbortSignal) => this.execute(call, signal);
  }
}
