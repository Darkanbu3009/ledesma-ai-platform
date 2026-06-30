import { describe, it, expect } from 'vitest';
import type { ProviderStreamEvent, ResolvedToolCatalogEntry } from '@ledesma-platform/shared';
import type { ModelCallInput } from '../src/providers/index.js';
import {
  runConfiguratorTurn,
  buildConfiguratorSystemPrompt,
  type ConfiguratorCredentials,
  type ConfiguratorDeps,
  type ConfiguratorTurnInput,
} from '../src/configurator/configurator-service.js';
import { resolveToolCatalog, WEBHOOK_TOOL_CAPABILITY } from '../src/tools/catalog.js';
import type { Env } from '../src/config/env.js';

// Catalogo real resuelto: con las env del worker presentes las nativas quedan available=true.
function envWith(overrides: Partial<Record<string, string>>): Env {
  return { NODE_ENV: 'test', ...overrides } as unknown as Env;
}
const WORKER = { WEB_WORKER_URL: 'https://web-worker.example.com', WEB_WORKER_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef' };
const availableCatalog: ResolvedToolCatalogEntry[] = resolveToolCatalog(envWith(WORKER));

// Credenciales BYOK por request (NO de plataforma): la key, el proveedor y el modelo del cliente.
const CREDENTIALS: ConfiguratorCredentials = {
  providerId: 'anthropic',
  apiKey: 'sk-cliente-byok-123',
  model: 'claude-sonnet-4-6',
};

const userHistory = [{ role: 'user' as const, content: 'Quiero un agente de soporte' }];

/** Arma el input de un turno con las credenciales BYOK (override opcional). */
function turnInput(overrides?: Partial<ConfiguratorTurnInput>): ConfiguratorTurnInput {
  return {
    messages: userHistory,
    catalog: availableCatalog,
    webhookCapability: WEBHOOK_TOOL_CAPABILITY,
    credentials: CREDENTIALS,
    ...overrides,
  };
}

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

describe('runConfiguratorTurn: construye y valida el AgentSpec', () => {
  it('respuesta con AgentSpec JSON valido -> parsea, valida (ok) y devuelve el shape', async () => {
    const calls: ModelCallInput[] = [];
    const modelOutput = JSON.stringify({
      reply: 'Listo, arme tu agente de soporte.',
      spec: { name: 'Soporte', providerId: 'anthropic', model: 'claude-sonnet-4-6' },
      complete: true,
    });

    const result = await runConfiguratorTurn(turnInput(), { runModel: modelReturning(modelOutput, calls) });

    expect(result.reply).toBe('Listo, arme tu agente de soporte.');
    expect(result.spec).toEqual({ name: 'Soporte', providerId: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(result.complete).toBe(true);
    expect(result.validation.ok).toBe(true);
    expect(result.modelError).toBeUndefined();

    // Las credenciales BYOK PROVISTAS por request (no de plataforma) fluyen a la capa de modelo:
    // providerId, apiKey y model del cliente; el system prompt del Configurador tambien.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.providerId).toBe('anthropic');
    expect(calls[0]?.credentials.apiKey).toBe('sk-cliente-byok-123');
    expect(calls[0]?.credentials.baseUrl).toBeUndefined();
    expect(calls[0]?.request.modelConfig.model).toBe('claude-sonnet-4-6');
    expect(calls[0]?.request.system).toContain('Configurador');
  });

  it('credenciales por request -> usa el providerId/apiKey/model PROVISTOS, no valores fijos', async () => {
    const calls: ModelCallInput[] = [];
    const modelOutput = JSON.stringify({ reply: 'ok', spec: {}, complete: false });

    await runConfiguratorTurn(
      turnInput({ credentials: { providerId: 'openai', apiKey: 'sk-openai-cliente', model: 'gpt-4o' } }),
      { runModel: modelReturning(modelOutput, calls) },
    );

    expect(calls[0]?.providerId).toBe('openai');
    expect(calls[0]?.credentials.apiKey).toBe('sk-openai-cliente');
    expect(calls[0]?.credentials.baseUrl).toBeUndefined();
    expect(calls[0]?.request.modelConfig.model).toBe('gpt-4o');
  });

  it('openai-compatible con baseUrl -> reenvia baseUrl en las credenciales', async () => {
    const calls: ModelCallInput[] = [];
    const modelOutput = JSON.stringify({ reply: 'ok', spec: {}, complete: false });

    await runConfiguratorTurn(
      turnInput({
        credentials: {
          providerId: 'openai-compatible',
          apiKey: 'sk-compat',
          model: 'llama-3.1',
          baseUrl: 'https://llm.example.com/v1',
        },
      }),
      { runModel: modelReturning(modelOutput, calls) },
    );

    expect(calls[0]?.providerId).toBe('openai-compatible');
    expect(calls[0]?.credentials.apiKey).toBe('sk-compat');
    expect(calls[0]?.credentials.baseUrl).toBe('https://llm.example.com/v1');
    expect(calls[0]?.request.modelConfig.model).toBe('llama-3.1');
  });

  it('baseUrl en un proveedor que no es openai-compatible -> NO se reenvia (se ignora)', async () => {
    const calls: ModelCallInput[] = [];
    const modelOutput = JSON.stringify({ reply: 'ok', spec: {}, complete: false });

    await runConfiguratorTurn(
      turnInput({
        credentials: { providerId: 'anthropic', apiKey: 'sk-ant', model: 'claude-sonnet-4-6', baseUrl: 'https://no.deberia/usarse' },
      }),
      { runModel: modelReturning(modelOutput, calls) },
    );

    expect(calls[0]?.providerId).toBe('anthropic');
    expect(calls[0]?.credentials.baseUrl).toBeUndefined();
  });

  it('AgentSpec parcial -> validation.ok=false con los requeridos faltantes (util para la UI)', async () => {
    const modelOutput = JSON.stringify({
      reply: 'Como se va a llamar tu agente?',
      spec: { description: 'aun construyendo' },
      complete: false,
    });

    const result = await runConfiguratorTurn(turnInput(), { runModel: modelReturning(modelOutput) });

    expect(result.spec).toEqual({ description: 'aun construyendo' });
    expect(result.complete).toBe(false);
    expect(result.validation.ok).toBe(false);
    if (!result.validation.ok) {
      expect(result.validation.errors.join('\n')).toMatch(/name|providerId|model/);
    }
    expect(result.modelError).toBeUndefined();
  });

  it('respuesta con JSON invalido -> estado de error manejable, NO crashea', async () => {
    const result = await runConfiguratorTurn(turnInput(), { runModel: modelReturning('esto no es JSON { roto') });

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

    const result = await runConfiguratorTurn(turnInput(), { runModel: modelReturning(wrapped) });

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

    const result = await runConfiguratorTurn(turnInput(), { runModel: modelReturning(modelOutput) });

    expect(result.validation.ok).toBe(false);
    if (!result.validation.ok) {
      expect(result.validation.errors.join('\n')).toMatch(/tool_que_no_existe/);
      expect(result.validation.errors.join('\n')).toMatch(/no existe en el catalogo/);
    }
  });

  it('fallo del proveedor de modelo -> estado de error manejable, NO crashea', async () => {
    const result = await runConfiguratorTurn(turnInput(), { runModel: modelThrows });

    expect(result.spec).toBeNull();
    expect(result.validation.ok).toBe(false);
    expect(result.modelError).toMatch(/No se pudo contactar el modelo/);
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
