import { describe, it, expect, vi } from 'vitest';
import { assembleAgentRun, type AssembleAgentRunParams } from '../src/execution/assemble-agent-run.js';
import type { AgentConfig } from '../src/agents/types.js';
import type { NormalizedMessage } from '@ledesma-platform/shared';

const baseAgent: AgentConfig = {
  id: 'a1',
  name: 'Cotizador',
  description: '',
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
  systemPrompt: 'Eres cotizador',
  maxTokens: 512,
  temperature: 0.3,
  baseUrl: null,
  tools: [],
  webhookSecret: 'whsec_secreto_del_agente_0123456789abcdef',
  ownerId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const messages: NormalizedMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }];

function assemble(overrides: Partial<AssembleAgentRunParams> = {}) {
  return assembleAgentRun({
    agent: baseAgent,
    credential: { apiKey: 'sk-test' },
    messages,
    nativeTools: {},
    limits: { maxTokens: 9000, runTimeoutMs: 30_000 },
    ...overrides,
  });
}

describe('assembleAgentRun', () => {
  describe('NormalizedRequest desde la config del agente', () => {
    it('arma system, messages y modelConfig desde el agente (no desde el llamador)', () => {
      const { input } = assemble();
      expect(input.providerId).toBe('anthropic');
      expect(input.request.system).toBe('Eres cotizador');
      expect(input.request.messages).toBe(messages);
      expect(input.request.modelConfig).toEqual({
        model: 'claude-sonnet-4-6',
        maxTokens: 512,
        temperature: 0.3,
      });
    });

    it('omite system si el systemPrompt esta vacio', () => {
      const { input } = assemble({ agent: { ...baseAgent, systemPrompt: '' } });
      expect(input.request.system).toBeUndefined();
    });

    it('omite temperature de modelConfig si es null', () => {
      const { input } = assemble({ agent: { ...baseAgent, temperature: null } });
      expect(input.request.modelConfig).toEqual({ model: 'claude-sonnet-4-6', maxTokens: 512 });
      expect(input.request.modelConfig).not.toHaveProperty('temperature');
    });

    it('propaga limits y maxIterations al AgentRunInput', () => {
      const { input } = assemble({ limits: { maxTokens: 1234, runTimeoutMs: 5678 }, maxIterations: 4 });
      expect(input.maxTokens).toBe(1234);
      expect(input.runTimeoutMs).toBe(5678);
      expect(input.maxIterations).toBe(4);
    });

    it('omite maxIterations si no se pasa', () => {
      const { input } = assemble();
      expect(input).not.toHaveProperty('maxIterations');
    });
  });

  describe('credenciales y baseUrl', () => {
    it('pasa la apiKey y, para anthropic, sin baseUrl', () => {
      const { input } = assemble({ credential: { apiKey: 'sk-anthropic', baseUrl: 'https://ignored.example' } });
      expect(input.credentials.apiKey).toBe('sk-anthropic');
      // anthropic nunca usa baseUrl, aunque la credencial lo traiga.
      expect(input.credentials.baseUrl).toBeUndefined();
    });

    it('openai-compatible: el baseUrl de la credencial GUARDADA manda sobre el del agente', () => {
      const { input } = assemble({
        agent: { ...baseAgent, providerId: 'openai-compatible', baseUrl: 'https://agente.example/v1' },
        credential: { apiKey: 'sk-compat', baseUrl: 'https://credencial.example/v1' },
      });
      expect(input.credentials.baseUrl).toBe('https://credencial.example/v1');
    });

    it('openai-compatible: sin baseUrl en la credencial, cae al del agente', () => {
      const { input } = assemble({
        agent: { ...baseAgent, providerId: 'openai-compatible', baseUrl: 'https://agente.example/v1' },
        credential: { apiKey: 'sk-compat' },
      });
      expect(input.credentials.baseUrl).toBe('https://agente.example/v1');
    });

    it('openai-compatible: credencial con baseUrl null cae al del agente (igual que el route)', () => {
      const { input } = assemble({
        agent: { ...baseAgent, providerId: 'openai-compatible', baseUrl: 'https://agente.example/v1' },
        credential: { apiKey: 'sk-compat', baseUrl: null },
      });
      expect(input.credentials.baseUrl).toBe('https://agente.example/v1');
    });

    it('openai-compatible: sin baseUrl en ningun lado, no se setea', () => {
      const { input } = assemble({
        agent: { ...baseAgent, providerId: 'openai-compatible', baseUrl: null },
        credential: { apiKey: 'sk-compat' },
      });
      expect(input.credentials.baseUrl).toBeUndefined();
    });
  });

  describe('ensamblado de tools', () => {
    it('sin tools ni worker nativo: usa el registro demo (get_current_time)', () => {
      const { input } = assemble();
      expect((input.request.tools ?? []).map((t) => t.name)).toEqual(['get_current_time']);
    });

    it('con stored tools y sin worker: pasa sus definiciones (no la demo)', () => {
      const storedTool = {
        name: 'cotizar',
        description: 'Calcula el precio',
        inputSchema: { type: 'object' as const, properties: { piezas: { type: 'number' } } },
        url: 'https://hooks.cliente.com/cotizar',
      };
      const { input } = assemble({ agent: { ...baseAgent, tools: [storedTool] } });
      expect(input.request.tools).toEqual([
        { name: 'cotizar', description: 'Calcula el precio', inputSchema: storedTool.inputSchema },
      ]);
    });

    it('con worker nativo configurado: inyecta las tools nativas de plataforma', () => {
      const { input } = assemble({
        nativeTools: { workerUrl: 'https://worker.example', workerSecret: 'x'.repeat(32) },
      });
      const names = (input.request.tools ?? []).map((t) => t.name);
      expect(names).toContain('platform_iniciar_tarea_web');
      expect(names).toContain('platform_revisar_tarea_web');
    });

    it('dedupe: una tool de cliente que colisiona con una nativa se descarta y se avisa', () => {
      const warn = vi.fn();
      const colision = {
        name: 'platform_iniciar_tarea_web',
        description: 'falsa',
        inputSchema: { type: 'object' as const },
        url: 'https://hooks.cliente.com/x',
      };
      const { input } = assemble({
        agent: { ...baseAgent, tools: [colision] },
        nativeTools: { workerUrl: 'https://worker.example', workerSecret: 'x'.repeat(32) },
        warn,
      });
      // La nativa sobrevive una sola vez; la de cliente colisionada NO aparece.
      const occurrences = (input.request.tools ?? []).filter((t) => t.name === 'platform_iniciar_tarea_web');
      expect(occurrences).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('descartada por colision'));
    });
  });

  describe('executeTool (dispatch por nombre)', () => {
    it('despacha una tool del registro demo', async () => {
      const { executeTool } = assemble();
      const result = await executeTool({ id: 't1', name: 'get_current_time', input: {} });
      expect(result.isError).toBe(false);
    });

    it('con worker nativo pero sin clientExec: una tool no-nativa cae en "Tool desconocida"', async () => {
      const { executeTool } = assemble({
        nativeTools: { workerUrl: 'https://worker.example', workerSecret: 'x'.repeat(32) },
      });
      const result = await executeTool({ id: 't1', name: 'no_existe', input: {} });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Tool desconocida');
    });
  });
});
