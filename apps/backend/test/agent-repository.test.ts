import { describe, it, expect, vi } from 'vitest';
import { AgentRepository } from '../src/agents/agent-repository.js';
import type { Sql } from '../src/db/client.js';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Cotizador',
    description: 'Agente de cotizaciones',
    provider_id: 'anthropic',
    model: 'claude-sonnet-4-6',
    system_prompt: 'Eres un cotizador',
    max_tokens: 1024,
    temperature: 0.2,
    base_url: null,
    tools: [{ name: 'cotizar', description: 'x', inputSchema: { type: 'object' } }],
    webhook_secret: 'whsec_fila_de_prueba_001122',
    owner_id: null,
    created_at: '2026-06-07T00:00:00.000Z',
    updated_at: '2026-06-07T00:00:00.000Z',
    ...overrides,
  };
}

/** Mock del tagged template `sql`: devuelve el resultado preprogramado. */
function makeSqlReturning(result: unknown[]): Sql {
  const fn = vi.fn(async () => result) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

describe('AgentRepository', () => {
  it('mapea una fila de DB a AgentConfig (snake_case -> camelCase)', async () => {
    const repo = new AgentRepository(makeSqlReturning([makeRow()]));
    const agent = await repo.getById('11111111-1111-1111-1111-111111111111');
    expect(agent).toMatchObject({
      id: '11111111-1111-1111-1111-111111111111',
      providerId: 'anthropic',
      model: 'claude-sonnet-4-6',
      systemPrompt: 'Eres un cotizador',
      maxTokens: 1024,
      temperature: 0.2,
      tools: [{ name: 'cotizar', description: 'x', inputSchema: { type: 'object' } }],
      webhookSecret: 'whsec_fila_de_prueba_001122',
    });
  });

  it('getById devuelve null si no hay filas', async () => {
    const repo = new AgentRepository(makeSqlReturning([]));
    expect(await repo.getById('no-existe')).toBeNull();
  });

  it('list mapea todas las filas', async () => {
    const repo = new AgentRepository(makeSqlReturning([makeRow(), makeRow({ id: '22222222-2222-2222-2222-222222222222' })]));
    const agents = await repo.list();
    expect(agents).toHaveLength(2);
  });

  it('remove devuelve true si borro y false si no', async () => {
    expect(await new AgentRepository(makeSqlReturning([{ id: 'x' }])).remove('x')).toBe(true);
    expect(await new AgentRepository(makeSqlReturning([])).remove('x')).toBe(false);
  });

  it('rotateWebhookSecret incluye owner_id en el where y mapea el returning', async () => {
    const sql = makeSqlReturning([makeRow({ webhook_secret: 'whsec_rotado_998877' })]);
    const repo = new AgentRepository(sql);
    const agent = await repo.rotateWebhookSecret('11111111-1111-1111-1111-111111111111', 'user-1');
    expect(agent?.webhookSecret).toBe('whsec_rotado_998877');

    const [strings, ...values] = (sql as unknown as { mock: { calls: [string[], ...unknown[]][] } }).mock.calls[0];
    const texto = strings.join('<param>');
    expect(texto).toContain("webhook_secret = 'whsec_' || encode(gen_random_bytes(24), 'hex')");
    expect(texto).toMatch(/where id = <param> and owner_id = <param>/);
    expect(texto).toContain('returning *');
    expect(values).toEqual(['11111111-1111-1111-1111-111111111111', 'user-1']);
  });

  it('rotateWebhookSecret devuelve null si no hay fila (agente ajeno o inexistente)', async () => {
    const repo = new AgentRepository(makeSqlReturning([]));
    expect(await repo.rotateWebhookSecret('no-existe', 'user-2')).toBeNull();
  });

  it('NUNCA expone un campo de api key en el AgentConfig', async () => {
    const repo = new AgentRepository(makeSqlReturning([makeRow()]));
    const agent = await repo.getById('11111111-1111-1111-1111-111111111111');
    const serialized = JSON.stringify(agent);
    expect(serialized.toLowerCase()).not.toContain('apikey');
    expect(serialized.toLowerCase()).not.toContain('api_key');
    expect(agent).not.toHaveProperty('apiKey');
    expect(Object.keys(agent ?? {})).not.toContain('apiKey');
  });
});
