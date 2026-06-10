import { z } from 'zod';
import { ToolFormSchema, toolFormToStored } from './tool-schema';

/** Espejo del AgentInputSchema del backend. */
export const AgentFormSchema = z
  .object({
    name: z.string().min(1, 'El nombre es obligatorio').max(120),
    description: z.string().max(2000).optional().or(z.literal('')),
    providerId: z.enum(['anthropic', 'openai', 'openai-compatible']),
    model: z.string().min(1, 'El modelo es obligatorio').max(120),
    systemPrompt: z.string().max(50000).optional().or(z.literal('')),
    maxTokens: z.coerce.number().int().positive().max(32000),
    // literal('') y null van antes que coerce.number: Number('') es 0 y la rama
    // numerica capturaria el vacio como 0 en vez de "sin valor".
    temperature: z
      .union([z.literal(''), z.null(), z.coerce.number().min(0).max(2)])
      .optional()
      .transform((v) => (v === '' || v === null || v === undefined ? null : v)),
    baseUrl: z.string().url('Debe ser una URL valida').optional().or(z.literal('')),
    tools: z.array(ToolFormSchema).max(50).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.providerId === 'openai-compatible' && (!data.baseUrl || data.baseUrl === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message: 'Requerido para proveedores compatibles',
      });
    }
    const names = new Set<string>();
    for (const tool of data.tools) {
      if (names.has(tool.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tools'],
          message: 'Los nombres de las herramientas deben ser unicos',
        });
        break;
      }
      names.add(tool.name);
    }
  });

export type AgentFormValues = z.input<typeof AgentFormSchema>;
export type AgentFormParsed = z.output<typeof AgentFormSchema>;

/** Convierte los valores del formulario al body del API. */
export function toApiInput(values: AgentFormParsed) {
  return {
    name: values.name,
    description: values.description || '',
    providerId: values.providerId,
    model: values.model,
    systemPrompt: values.systemPrompt || '',
    maxTokens: values.maxTokens,
    temperature: values.temperature,
    baseUrl: values.providerId === 'openai-compatible' ? values.baseUrl || null : null,
    tools: values.tools.map(toolFormToStored),
  };
}
