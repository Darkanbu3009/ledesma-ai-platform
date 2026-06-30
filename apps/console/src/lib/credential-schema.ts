import { z } from 'zod';

/**
 * Espejo en cliente del CreateCredentialSchema del backend (routes/credentials.ts). Da feedback
 * inmediato antes de enviar, pero el backend sigue siendo la autoridad. Igual que en el agente,
 * openai-compatible exige baseUrl.
 */
export const CredentialFormSchema = z
  .object({
    label: z.string().min(1, 'La etiqueta es obligatoria').max(120),
    providerId: z.enum(['anthropic', 'openai', 'openai-compatible']),
    apiKey: z.string().min(1, 'La API key es obligatoria').max(8192),
    baseUrl: z.string().url('Debe ser una URL valida').optional().or(z.literal('')),
  })
  .superRefine((data, ctx) => {
    if (data.providerId === 'openai-compatible' && (!data.baseUrl || data.baseUrl === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message: 'Requerido para proveedores compatibles',
      });
    }
  });

export type CredentialFormValues = z.input<typeof CredentialFormSchema>;
export type CredentialFormParsed = z.output<typeof CredentialFormSchema>;

/** Body del POST /v1/credentials. baseUrl solo viaja cuando el proveedor es openai-compatible. */
export function toCredentialApiInput(values: CredentialFormParsed) {
  return {
    label: values.label,
    providerId: values.providerId,
    apiKey: values.apiKey,
    baseUrl: values.providerId === 'openai-compatible' ? values.baseUrl || undefined : undefined,
  };
}
