import { describe, it, expect, vi } from 'vitest';
import type { AgentSpec, ResolvedToolCatalogEntry } from '@ledesma-platform/shared';
import { validateAgentSpec } from '../src/agents/agent-spec.js';
import { resolveToolCatalog } from '../src/tools/catalog.js';
import { AgentInputSchema } from '../src/routes/agents.js';
import { AgentRepository } from '../src/agents/agent-repository.js';
import type { Env } from '../src/config/env.js';
import type { Sql } from '../src/db/client.js';

// Catalogo real resuelto: con las env del worker presentes, las nativas quedan available=true.
function envWith(overrides: Partial<Record<string, string>>): Env {
  return { NODE_ENV: 'test', ...overrides } as unknown as Env;
}
const WORKER_URL = 'https://web-worker.example.com';
const WORKER_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';

const availableCatalog = resolveToolCatalog(envWith({ WEB_WORKER_URL: WORKER_URL, WEB_WORKER_SECRET: WORKER_SECRET }));
const unavailableCatalog = resolveToolCatalog(envWith({}));
const NATIVE = 'platform_iniciar_tarea_web';

const validWebhook = {
  kind: 'webhook' as const,
  name: 'cotizar',
  description: 'Calcula el precio',
  inputSchema: { type: 'object' as const },
  url: 'https://hooks.cliente.com/cotizar',
};

function minimalSpec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  // name + providerId + model: el minimo que el flujo de creacion exige (name lo requiere
  // AgentInputSchema). Sin tools ni opcionales.
  return { name: 'Cotizador', providerId: 'anthropic', model: 'claude-sonnet-4-6', ...overrides };
}

/** Helper para los specs intencionalmente malformados (salida de LLM no confiable). */
function malformed(spec: unknown): AgentSpec {
  return spec as AgentSpec;
}

describe('validateAgentSpec: minimo y requeridos', () => {
  it('spec minimo (name + providerId + model) -> ok:true, sin tools', () => {
    const result = validateAgentSpec(minimalSpec(), availableCatalog);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: 'Cotizador', providerId: 'anthropic', model: 'claude-sonnet-4-6' });
      expect(result.value.tools).toBeUndefined();
    }
  });

  it('falta providerId -> ok:false con error claro', () => {
    const result = validateAgentSpec(malformed({ name: 'X', model: 'm' }), availableCatalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/providerId/);
  });

  it('falta model -> ok:false', () => {
    const result = validateAgentSpec(malformed({ name: 'X', providerId: 'anthropic' }), availableCatalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/model/);
  });

  it('falta name -> ok:false (lo exige el schema de creacion)', () => {
    const result = validateAgentSpec(malformed({ providerId: 'anthropic', model: 'm' }), availableCatalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/name/);
  });

  it('campo desconocido -> ok:false con el mensaje exacto', () => {
    const result = validateAgentSpec(malformed({ ...minimalSpec(), foo: 'bar' }), availableCatalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('Campo desconocido en el spec: "foo"');
  });

  it('multiples campos desconocidos -> acumula un error por cada uno', () => {
    const result = validateAgentSpec(malformed({ ...minimalSpec(), foo: 'bar', baz: 1 }), availableCatalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('Campo desconocido en el spec: "foo"');
      expect(result.errors).toContain('Campo desconocido en el spec: "baz"');
    }
  });

  it('spec no-objeto -> ok:false', () => {
    expect(validateAgentSpec(malformed(null), availableCatalog).ok).toBe(false);
    expect(validateAgentSpec(malformed('x'), availableCatalog).ok).toBe(false);
    expect(validateAgentSpec(malformed([]), availableCatalog).ok).toBe(false);
  });
});

describe('validateAgentSpec: tools nativas', () => {
  it('nativa existente y available -> ok:true; NO se persiste en value.tools', () => {
    const result = validateAgentSpec(minimalSpec({ tools: [{ kind: 'native', name: NATIVE }] }), availableCatalog);
    expect(result.ok).toBe(true);
    // Las nativas las inyecta el runtime; no van en el agente guardado.
    if (result.ok) expect(result.value.tools).toBeUndefined();
  });

  it('nativa inexistente -> ok:false con error explicito', () => {
    const result = validateAgentSpec(minimalSpec({ tools: [{ kind: 'native', name: 'platform_no_existe' }] }), availableCatalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/platform_no_existe.*no existe/);
  });

  it('nativa existente pero available=false -> ok:false', () => {
    const result = validateAgentSpec(minimalSpec({ tools: [{ kind: 'native', name: NATIVE }] }), unavailableCatalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/no esta disponible/);
  });

  it('nativa no embed-safe -> ok:false (regla embed-safe)', () => {
    const noEmbed: ResolvedToolCatalogEntry[] = [
      {
        name: 'native_no_embed',
        kind: 'native',
        title: 'x',
        description: 'y',
        whenToUse: 'z',
        inputSchema: { type: 'object' },
        embedSafe: false,
        requiresConfig: [],
        available: true,
      },
    ];
    const result = validateAgentSpec(minimalSpec({ tools: [{ kind: 'native', name: 'native_no_embed' }] }), noEmbed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/no es embed-safe/);
  });

  it.each([
    ['kind string invalido', { kind: 'mcp', name: 'x' }],
    ['kind ausente', { name: 'x', url: 'https://h.example.com/x', description: 'd', inputSchema: {} }],
    ['kind null', { kind: null, name: 'x' }],
    ['kind numero', { kind: 1, name: 'x' }],
  ])('tool con %s -> ok:false (kind desconocido)', (_caso, tool) => {
    const result = validateAgentSpec(malformed({ ...minimalSpec(), tools: [tool] }), availableCatalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/kind desconocido/);
  });

  it('tool que no es objeto -> ok:false', () => {
    const result = validateAgentSpec(malformed({ ...minimalSpec(), tools: ['cotizar', null] }), availableCatalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/debe ser un objeto/);
  });
});

describe('validateAgentSpec: webhook tools (reusa StoredToolSchema)', () => {
  it('webhook valida -> ok:true; value.tools la incluye como StoredTool (sin kind)', () => {
    const result = validateAgentSpec(minimalSpec({ tools: [validWebhook] }), availableCatalog);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tools).toEqual([
        { name: 'cotizar', description: 'Calcula el precio', inputSchema: { type: 'object' }, url: 'https://hooks.cliente.com/cotizar' },
      ]);
      // El discriminador kind NO se persiste.
      expect(result.value.tools?.[0]).not.toHaveProperty('kind');
    }
  });

  it('webhook con url http (no https) -> ok:false con error de https (regla real de StoredToolSchema)', () => {
    const result = validateAgentSpec(
      minimalSpec({ tools: [{ ...validWebhook, url: 'http://hooks.cliente.com/cotizar' }] }),
      availableCatalog,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // El error debe identificar la tool y la causa (https), no solo "algo en cotizar".
      const joined = result.errors.join('\n');
      expect(joined).toContain('cotizar');
      expect(joined.toLowerCase()).toContain('https');
    }
  });

  it('webhook tools con name duplicado -> ok:false (regla de unicidad de la compuerta)', () => {
    const result = validateAgentSpec(
      minimalSpec({ tools: [validWebhook, { ...validWebhook, url: 'https://otro.example.com/c' }] }),
      availableCatalog,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/duplicada.*cotizar|cotizar.*duplicada/);
  });

  it('webhook con name prefijo reservado platform_ -> ok:false', () => {
    const result = validateAgentSpec(
      minimalSpec({ tools: [{ ...validWebhook, name: 'platform_x' }] }),
      availableCatalog,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/platform_/);
  });

  it('exactamente 50 webhook tools validas (con names unicos) -> ok:true (limite inclusivo)', () => {
    const tools = Array.from({ length: 50 }, (_, i) => ({ ...validWebhook, name: `cotizar_${i}` }));
    const result = validateAgentSpec(minimalSpec({ tools }), availableCatalog);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tools).toHaveLength(50);
  });

  it('mas de 50 webhook tools validas -> ok:false con error NO vacio (limite del arreglo)', () => {
    const tools = Array.from({ length: 51 }, (_, i) => ({ ...validWebhook, name: `cotizar_${i}` }));
    const result = validateAgentSpec(minimalSpec({ tools }), availableCatalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join('\n')).toMatch(/tools/);
    }
  });

  it('mezcla nativa (available) + webhook valida -> ok:true; value.tools solo la webhook', () => {
    const result = validateAgentSpec(
      minimalSpec({ tools: [{ kind: 'native', name: NATIVE }, validWebhook] }),
      availableCatalog,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tools).toHaveLength(1);
  });
});

describe('validateAgentSpec: provider y rangos', () => {
  it('openai-compatible sin baseUrl -> ok:false', () => {
    const result = validateAgentSpec(minimalSpec({ providerId: 'openai-compatible' }), availableCatalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/baseUrl.*openai-compatible/);
  });

  it('openai-compatible con baseUrl -> ok:true', () => {
    const result = validateAgentSpec(
      minimalSpec({ providerId: 'openai-compatible', model: 'llama-3.1', baseUrl: 'https://api.openrouter.ai/v1' }),
      availableCatalog,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.baseUrl).toBe('https://api.openrouter.ai/v1');
  });

  it('temperature fuera de rango -> ok:false', () => {
    expect(validateAgentSpec(minimalSpec({ temperature: 3 }), availableCatalog).ok).toBe(false);
    expect(validateAgentSpec(minimalSpec({ temperature: -1 }), availableCatalog).ok).toBe(false);
  });

  it('temperature valida y null pasan y se PRESERVAN en value', () => {
    const conValor = validateAgentSpec(minimalSpec({ temperature: 0.5 }), availableCatalog);
    expect(conValor.ok).toBe(true);
    if (conValor.ok) expect(conValor.value.temperature).toBe(0.5);

    // null es valido (deshabilita temperature) y debe llegar tal cual a la capa de creacion.
    const conNull = validateAgentSpec(minimalSpec({ temperature: null }), availableCatalog);
    expect(conNull.ok).toBe(true);
    if (conNull.ok) expect(conNull.value.temperature).toBeNull();
  });

  it('maxTokens invalido -> ok:false (no entero / no positivo)', () => {
    expect(validateAgentSpec(minimalSpec({ maxTokens: 0 }), availableCatalog).ok).toBe(false);
    expect(validateAgentSpec(minimalSpec({ maxTokens: -5 }), availableCatalog).ok).toBe(false);
    expect(validateAgentSpec(minimalSpec({ maxTokens: 1.5 }), availableCatalog).ok).toBe(false);
  });

  it('maxTokens valido pasa', () => {
    const result = validateAgentSpec(minimalSpec({ maxTokens: 2048 }), availableCatalog);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.maxTokens).toBe(2048);
  });
});

// ---- Integracion: el value es input DIRECTO de la capa de creacion existente (sin duplicarla) ----

/** Mock del tagged template `sql` (mismo patron que agent-repository.test.ts). */
function makeSqlReturning(result: unknown[]): Sql {
  const fn = vi.fn(async () => result) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

describe('integracion: value -> flujo de creacion existente', () => {
  const fullSpec: AgentSpec = {
    name: 'Cotizador',
    description: 'Agente de cotizaciones',
    systemPrompt: 'Eres un cotizador',
    providerId: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 2048,
    temperature: 0.2,
    tools: [validWebhook, { kind: 'native', name: NATIVE }],
  };

  it('value pasa el MISMO AgentInputSchema que usa POST /v1/agents', () => {
    const result = validateAgentSpec(fullSpec, availableCatalog);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const reparsed = AgentInputSchema.safeParse(result.value);
      expect(reparsed.success).toBe(true);
      // value es canonico: re-parsearlo no lo cambia.
      if (reparsed.success) expect(reparsed.data).toEqual(result.value);
    }
  });

  it('value (con ownerId) lo acepta AgentRepository.create y produce un AgentConfig valido', async () => {
    const result = validateAgentSpec(fullSpec, availableCatalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      name: result.value.name,
      description: result.value.description ?? '',
      provider_id: result.value.providerId,
      model: result.value.model,
      system_prompt: result.value.systemPrompt ?? '',
      max_tokens: result.value.maxTokens ?? 1024,
      temperature: result.value.temperature ?? null,
      base_url: result.value.baseUrl ?? null,
      tools: result.value.tools ?? [],
      webhook_secret: 'whsec_de_prueba_001122',
      owner_id: 'user-1',
      created_at: '2026-06-29T00:00:00.000Z',
      updated_at: '2026-06-29T00:00:00.000Z',
    };
    const sql = makeSqlReturning([row]);
    const repo = new AgentRepository(sql);

    const created = await repo.create({ ...result.value, ownerId: 'user-1' });
    expect(created).toMatchObject({
      providerId: 'anthropic',
      model: 'claude-sonnet-4-6',
      maxTokens: 2048,
      temperature: 0.2,
      ownerId: 'user-1',
      tools: [{ name: 'cotizar', url: 'https://hooks.cliente.com/cotizar' }],
    });

    // El insert llevo los valores mapeados (solo la webhook en tools; la nativa no se persiste).
    const sqlMock = sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } };
    const values = sqlMock.mock.calls[0]?.slice(1) ?? [];
    expect(values).toContain('Cotizador');
    expect(values).toContain('anthropic');
    expect(values).toContain('user-1');
  });
});
