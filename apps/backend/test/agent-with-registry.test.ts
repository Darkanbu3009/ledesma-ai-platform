import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { FakeProvider } from '@ledesma-platform/shared';
import type { AgentEvent, NormalizedRequest, ProviderStreamEvent } from '@ledesma-platform/shared';
import { runAgent } from '../src/agent/index.js';
import type { ModelCallInput } from '../src/providers/index.js';
import { ToolRegistry } from '../src/tools/index.js';

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

describe('integracion registro + loop', () => {
  it('el modelo pide una tool, el registro la valida y ejecuta, y el resultado se reinyecta', async () => {
    const registry = new ToolRegistry().register({
      name: 'cotizar',
      description: 'Calcula el precio de N piezas',
      inputSchema: z.object({ piezas: z.number().int().positive() }),
      handler: (input) => `precio: ${input.piezas * 150} MXN`,
    });

    const fake = new FakeProvider([
      [
        { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: { piezas: 10 } },
        { type: 'stop', reason: 'tool_use', usage: { inputTokens: 5, outputTokens: 3 } },
      ],
      [
        { type: 'text_delta', text: 'Son 1500 MXN' },
        { type: 'stop', reason: 'end_turn', usage: { inputTokens: 8, outputTokens: 4 } },
      ],
    ]);

    const request: NormalizedRequest = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'cotiza 10' }] }],
      tools: registry.toToolDefinitions(),
      modelConfig: { model: 'm', maxTokens: 256 },
    };

    const events = await collect(
      runAgent(
        { providerId: 'anthropic', credentials: { apiKey: 'sk-A' }, request },
        {
          executeTool: registry.toExecutor(),
          runModel: (input: ModelCallInput) =>
            fake.stream({ credentials: input.credentials, request: input.request, signal: input.signal }) as AsyncIterable<ProviderStreamEvent>,
        },
      ),
    );

    expect(events).toContainEqual({
      type: 'tool_result',
      toolUseId: 'tu_1',
      content: 'precio: 1500 MXN',
      isError: false,
    });
    expect(events.at(-1)).toEqual({
      type: 'stop',
      reason: 'end_turn',
      usage: { inputTokens: 13, outputTokens: 7 },
    });
  });

  it('input invalido del modelo: el registro responde isError y el modelo se corrige en la 2da ronda', async () => {
    const registry = new ToolRegistry().register({
      name: 'cotizar',
      description: 'x',
      inputSchema: z.object({ piezas: z.number().int().positive() }),
      handler: (input) => `precio: ${input.piezas * 150} MXN`,
    });

    const fake = new FakeProvider([
      [
        { type: 'tool_use', id: 'tu_1', name: 'cotizar', input: { piezas: -1 } },
        { type: 'stop', reason: 'tool_use' },
      ],
      [
        { type: 'tool_use', id: 'tu_2', name: 'cotizar', input: { piezas: 3 } },
        { type: 'stop', reason: 'tool_use' },
      ],
      [{ type: 'text_delta', text: 'listo' }, { type: 'stop', reason: 'end_turn' }],
    ]);

    const request: NormalizedRequest = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'cotiza' }] }],
      tools: registry.toToolDefinitions(),
      modelConfig: { model: 'm', maxTokens: 256 },
    };

    const events = await collect(
      runAgent(
        { providerId: 'anthropic', credentials: { apiKey: 'sk-A' }, request },
        {
          executeTool: registry.toExecutor(),
          runModel: (input: ModelCallInput) =>
            fake.stream({ credentials: input.credentials, request: input.request, signal: input.signal }) as AsyncIterable<ProviderStreamEvent>,
        },
      ),
    );

    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults[0]).toMatchObject({ toolUseId: 'tu_1', isError: true });
    expect(toolResults[1]).toMatchObject({ toolUseId: 'tu_2', content: 'precio: 450 MXN', isError: false });
  });
});
