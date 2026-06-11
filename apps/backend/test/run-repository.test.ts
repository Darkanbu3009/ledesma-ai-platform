import { describe, it, expect, vi } from 'vitest';
import { AgentRunRepository } from '../src/agents/run-repository.js';
import type { Sql } from '../src/db/client.js';

/** Mock del tagged template `sql`: devuelve el resultado preprogramado. */
function makeSqlReturning(result: unknown[]): Sql {
  return vi.fn(async () => result) as unknown as Sql;
}

describe('AgentRunRepository', () => {
  it('record ejecuta el insert sin lanzar', async () => {
    const sql = makeSqlReturning([]);
    const repo = new AgentRunRepository(sql);
    await expect(
      repo.record({
        agentId: '11111111-1111-1111-1111-111111111111',
        ownerId: 'user-1',
        providerId: 'anthropic',
        model: 'claude-sonnet-4-6',
        inputTokens: 5,
        outputTokens: 3,
        stopReason: 'end_turn',
        status: 'completed',
        errorCode: null,
        durationMs: 240,
      }),
    ).resolves.toBeUndefined();
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it('totalsForAgent mapea counts y sums (strings de postgres) a number', async () => {
    const repo = new AgentRunRepository(
      makeSqlReturning([{ runs: '7', completed: '5', errors: '2', input_tokens: '120', output_tokens: '45' }]),
    );
    expect(await repo.totalsForAgent('a1')).toEqual({
      runs: 7,
      completed: 5,
      errors: 2,
      inputTokens: 120,
      outputTokens: 45,
    });
  });

  it('totalsForAgent devuelve ceros si no hay fila', async () => {
    const repo = new AgentRunRepository(makeSqlReturning([]));
    expect(await repo.totalsForAgent('a1')).toEqual({
      runs: 0,
      completed: 0,
      errors: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it('recentForAgent mapea snake_case a camelCase con createdAt ISO', async () => {
    const repo = new AgentRunRepository(
      makeSqlReturning([
        {
          id: 'r1',
          status: 'error',
          error_code: 'AUTHENTICATION',
          input_tokens: 5,
          output_tokens: 0,
          duration_ms: 87,
          created_at: '2026-06-10T12:00:00.000Z',
        },
        {
          id: 'r2',
          status: 'completed',
          error_code: null,
          input_tokens: 8,
          output_tokens: 4,
          duration_ms: 1200,
          created_at: new Date('2026-06-09T08:30:00.000Z'),
        },
      ]),
    );
    expect(await repo.recentForAgent('a1')).toEqual([
      {
        id: 'r1',
        status: 'error',
        errorCode: 'AUTHENTICATION',
        inputTokens: 5,
        outputTokens: 0,
        durationMs: 87,
        createdAt: '2026-06-10T12:00:00.000Z',
      },
      {
        id: 'r2',
        status: 'completed',
        errorCode: null,
        inputTokens: 8,
        outputTokens: 4,
        durationMs: 1200,
        createdAt: '2026-06-09T08:30:00.000Z',
      },
    ]);
  });
});
