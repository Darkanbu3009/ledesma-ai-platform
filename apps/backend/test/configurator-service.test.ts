import { describe, it, expect } from 'vitest';
import type { ProviderStreamEvent, ResolvedToolCatalogEntry } from '@ledesma-platform/shared';
import type { ModelCallInput } from '../src/providers/index.js';
import {
  runConfiguratorTurn,
  getPlatformModelConfig,
  buildConfiguratorSystemPrompt,
  type ConfiguratorDeps,
  type PlatformModelConfig,
} from '../src/configurator/configurator-service.js';
import { resolveToolCatalog, WEBHOOK_TOOL_CAPABILITY } from '../src/tools/catalog.js';
import { parseEnv } from '../src/config/env.js';
import { AppError } from '../src/errors/app-error.js';
import type { Env } from '../src/config/env.js';

// Catalogo real resuelto: con las env del worker presentes las nativas quedan available=true.
function envWith(overrides: Partial<Record<string, string>>): Env {
  return { NODE_ENV: 'test', ...overrides } as unknown as Env;
}
const WORKER = { WEB_WORKER_URL: 'https://web-worker.example.com', WEB_WORKER_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef' };
const availableCatalog: ResolvedToolCatalogEntry[] = resolveToolCatalog(envWith(WORKER));

const PLATFORM: PlatformModelConfig = {
  apiKey: 'sk-platform-secreta-123',
  model: 'claude-sonnet-4-6',
  providerId: 'anthropic',
  maxTokens: 4096,
};

/** runModel falso: emite el texto dado como un unico text_delta y registra cada llamada. */
function modelReturning(
  text: string,
  calls: ModelCallInput[] = [],
): ConfiguratorDeps['runModel'] {
  return (input: ModelCallInput) => {
    calls.push(input);
    return (async function* (): AsyncIterable<ProviderStreamEvent> {
      yield { type: 'text_delta', text };
      yield { type: 'stop', reason: 'end_turn' };
    })();
  };
}

/** runModel falso que falla durante el stream (proveedor caido): el cerebro no debe crashear. */
const modelThrows: ConfiguratorDeps['runModel'] = () =>
  (async function* (): AsyncIterable<ProviderStreamEvent> {
    yield { type: 'text_delta', text: '' };
    throw new Error('proveedor no disponible');
  })();

const userHistory = [{ role: 'user' as const, content: 'Quiero un agente de soporte' }];

describe('runConfiguratorTurn: construye y valida el AgentSpec', () => {
  it('respuesta con AgentSpec JSON valido -> parsea, valida (ok) y devuelve el shape', async () => {
    const calls: ModelCallInput[] = [];
    const modelOutput = JSON.stringify({
      reply: 'Listo, arme tu agente de soporte.',
      spec: { name: 'Soporte', providerId: 'anthropic', model: 'claude-sonnet-4-6' },
      complete: true,
    });

    const result = await runConfiguratorTurn(
      { messages: userHistory, catalog: availableCatalog, webhookCapability: WEBHOOK_TOOL_CAPABILITY },
      { platform: PLATFORM, runModel: modelReturning(modelOutput, calls) },
    );

    expect(result.reply).toBe('Listo, arme tu agente de soporte.');
    expect(result.spec).toEqual({ name: 'Soporte', providerId: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(result.complete).toBe(true);
    expect(result.validation.ok).toBe(true);
    expect(result.modelError).toBeUndefined();

    // La key de PLATAFORMA (no BYOK) y el provider fluyen a la capa de modelo; el system prompt va.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.providerId).toBe('anthropic');
    expect(calls[0]?.credentials.apiKey).toBe('sk-platform-secreta-123');
    expect(calls[0]?.request.system).toContain('Configurador');
    expect(calls[0]?.request.modelConfig.model).toBe('claude-sonnet-4-6');
  });

  it('AgentSpec parcial -> validation.ok=false con los requeridos faltantes (util para la UI)', async () => {
    const modelOutput = JSON.stringify({
      reply: 'Como se va a llamar tu agente?',
      spec: { description: 'aun construyendo' },
      complete: false,
    });

    const result = await runConfiguratorTurn(
      { messages: userHistory, catalog: availableCatalog, webhookCapability: WEBHOOK_TOOL_CAPABILITY },
      { platform: PLATFORM, runModel: modelReturning(modelOutput) },
    );

    expect(result.spec).toEqual({ description: 'aun construyendo' });
    expect(result.complete).toBe(false);
    expect(result.validation.ok).toBe(false);
    if (!result.validation.ok) {
      expect(result.validation.errors.join('\n')).toMatch(/name|providerId|model/);
    }
    expect(result.modelError).toBeUndefined();
  });

  it('respuesta con JSON invalido -> estado de error manejable, NO crashea', async () => {
    const result = await runConfiguratorTurn(
      { messages: userHistory, catalog: availableCatalog, webhookCapability: WEBHOOK_TOOL_CAPABILITY },
      { platform: PLATFORM, runModel: modelReturning('esto no es JSON { roto') },
    );

    expect(result.spec).toBeNull();
    expect(result.validation.ok).toBe(false);
    expect(typeof result.modelError).toBe('string');
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it('extrae el JSON aunque venga envuelto en fences/prosa (parseo tolerante)', async () => {
    const wrapped = '```json\n' + JSON.stringify({
      reply: 'ok',
      spec: { name: 'Bot', providerId: 'anthropic', model: 'claude-sonnet-4-6' },
      complete: true,
    }) + '\n```';

    const result = await runConfiguratorTurn(
      { messages: userHistory, catalog: availableCatalog, webhookCapability: WEBHOOK_TOOL_CAPABILITY },
      { platform: PLATFORM, runModel: modelReturning(wrapped) },
    );

    expect(result.modelError).toBeUndefined();
    expect(result.spec).toEqual({ name: 'Bot', providerId: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(result.validation.ok).toBe(true);
  });

  it('AgentSpec con una tool nativa inexistente -> validation.ok=false con error claro', async () => {
    const modelOutput = JSON.stringify({
      reply: 'Conecte la herramienta que pediste.',
      spec: {
        name: 'Soporte',
        providerId: 'anthropic',
        model: 'claude-sonnet-4-6',
        tools: [{ kind: 'native', name: 'tool_que_no_existe' }],
      },
      complete: true,
    });

    const result = await runConfiguratorTurn(
      { messages: userHistory, catalog: availableCatalog, webhookCapability: WEBHOOK_TOOL_CAPABILITY },
      { platform: PLATFORM, runModel: modelReturning(modelOutput) },
    );

    expect(result.validation.ok).toBe(false);
    if (!result.validation.ok) {
      expect(result.validation.errors.join('\n')).toMatch(/tool_que_no_existe/);
      expect(result.validation.errors.join('\n')).toMatch(/no existe en el catalogo/);
    }
  });

  it('fallo del proveedor de modelo -> estado de error manejable, NO crashea', async () => {
    const result = await runConfiguratorTurn(
      { messages: userHistory, catalog: availableCatalog, webhookCapability: WEBHOOK_TOOL_CAPABILITY },
      { platform: PLATFORM, runModel: modelThrows },
    );

    expect(result.spec).toBeNull();
    expect(result.validation.ok).toBe(false);
    expect(result.modelError).toMatch(/modelo de plataforma/);
  });
});

describe('getPlatformModelConfig: manejo de la key de plataforma', () => {
  const BASE = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://x',
    ADMIN_API_TOKEN: 'admin-token-1234567890',
    SUPABASE_URL: 'https://x.supabase.co',
    SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  };

  it('falta PLATFORM_ANTHROPIC_API_KEY -> AppError 503 claro (no 500 opaco)', () => {
    const config = parseEnv(BASE);
    try {
      getPlatformModelConfig(config);
      throw new Error('deberia haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.statusCode).toBe(503);
      expect(appError.code).toBe('SERVICE_UNAVAILABLE');
      expect(appError.message).toMatch(/PLATFORM_ANTHROPIC_API_KEY/);
    }
  });

  it('con la key configurada -> devuelve config de plataforma (provider anthropic + model)', () => {
    const config = parseEnv({ ...BASE, PLATFORM_ANTHROPIC_API_KEY: 'sk-plat' });
    const platform = getPlatformModelConfig(config);
    expect(platform.apiKey).toBe('sk-plat');
    expect(platform.providerId).toBe('anthropic');
    expect(platform.model).toBe('claude-sonnet-4-6');
    expect(platform.maxTokens).toBeGreaterThan(0);
  });
});

describe('buildConfiguratorSystemPrompt: inyecta el catalogo', () => {
  it('lista las tools nativas disponibles por su name y describe el contrato JSON', () => {
    const prompt = buildConfiguratorSystemPrompt(availableCatalog, WEBHOOK_TOOL_CAPABILITY);
    expect(prompt).toContain('platform_iniciar_tarea_web');
    expect(prompt).toContain('"reply"');
    expect(prompt).toContain('"spec"');
    expect(prompt).toContain('"complete"');
  });

  it('sin tools nativas disponibles -> instruye a no proponer nativas', () => {
    const prompt = buildConfiguratorSystemPrompt(resolveToolCatalog(envWith({})), WEBHOOK_TOOL_CAPABILITY);
    expect(prompt).toMatch(/No hay tools nativas disponibles/);
  });
});
