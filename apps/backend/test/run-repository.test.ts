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

  it('totalsForAgent con range agrega las condiciones de fecha al where', async () => {
    const sql = makeSqlReturning([
      { runs: '2', completed: '2', errors: '0', input_tokens: '10', output_tokens: '4' },
    ]);
    const repo = new AgentRunRepository(sql);
    const from = new Date('2026-06-01T00:00:00.000Z');
    const to = new Date('2026-06-10T23:59:59.000Z');

    await repo.totalsForAgent('a1', { from, to });

    // Cada fragmento es una llamada al tagged template: (strings, ...values).
    const calls = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const fragments = calls.map((call) => ({
      text: (call[0] as readonly string[]).join('?'),
      values: call.slice(1),
    }));
    expect(fragments.some((f) => f.text.includes('created_at >=') && f.values.includes(from))).toBe(true);
    expect(fragments.some((f) => f.text.includes('created_at <=') && f.values.includes(to))).toBe(true);
  });

  it('runsByDay mapea day a YYYY-MM-DD y castea counts/sums a number', async () => {
    const repo = new AgentRunRepository(
      makeSqlReturning([
        { day: new Date('2026-06-09T00:00:00.000Z'), runs: '3', input_tokens: '120', output_tokens: '45' },
        { day: '2026-06-10T00:00:00.000Z', runs: '1', input_tokens: '8', output_tokens: '2' },
      ]),
    );
    expect(await repo.runsByDay('a1')).toEqual([
      { date: '2026-06-09', runs: 3, inputTokens: 120, outputTokens: 45 },
      { date: '2026-06-10', runs: 1, inputTokens: 8, outputTokens: 2 },
    ]);
  });

  it('runsByDay devuelve lista vacia si no hay filas', async () => {
    const repo = new AgentRunRepository(makeSqlReturning([]));
    expect(await repo.runsByDay('a1')).toEqual([]);
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
