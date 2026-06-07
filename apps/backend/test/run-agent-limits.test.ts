import { describe, it, expect, vi } from 'vitest';
import type { AgentEvent, NormalizedRequest, ProviderStreamEvent } from '@ledesma-platform/shared';
import { runAgent, AgentInputError } from '../src/agent/index.js';
import type { ModelCallInput } from '../src/providers/index.js';

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

function okRunModel(): (input: ModelCallInput) => AsyncIterable<ProviderStreamEvent> {
  return () =>
    (async function* () {
      yield { type: 'stop', reason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    })();
}

const baseRequest: NormalizedRequest = {
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
  modelConfig: { model: 'm', maxTokens: 128 },
};

describe('runAgent input validation', () => {
  it('lanza AgentInputError si el history esta vacio', async () => {
    const request: NormalizedRequest = { messages: [], modelConfig: { model: 'm', maxTokens: 128 } };
    await expect(
      collect(
        runAgent(
          { providerId: 'anthropic', credentials: { apiKey: 'sk' }, request },
          { executeTool: vi.fn(), runModel: okRunModel() },
        ),
      ),
    ).rejects.toBeInstanceOf(AgentInputError);
  });

  it('lanza AgentInputError si maxIterations es 0', async () => {
    await expect(
      collect(
        runAgent(
          { providerId: 'anthropic', credentials: { apiKey: 'sk' }, request: baseRequest, maxIterations: 0 },
          { executeTool: vi.fn(), runModel: okRunModel() },
        ),
      ),
    ).rejects.toBeInstanceOf(AgentInputError);
  });

  it('lanza AgentInputError si maxIterations excede el cap', async () => {
    await expect(
      collect(
        runAgent(
          { providerId: 'anthropic', credentials: { apiKey: 'sk' }, request: baseRequest, maxIterations: 999 },
          { executeTool: vi.fn(), runModel: okRunModel() },
        ),
      ),
    ).rejects.toBeInstanceOf(AgentInputError);
  });

  it('acepta una peticion valida dentro de limites', async () => {
    const events = await collect(
      runAgent(
        { providerId: 'anthropic', credentials: { apiKey: 'sk' }, request: baseRequest, maxIterations: 5 },
        { executeTool: vi.fn(), runModel: okRunModel() },
      ),
    );
    expect(events.at(-1)).toMatchObject({ type: 'stop' });
  });
});
