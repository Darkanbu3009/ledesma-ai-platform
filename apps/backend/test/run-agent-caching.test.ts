import { describe, it, expect, vi } from 'vitest';
import { FakeProvider } from '@ledesma-platform/shared';
import type {
  AgentEvent,
  NormalizedRequest,
  ProviderStreamEvent,
} from '@ledesma-platform/shared';
import { runAgent, type AgentDeps, type ToolExecutor } from '../src/agent/index.js';
import type { ModelCallInput } from '../src/providers/index.js';

const request: NormalizedRequest = {
  system: 'Sos un agente',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
  tools: [{ name: 'buscar', description: 'busca', inputSchema: { type: 'object' } }],
  modelConfig: { model: 'm', maxTokens: 256 },
};

function fakeRunModel(
  fake: FakeProvider,
): (input: ModelCallInput) => AsyncIterable<ProviderStreamEvent> {
  return (input: ModelCallInput) =>
    fake.stream({ credentials: input.credentials, request: input.request, signal: input.signal });
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

const executeTool = vi.fn<ToolExecutor>(async () => ({ content: 'res', isError: false }));

describe('runAgent: contabilidad de prompt caching', () => {
  it('acumula cache_read/cache_write a traves de las iteraciones cuando el proveedor los reporta', async () => {
    const fake = new FakeProvider([
      [
        { type: 'tool_use', id: 't1', name: 'buscar', input: {} },
        {
          type: 'stop',
          reason: 'tool_use',
          usage: { inputTokens: 100, outputTokens: 10, cacheWriteTokens: 1500, cacheReadTokens: 0 },
        },
      ],
      [
        { type: 'text_delta', text: 'listo' },
        {
          type: 'stop',
          reason: 'end_turn',
          usage: { inputTokens: 40, outputTokens: 8, cacheWriteTokens: 200, cacheReadTokens: 1500 },
        },
      ],
    ]);

    const events = await collect(
      runAgent(
        { providerId: 'anthropic', credentials: { apiKey: 'sk-A' }, request },
        { executeTool, runModel: fakeRunModel(fake) } satisfies AgentDeps,
      ),
    );

    const stop = events.at(-1);
    expect(stop).toEqual({
      type: 'stop',
      reason: 'end_turn',
      usage: {
        inputTokens: 140,
        outputTokens: 18,
        cacheWriteTokens: 1700,
        cacheReadTokens: 1500,
      },
    });
  });

  it('sin campos de cache (proveedor sin caching) la usage no cambia de forma', async () => {
    const fake = new FakeProvider([
      [
        { type: 'text_delta', text: 'ok' },
        { type: 'stop', reason: 'end_turn', usage: { inputTokens: 12, outputTokens: 3 } },
      ],
    ]);

    const events = await collect(
      runAgent(
        { providerId: 'openai', credentials: { apiKey: 'sk-A' }, request },
        { executeTool, runModel: fakeRunModel(fake) },
      ),
    );

    // Forma identica a la actual: solo input/output, sin claves de cache.
    expect(events.at(-1)).toEqual({
      type: 'stop',
      reason: 'end_turn',
      usage: { inputTokens: 12, outputTokens: 3 },
    });
  });

  it('el caching es transparente al output: mismos eventos con y sin cache, solo cambia la usage', async () => {
    const script = (withCache: boolean): ProviderStreamEvent[][] => [
      [
        { type: 'text_delta', text: 'Calculando' },
        { type: 'tool_use', id: 't1', name: 'buscar', input: { q: 1 } },
        {
          type: 'stop',
          reason: 'tool_use',
          usage: withCache
            ? { inputTokens: 50, outputTokens: 5, cacheWriteTokens: 900 }
            : { inputTokens: 50, outputTokens: 5 },
        },
      ],
      [
        { type: 'text_delta', text: 'Son 1500' },
        {
          type: 'stop',
          reason: 'end_turn',
          usage: withCache
            ? { inputTokens: 20, outputTokens: 4, cacheReadTokens: 900 }
            : { inputTokens: 70, outputTokens: 4 },
        },
      ],
    ];

    const run = (withCache: boolean) =>
      collect(
        runAgent(
          { providerId: 'anthropic', credentials: { apiKey: 'sk-A' }, request },
          { executeTool, runModel: fakeRunModel(new FakeProvider(script(withCache))) },
        ),
      );

    const withCaching = await run(true);
    const withoutCaching = await run(false);

    // Todo lo que ve el consumidor salvo la usage debe ser identico: mismos deltas, tool_use, tool_result.
    const stripUsage = (events: AgentEvent[]) =>
      events.map((e) => (e.type === 'stop' ? { type: e.type, reason: e.reason } : e));
    expect(stripUsage(withCaching)).toEqual(stripUsage(withoutCaching));
  });
});
