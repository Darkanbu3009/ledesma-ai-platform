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

  it('record inserta las columnas de cache; con caching graba los valores reportados', async () => {
    const sql = makeSqlReturning([]);
    const repo = new AgentRunRepository(sql);
    await repo.record({
      agentId: '22222222-2222-2222-2222-222222222222',
      ownerId: 'user-1',
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      inputTokens: 40,
      outputTokens: 8,
      cacheReadTokens: 1500,
      cacheWriteTokens: 200,
      stopReason: 'end_turn',
      status: 'completed',
      errorCode: null,
      durationMs: 120,
    });
    const call = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const text = (call?.[0] as readonly string[]).join('?');
    const values = call?.slice(1);
    expect(text).toContain('cache_read_tokens');
    expect(text).toContain('cache_write_tokens');
    expect(values).toContain(1500);
    expect(values).toContain(200);
  });

  it('record sin campos de cache (proveedor sin caching) los graba como 0', async () => {
    const sql = makeSqlReturning([]);
    const repo = new AgentRunRepository(sql);
    await repo.record({
      agentId: '33333333-3333-3333-3333-333333333333',
      ownerId: 'user-2',
      providerId: 'openai',
      model: 'gpt',
      inputTokens: 10,
      outputTokens: 4,
      stopReason: 'end_turn',
      status: 'completed',
      errorCode: null,
      durationMs: 90,
    });
    const call = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    // undefined -> 0: el ?? 0 en el repo cubre a los proveedores/corridas sin caching.
    const values = call?.slice(1);
    expect(values).not.toContain(undefined);
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

describe('AgentRunRepository robustez ante tokens nulos y multiples proveedores', () => {
  /** Captura los textos SQL de cada llamada al tagged template (strings unidos por ?). */
  function sqlTexts(sql: Sql): string[] {
    return (sql as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as readonly string[]).join('?'));
  }

  it('totalsForAgent: sums null (todas corridas de error sin tokens) -> 0, sin NaN; runs cuentan', async () => {
    const repo = new AgentRunRepository(
      makeSqlReturning([{ runs: '3', completed: '0', errors: '3', input_tokens: null, output_tokens: null }]),
    );
    const totals = await repo.totalsForAgent('a1');
    expect(totals).toEqual({ runs: 3, completed: 0, errors: 3, inputTokens: 0, outputTokens: 0 });
    expect(Number.isNaN(totals.inputTokens)).toBe(false);
    expect(Number.isNaN(totals.outputTokens)).toBe(false);
  });

  it('totalsForAgent: usa COALESCE en las sumas de tokens', async () => {
    const sql = makeSqlReturning([{ runs: '0', completed: '0', errors: '0', input_tokens: '0', output_tokens: '0' }]);
    await new AgentRunRepository(sql).totalsForAgent('a1');
    const texts = sqlTexts(sql);
    expect(texts.some((t) => t.includes('coalesce(sum(input_tokens), 0)'))).toBe(true);
    expect(texts.some((t) => t.includes('coalesce(sum(output_tokens), 0)'))).toBe(true);
  });

  it('recentForAgent: filas mixtas con output_tokens null -> 0 (number, no null, no NaN); la corrida de error SI cuenta', async () => {
    const repo = new AgentRunRepository(
      makeSqlReturning([
        // corrida de error de un proveedor que no registro tokens
        { id: 'r1', status: 'error', error_code: 'UPSTREAM_TIMEOUT', input_tokens: null, output_tokens: null, duration_ms: 5000, created_at: '2026-06-13T10:00:00.000Z' },
        // corrida de otro proveedor con input pero output null
        { id: 'r2', status: 'error', error_code: 'RATE_LIMIT', input_tokens: 120, output_tokens: null, duration_ms: 90, created_at: '2026-06-13T09:00:00.000Z' },
        // corrida completada normal
        { id: 'r3', status: 'completed', error_code: null, input_tokens: 80, output_tokens: 30, duration_ms: 300, created_at: '2026-06-12T10:00:00.000Z' },
      ]),
    );
    const recent = await repo.recentForAgent('a1');
    expect(recent).toHaveLength(3); // las corridas de error cuentan como corrida
    expect(recent[0]).toEqual({ id: 'r1', status: 'error', errorCode: 'UPSTREAM_TIMEOUT', inputTokens: 0, outputTokens: 0, durationMs: 5000, createdAt: '2026-06-13T10:00:00.000Z' });
    expect(recent[1]).toMatchObject({ id: 'r2', inputTokens: 120, outputTokens: 0 });
    for (const r of recent) {
      expect(typeof r.inputTokens).toBe('number');
      expect(typeof r.outputTokens).toBe('number');
      expect(Number.isNaN(r.inputTokens)).toBe(false);
      expect(Number.isNaN(r.outputTokens)).toBe(false);
    }
  });

  it('recentForAgent: usa COALESCE(input_tokens, 0)/COALESCE(output_tokens, 0) en el SQL', async () => {
    const sql = makeSqlReturning([]);
    await new AgentRunRepository(sql).recentForAgent('a1');
    const texts = sqlTexts(sql);
    expect(texts.some((t) => t.includes('coalesce(input_tokens, 0)'))).toBe(true);
    expect(texts.some((t) => t.includes('coalesce(output_tokens, 0)'))).toBe(true);
  });

  it('recentForAgent: created_at nulo no lanza, degrada a epoch (no 500)', async () => {
    const repo = new AgentRunRepository(
      makeSqlReturning([
        { id: 'r1', status: 'error', error_code: 'X', input_tokens: 0, output_tokens: 0, duration_ms: 0, created_at: null },
      ]),
    );
    const recent = await repo.recentForAgent('a1');
    expect(recent).toHaveLength(1);
    expect(recent[0]?.createdAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('runsByDay: sums null -> 0 manteniendo el conteo de corridas del dia', async () => {
    const repo = new AgentRunRepository(
      makeSqlReturning([{ day: '2026-06-13T00:00:00.000Z', runs: '3', input_tokens: null, output_tokens: null }]),
    );
    expect(await repo.runsByDay('a1')).toEqual([{ date: '2026-06-13', runs: 3, inputTokens: 0, outputTokens: 0 }]);
  });

  it('runsByDay: un bucket con fecha no parseable se omite sin lanzar', async () => {
    const repo = new AgentRunRepository(
      makeSqlReturning([
        { day: null, runs: '1', input_tokens: '5', output_tokens: '2' },
        { day: '2026-06-13T00:00:00.000Z', runs: '3', input_tokens: '10', output_tokens: '4' },
      ]),
    );
    expect(await repo.runsByDay('a1')).toEqual([{ date: '2026-06-13', runs: 3, inputTokens: 10, outputTokens: 4 }]);
  });
});

describe('AgentRunRepository lecturas POR OWNER (dashboard)', () => {
  /** Textos SQL de cada llamada al tagged template (strings unidos por ?). */
  function sqlTexts(sql: Sql): string[] {
    return (sql as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as readonly string[]).join('?'));
  }

  describe('totalsForOwner', () => {
    it('AISLAMIENTO: filtra por owner_id y trae los 4 cubos de tokens + last_run_at (max)', async () => {
      const sql = makeSqlReturning([
        {
          runs: '9',
          completed: '7',
          errors: '2',
          input_tokens: '1000',
          output_tokens: '400',
          cache_read_tokens: '5000',
          cache_write_tokens: '250',
          last_run_at: '2026-06-30T12:00:00.000Z',
        },
      ]);
      const totals = await new AgentRunRepository(sql).totalsForOwner('user-1');
      expect(totals).toEqual({
        runs: 9,
        completed: 7,
        errors: 2,
        inputTokens: 1000,
        outputTokens: 400,
        cacheReadTokens: 5000,
        cacheWriteTokens: 250,
        lastRunAt: '2026-06-30T12:00:00.000Z',
      });
      const texts = sqlTexts(sql);
      expect(texts.some((t) => t.includes('where owner_id = '))).toBe(true);
      expect(texts.some((t) => t.includes('coalesce(sum(cache_read_tokens), 0)'))).toBe(true);
      expect(texts.some((t) => t.includes('coalesce(sum(cache_write_tokens), 0)'))).toBe(true);
      expect(texts.some((t) => t.includes('max(created_at)'))).toBe(true);
      // El owner viaja como parametro del template (junto a los fragmentos de rango).
      const allValues = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls.flatMap((c) => c.slice(1));
      expect(allValues).toContain('user-1');
    });

    it('owner sin corridas -> ceros en los 4 cubos y lastRunAt null (no NaN, no error)', async () => {
      // max() sobre cero filas llega null; los sums vienen coalesce'ados a 0 en SQL.
      const sql = makeSqlReturning([
        {
          runs: '0',
          completed: '0',
          errors: '0',
          input_tokens: '0',
          output_tokens: '0',
          cache_read_tokens: '0',
          cache_write_tokens: '0',
          last_run_at: null,
        },
      ]);
      const totals = await new AgentRunRepository(sql).totalsForOwner('user-1');
      expect(totals).toEqual({
        runs: 0,
        completed: 0,
        errors: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        lastRunAt: null,
      });
      expect(Number.isNaN(totals.cacheReadTokens)).toBe(false);
    });

    it('sin fila alguna (conjunto vacio) degrada a ceros/null sin lanzar', async () => {
      const totals = await new AgentRunRepository(makeSqlReturning([])).totalsForOwner('user-1');
      expect(totals).toEqual({
        runs: 0,
        completed: 0,
        errors: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        lastRunAt: null,
      });
    });

    it('con range agrega las condiciones de fecha al where', async () => {
      const sql = makeSqlReturning([
        {
          runs: '1',
          completed: '1',
          errors: '0',
          input_tokens: '5',
          output_tokens: '3',
          cache_read_tokens: '0',
          cache_write_tokens: '0',
          last_run_at: '2026-06-05T00:00:00.000Z',
        },
      ]);
      const from = new Date('2026-06-01T00:00:00.000Z');
      const to = new Date('2026-06-10T23:59:59.000Z');
      await new AgentRunRepository(sql).totalsForOwner('user-1', { from, to });
      const fragments = (sql as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => ({
        text: (call[0] as readonly string[]).join('?'),
        values: call.slice(1),
      }));
      expect(fragments.some((f) => f.text.includes('created_at >=') && f.values.includes(from))).toBe(true);
      expect(fragments.some((f) => f.text.includes('created_at <=') && f.values.includes(to))).toBe(true);
    });
  });

  describe('runsByDayForOwner', () => {
    it('mapea day a YYYY-MM-DD y castea los 4 cubos por dia a number', async () => {
      const sql = makeSqlReturning([
        {
          day: '2026-06-09T00:00:00.000Z',
          runs: '3',
          input_tokens: '120',
          output_tokens: '45',
          cache_read_tokens: '900',
          cache_write_tokens: '30',
        },
      ]);
      expect(await new AgentRunRepository(sql).runsByDayForOwner('user-1')).toEqual([
        { date: '2026-06-09', runs: 3, inputTokens: 120, outputTokens: 45, cacheReadTokens: 900, cacheWriteTokens: 30 },
      ]);
      expect(sqlTexts(sql).some((t) => t.includes('where owner_id = '))).toBe(true);
    });

    it('sums null -> 0 manteniendo el conteo del dia; bucket con fecha no parseable se omite', async () => {
      const sql = makeSqlReturning([
        { day: null, runs: '1', input_tokens: '5', output_tokens: '2', cache_read_tokens: null, cache_write_tokens: null },
        {
          day: '2026-06-13T00:00:00.000Z',
          runs: '3',
          input_tokens: null,
          output_tokens: null,
          cache_read_tokens: null,
          cache_write_tokens: null,
        },
      ]);
      expect(await new AgentRunRepository(sql).runsByDayForOwner('user-1')).toEqual([
        { date: '2026-06-13', runs: 3, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ]);
    });

    it('owner sin corridas -> serie vacia', async () => {
      expect(await new AgentRunRepository(makeSqlReturning([])).runsByDayForOwner('user-1')).toEqual([]);
    });
  });

  describe('tokensByModelForOwner', () => {
    it('AISLAMIENTO: filtra por owner_id, agrupa por modelo y mapea los 4 cubos a number', async () => {
      const sql = makeSqlReturning([
        {
          model: 'claude-opus-4-8',
          runs: '4',
          input_tokens: '1000',
          output_tokens: '200',
          cache_read_tokens: '8000',
          cache_write_tokens: '100',
        },
        {
          model: 'claude-sonnet-4-6',
          runs: '2',
          input_tokens: '500',
          output_tokens: '90',
          cache_read_tokens: null,
          cache_write_tokens: null,
        },
      ]);
      expect(await new AgentRunRepository(sql).tokensByModelForOwner('user-1')).toEqual([
        { model: 'claude-opus-4-8', runs: 4, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 8000, cacheWriteTokens: 100 },
        { model: 'claude-sonnet-4-6', runs: 2, inputTokens: 500, outputTokens: 90, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ]);
      const texts = sqlTexts(sql);
      expect(texts.some((t) => t.includes('where owner_id = '))).toBe(true);
      expect(texts.some((t) => t.includes('group by model'))).toBe(true);
    });

    it('owner sin corridas -> lista vacia (no error)', async () => {
      expect(await new AgentRunRepository(makeSqlReturning([])).tokensByModelForOwner('user-1')).toEqual([]);
    });
  });
});
