import { describe, it, expect } from 'vitest';
import {
  paramsToJsonSchema,
  storedToToolForm,
  ToolFormSchema,
  toolFormToStored,
  tryJsonSchemaToParams,
  type ToolFormValues,
  type ToolParam,
} from '../src/lib/tool-schema';
import { AgentFormSchema, toApiInput } from '../src/lib/agent-schema';

const params: ToolParam[] = [
  { name: 'query', type: 'string', description: 'Texto a buscar', required: true },
  { name: 'limite', type: 'number', description: '', required: false },
];

function toolBase(overrides: Partial<ToolFormValues> = {}): ToolFormValues {
  return {
    name: 'buscar_pedidos',
    description: 'Busca pedidos por texto',
    url: 'https://example.com/webhooks/tool',
    mode: 'simple',
    params: [],
    rawSchema: '',
    ...overrides,
  };
}

describe('paramsToJsonSchema', () => {
  it('genera properties y required solo con los params requeridos', () => {
    const schema = paramsToJsonSchema(params);
    expect(schema).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto a buscar' },
        limite: { type: 'number' },
      },
      required: ['query'],
    });
  });

  it('sin params genera objeto vacio sin clave required', () => {
    const schema = paramsToJsonSchema([]);
    expect(schema).toEqual({ type: 'object', properties: {} });
    expect('required' in schema).toBe(false);
  });
});

describe('tryJsonSchemaToParams', () => {
  it('hace roundtrip con paramsToJsonSchema', () => {
    expect(tryJsonSchemaToParams(paramsToJsonSchema(params))).toEqual(params);
  });

  it('devuelve null con un schema anidado', () => {
    const schema = {
      type: 'object',
      properties: { filtro: { type: 'object', properties: {} } },
    };
    expect(tryJsonSchemaToParams(schema)).toBeNull();
  });

  it('devuelve null si una property tiene claves extra como enum', () => {
    const schema = {
      type: 'object',
      properties: { estado: { type: 'string', enum: ['abierto', 'cerrado'] } },
    };
    expect(tryJsonSchemaToParams(schema)).toBeNull();
  });

  it('devuelve null si el type no es object', () => {
    expect(tryJsonSchemaToParams({ type: 'string' })).toBeNull();
  });
});

describe('toolFormToStored', () => {
  it('en modo simple usa los params del constructor', () => {
    const stored = toolFormToStored(toolBase({ params }));
    expect(stored).toEqual({
      name: 'buscar_pedidos',
      description: 'Busca pedidos por texto',
      url: 'https://example.com/webhooks/tool',
      inputSchema: paramsToJsonSchema(params),
    });
  });

  it('en modo json usa el rawSchema parseado', () => {
    const raw = { type: 'object', properties: { ids: { type: 'array' } } };
    const stored = toolFormToStored(
      toolBase({ mode: 'json', rawSchema: JSON.stringify(raw), params }),
    );
    expect(stored.inputSchema).toEqual(raw);
  });
});

describe('storedToToolForm', () => {
  const base = {
    name: 'buscar_pedidos',
    description: 'Busca pedidos por texto',
    url: 'https://example.com/webhooks/tool',
  };

  it('con schema representable elige modo simple con params', () => {
    const form = storedToToolForm({ ...base, inputSchema: paramsToJsonSchema(params) });
    expect(form.mode).toBe('simple');
    expect(form.params).toEqual(params);
    expect(form.rawSchema).toBe('');
    expect(form.url).toBe(base.url);
  });

  it('con schema complejo elige modo json con el JSON formateado', () => {
    const inputSchema = { type: 'object', properties: { ids: { type: 'array' } } };
    const form = storedToToolForm({ ...base, inputSchema });
    expect(form.mode).toBe('json');
    expect(form.params).toEqual([]);
    expect(form.rawSchema).toBe(JSON.stringify(inputSchema, null, 2));
  });
});

describe('ToolFormSchema', () => {
  it('rechaza una url http', () => {
    const result = ToolFormSchema.safeParse(toolBase({ url: 'http://example.com/webhook' }));
    expect(result.success).toBe(false);
  });

  it('rechaza un nombre con espacios', () => {
    const result = ToolFormSchema.safeParse(toolBase({ name: 'buscar pedidos' }));
    expect(result.success).toBe(false);
  });

  it('rechaza modo json con rawSchema invalido', () => {
    const result = ToolFormSchema.safeParse(toolBase({ mode: 'json', rawSchema: '{ no json' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path[0] === 'rawSchema')).toBe(true);
  });
});

describe('AgentFormSchema con tools', () => {
  const minimo = {
    name: 'Mi agente',
    providerId: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 1024,
  };

  it('rechaza dos tools con el mismo nombre con issue en tools', () => {
    const result = AgentFormSchema.safeParse({ ...minimo, tools: [toolBase(), toolBase()] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path[0] === 'tools')).toBe(true);
  });

  it('acepta tools validas y toApiInput manda las tools reales', () => {
    const result = AgentFormSchema.safeParse({ ...minimo, tools: [toolBase({ params })] });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(toApiInput(result.data).tools).toEqual([
      {
        name: 'buscar_pedidos',
        description: 'Busca pedidos por texto',
        url: 'https://example.com/webhooks/tool',
        inputSchema: paramsToJsonSchema(params),
      },
    ]);
  });
});
