import { z } from 'zod';

export type ParamType = 'string' | 'number' | 'boolean';

export interface ToolParam {
  name: string;
  type: ParamType;
  description: string;
  required: boolean;
}

export const ToolParamSchema = z.object({
  name: z
    .string()
    .min(1, 'Nombre del parametro obligatorio')
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Solo letras, numeros y guion bajo'),
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string(),
  required: z.boolean(),
});

export const ToolFormSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Nombre obligatorio')
      .max(64)
      .regex(/^[a-zA-Z_][a-zA-Z0-9_-]*$/, 'Solo letras, numeros, guion y guion bajo'),
    description: z.string().min(1, 'Descripcion obligatoria').max(1000),
    url: z.string().url('URL invalida').startsWith('https://', 'Debe ser https'),
    mode: z.enum(['simple', 'json']),
    params: z.array(ToolParamSchema),
    rawSchema: z.string(),
  })
  .superRefine((tool, ctx) => {
    if (tool.mode === 'json') {
      const parsed = tryParseJsonObject(tool.rawSchema);
      if (!parsed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rawSchema'],
          message: 'Debe ser un objeto JSON valido',
        });
      }
    }
  });

export type ToolFormValues = z.infer<typeof ToolFormSchema>;

export function tryParseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** params -> JSON Schema { type: object, properties, required } */
export function paramsToJsonSchema(params: ToolParam[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const p of params) {
    properties[p.name] = { type: p.type, ...(p.description ? { description: p.description } : {}) };
  }
  const required = params.filter((p) => p.required).map((p) => p.name);
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
}

/** JSON Schema -> params si es representable por el constructor; null si es complejo (anidado,
 * tipos no soportados, sin type object). */
export function tryJsonSchemaToParams(schema: Record<string, unknown>): ToolParam[] | null {
  if (schema.type !== 'object') return null;
  const properties = schema.properties;
  if (properties === undefined) return [];
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties))
    return null;
  const required = Array.isArray(schema.required)
    ? (schema.required as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];
  const params: ToolParam[] = [];
  for (const [name, def] of Object.entries(properties as Record<string, unknown>)) {
    if (def === null || typeof def !== 'object' || Array.isArray(def)) return null;
    const d = def as Record<string, unknown>;
    if (d.type !== 'string' && d.type !== 'number' && d.type !== 'boolean') return null;
    const extraKeys = Object.keys(d).filter((k) => k !== 'type' && k !== 'description');
    if (extraKeys.length > 0) return null;
    params.push({
      name,
      type: d.type,
      description: typeof d.description === 'string' ? d.description : '',
      required: required.includes(name),
    });
  }
  return params;
}

/** Input de ejemplo para probar una tool: un valor por parametro segun su tipo. */
export function sampleInputFromParams(params: ToolParam[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const p of params) {
    input[p.name] = p.type === 'string' ? 'texto' : p.type === 'number' ? 0 : false;
  }
  return input;
}

/** ToolFormValues -> StoredTool (payload del API). */
export function toolFormToStored(tool: ToolFormValues): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  url: string;
} {
  const inputSchema =
    tool.mode === 'simple'
      ? paramsToJsonSchema(tool.params)
      : (tryParseJsonObject(tool.rawSchema) ?? { type: 'object', properties: {} });
  return { name: tool.name, description: tool.description, inputSchema, url: tool.url };
}

/** StoredTool -> ToolFormValues (decide modo segun representabilidad). */
export function storedToToolForm(stored: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  url: string;
}): ToolFormValues {
  const params = tryJsonSchemaToParams(stored.inputSchema);
  if (params !== null) {
    return {
      name: stored.name,
      description: stored.description,
      url: stored.url,
      mode: 'simple',
      params,
      rawSchema: '',
    };
  }
  return {
    name: stored.name,
    description: stored.description,
    url: stored.url,
    mode: 'json',
    params: [],
    rawSchema: JSON.stringify(stored.inputSchema, null, 2),
  };
}
