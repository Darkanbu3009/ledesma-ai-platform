import { describe, it, expect } from 'vitest';
import type { AgentSpec, AgentSpecTool, NativeToolRef, WebhookToolSpec } from '../src/index.js';

describe('contrato AgentSpec', () => {
  it('se exporta desde el index de shared y modela el minimo (name + providerId + model)', () => {
    const spec: AgentSpec = {
      name: 'Cotizador',
      providerId: 'anthropic',
      model: 'claude-sonnet-4-6',
    };
    expect(spec.providerId).toBe('anthropic');
    expect(spec.tools).toBeUndefined();
  });

  it('la union de tools es discriminada por kind (native vs webhook)', () => {
    const native: NativeToolRef = { kind: 'native', name: 'platform_iniciar_tarea_web' };
    const webhook: WebhookToolSpec = {
      kind: 'webhook',
      name: 'cotizar',
      description: 'Calcula el precio de N piezas',
      inputSchema: { type: 'object', properties: { piezas: { type: 'number' } } },
      url: 'https://hooks.cliente.com/cotizar',
    };
    const tools: AgentSpecTool[] = [native, webhook];

    // El discriminador kind permite estrechar el tipo sin casts.
    const first = tools[0];
    expect(first?.kind).toBe('native');
    if (first?.kind === 'native') {
      expect(first.name).toBe('platform_iniciar_tarea_web');
    }
    const second = tools[1];
    if (second?.kind === 'webhook') {
      expect(second.url.startsWith('https://')).toBe(true);
      expect(second.inputSchema).toMatchObject({ type: 'object' });
    }
  });

  it('el discriminador kind funciona en runtime (switch exhaustivo sobre la union)', () => {
    // Ejercita la union como VALOR (no solo a nivel de tipos): un switch real sobre kind debe
    // estrechar a la variante correcta y exponer sus campos propios.
    function describeTool(tool: AgentSpecTool): string {
      switch (tool.kind) {
        case 'native':
          return `native:${tool.name}`;
        case 'webhook':
          return `webhook:${tool.name}->${tool.url}`;
        default: {
          const exhaustive: never = tool;
          return String(exhaustive);
        }
      }
    }
    expect(describeTool({ kind: 'native', name: 'platform_x' })).toBe('native:platform_x');
    expect(describeTool({ kind: 'webhook', name: 'c', description: 'd', inputSchema: {}, url: 'https://h/c' })).toBe(
      'webhook:c->https://h/c',
    );
  });

  it('mapea a los campos de creacion de agente (opcionales incluidos)', () => {
    const spec: AgentSpec = {
      name: 'Soporte',
      description: 'Atiende clientes',
      systemPrompt: 'Eres un agente de soporte',
      providerId: 'openai-compatible',
      model: 'llama-3.1-70b',
      maxTokens: 2048,
      temperature: 0.3,
      baseUrl: 'https://api.openrouter.ai/v1',
      tools: [{ kind: 'webhook', name: 'consultar', description: 'x', inputSchema: {}, url: 'https://h.example.com/c' }],
    };
    expect(spec.baseUrl).toBe('https://api.openrouter.ai/v1');
    expect(spec.temperature).toBe(0.3);
    expect(spec.tools).toHaveLength(1);
  });
});
