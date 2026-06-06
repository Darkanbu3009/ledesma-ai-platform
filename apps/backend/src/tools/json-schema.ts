import { z } from 'zod';

/**
 * Convierte un ZodType a JSON Schema para exponer la tool al modelo.
 * Usa la API nativa z.toJSONSchema de zod v4 (la version instalada en el backend), por lo que no
 * requiere ninguna libreria externa de conversion. Se mantiene como el UNICO punto de conversion
 * para poder cambiar de estrategia sin tocar el registro.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}
