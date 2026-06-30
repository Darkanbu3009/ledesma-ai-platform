import { describe, it, expect } from 'vitest';
import {
  ConfiguratorPasteSchema,
  configuratorBody,
  configuratorHeaders,
  specToAgentInput,
  type AgentSpecDraft,
  type ConfiguratorMessage,
  type CredentialSession,
} from '../src/lib/configurator';

/**
 * Tests de los helpers PUROS del Configurador (sin red ni DOM): cubren las reglas que el contrato y
 * los criterios de aceptacion exigen. El comportamiento de los componentes (chat, preview, gate del
 * boton crear) no se testea con render porque la consola no tiene infra de tests de componentes
 * (vitest corre en environment 'node'); queda cubierto por typecheck/lint/build y estos helpers, que
 * son la logica que decide headers, body, validacion de credencial al momento y el mapeo a creacion.
 */

const messages: ConfiguratorMessage[] = [{ role: 'user', content: 'hola' }];

const savedSession: CredentialSession = {
  mode: 'saved',
  credentialId: 'cred-123',
  label: 'Mi llave',
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
  baseUrl: null,
};

const pasteSession: CredentialSession = {
  mode: 'paste',
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
  apiKey: 'sk-test',
  baseUrl: null,
};

describe('configuratorHeaders', () => {
  it('credencial guardada manda x-credential-id (no la key)', () => {
    expect(configuratorHeaders(savedSession)).toEqual({ 'x-credential-id': 'cred-123' });
  });

  it('credencial al momento manda x-provider-key', () => {
    expect(configuratorHeaders(pasteSession)).toEqual({ 'x-provider-key': 'sk-test' });
  });
});

describe('configuratorBody', () => {
  it('manda el historial completo, providerId y model', () => {
    const body = configuratorBody(pasteSession, messages);
    expect(body.messages).toEqual(messages);
    expect(body.providerId).toBe('anthropic');
    expect(body.model).toBe('claude-sonnet-4-6');
  });

  it('no incluye baseUrl para proveedores que no son openai-compatible', () => {
    expect(configuratorBody(pasteSession, messages).baseUrl).toBeUndefined();
  });

  it('incluye baseUrl para openai-compatible al momento', () => {
    const session: CredentialSession = {
      mode: 'paste',
      providerId: 'openai-compatible',
      model: 'llama-3.3-70b',
      apiKey: 'sk-test',
      baseUrl: 'https://api.miproveedor.com/v1',
    };
    expect(configuratorBody(session, messages).baseUrl).toBe('https://api.miproveedor.com/v1');
  });

  it('incluye baseUrl de la credencial guardada openai-compatible', () => {
    const session: CredentialSession = {
      mode: 'saved',
      credentialId: 'cred-9',
      label: 'OSS',
      providerId: 'openai-compatible',
      model: 'llama-3.3-70b',
      baseUrl: 'https://api.miproveedor.com/v1',
    };
    expect(configuratorBody(session, messages).baseUrl).toBe('https://api.miproveedor.com/v1');
  });

  it('mode default es assistant (clientes que no lo pasan no cambian de comportamiento)', () => {
    expect(configuratorBody(pasteSession, messages).mode).toBe('assistant');
  });

  it('reenvia el mode autonomo cuando se pide explicitamente', () => {
    expect(configuratorBody(pasteSession, messages, 'autonomous').mode).toBe('autonomous');
  });
});

describe('specToAgentInput', () => {
  it('mapea un spec minimo con los defaults del alta manual', () => {
    const spec: AgentSpecDraft = {
      name: 'Mi agente',
      providerId: 'anthropic',
      model: 'claude-sonnet-4-6',
    };
    expect(specToAgentInput(spec)).toEqual({
      name: 'Mi agente',
      description: '',
      providerId: 'anthropic',
      model: 'claude-sonnet-4-6',
      systemPrompt: '',
      maxTokens: 1024,
      temperature: null,
      baseUrl: null,
      tools: [],
    });
  });

  it('devuelve null si falta un requerido (name/providerId/model)', () => {
    expect(specToAgentInput({ providerId: 'anthropic', model: 'm' })).toBeNull();
    expect(specToAgentInput({ name: 'x', model: 'm' })).toBeNull();
    expect(specToAgentInput({ name: 'x', providerId: 'anthropic' })).toBeNull();
  });

  it('conserva baseUrl solo para openai-compatible', () => {
    const compatible = specToAgentInput({
      name: 'a',
      providerId: 'openai-compatible',
      model: 'm',
      baseUrl: 'https://api.x.com/v1',
    });
    expect(compatible?.baseUrl).toBe('https://api.x.com/v1');

    const anthropicWithBaseUrl = specToAgentInput({
      name: 'a',
      providerId: 'anthropic',
      model: 'm',
      baseUrl: 'https://api.x.com/v1',
    });
    expect(anthropicWithBaseUrl?.baseUrl).toBeNull();
  });

  it('preserva temperature 0 (no la convierte en null)', () => {
    const result = specToAgentInput({
      name: 'a',
      providerId: 'anthropic',
      model: 'm',
      temperature: 0,
    });
    expect(result?.temperature).toBe(0);
  });

  it('descarta tools nativas y conserva las webhook sin el discriminador kind', () => {
    const result = specToAgentInput({
      name: 'a',
      providerId: 'anthropic',
      model: 'm',
      tools: [
        { kind: 'native', name: 'platform_web_search' },
        {
          kind: 'webhook',
          name: 'crear_ticket',
          description: 'Abre un ticket',
          inputSchema: { type: 'object', properties: {} },
          url: 'https://api.x.com/hook',
        },
      ],
    });
    expect(result?.tools).toEqual([
      {
        name: 'crear_ticket',
        description: 'Abre un ticket',
        inputSchema: { type: 'object', properties: {} },
        url: 'https://api.x.com/hook',
      },
    ]);
  });
});

describe('ConfiguratorPasteSchema', () => {
  it('openai-compatible sin baseUrl falla con issue en baseUrl', () => {
    const result = ConfiguratorPasteSchema.safeParse({
      providerId: 'openai-compatible',
      model: 'm',
      apiKey: 'sk-test',
      baseUrl: '',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path[0] === 'baseUrl')).toBe(true);
  });

  it('openai-compatible con baseUrl es valido', () => {
    const result = ConfiguratorPasteSchema.safeParse({
      providerId: 'openai-compatible',
      model: 'm',
      apiKey: 'sk-test',
      baseUrl: 'https://api.x.com/v1',
    });
    expect(result.success).toBe(true);
  });

  it('anthropic sin baseUrl es valido', () => {
    const result = ConfiguratorPasteSchema.safeParse({
      providerId: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-test',
      baseUrl: '',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza apiKey vacia y model vacio', () => {
    expect(
      ConfiguratorPasteSchema.safeParse({
        providerId: 'anthropic',
        model: 'm',
        apiKey: '',
        baseUrl: '',
      }).success,
    ).toBe(false);
    expect(
      ConfiguratorPasteSchema.safeParse({
        providerId: 'anthropic',
        model: '',
        apiKey: 'sk-test',
        baseUrl: '',
      }).success,
    ).toBe(false);
  });
});
