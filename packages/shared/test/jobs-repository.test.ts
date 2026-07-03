import { describe, it, expect, vi } from 'vitest';
import { JobsRepository, type Sql } from '../src/jobs/jobs-repository.js';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '99999999-9999-9999-9999-999999999999',
    agent_id: '11111111-1111-1111-1111-111111111111',
    owner_id: 'user-1',
    credential_id: '22222222-2222-2222-2222-222222222222',
    status: 'pending',
    payload: { messages: [{ role: 'user', content: 'hola' }] },
    scheduled_for: null,
    attempts: 0,
    last_error: null,
    created_at: '2026-06-30T00:00:00.000Z',
    updated_at: '2026-06-30T00:00:00.000Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

/** Mock del tagged template `sql`: devuelve el resultado preprogramado y expone `.json`. */
function makeSqlReturning(result: unknown[]): Sql {
  const fn = vi.fn(async () => result) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

/** Texto del template SQL de la primera llamada al mock, con <param> en cada hueco. */
function sqlText(sql: Sql): string {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  return (calls[0]?.[0] ?? []).join('<param>');
}

/** Valores (parametros) pasados al primer template SQL. */
function sqlValues(sql: Sql): unknown[] {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  const [, ...values] = (calls[0] ?? [[]]) as [readonly string[], ...unknown[]];
  return values;
}

describe('JobsRepository', () => {
  describe('createJob', () => {
    it('inserta y mapea la fila a Job (snake_case -> camelCase)', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const job = await new JobsRepository(sql).createJob({
        agentId: '11111111-1111-1111-1111-111111111111',
        ownerId: 'user-1',
        credentialId: '22222222-2222-2222-2222-222222222222',
        payload: { messages: [{ role: 'user', content: 'hola' }] },
      });
      expect(job).toMatchObject({
        id: '99999999-9999-9999-9999-999999999999',
        agentId: '11111111-1111-1111-1111-111111111111',
        ownerId: 'user-1',
        credentialId: '22222222-2222-2222-2222-222222222222',
        status: 'pending',
        scheduledFor: null,
        attempts: 0,
        startedAt: null,
        finishedAt: null,
      });
    });

    it('el SQL inserta en jobs con columnas explicitas y usa sql.json para el payload', async () => {
      const sql = makeSqlReturning([makeRow()]);
      await new JobsRepository(sql).createJob({
        agentId: 'a1',
        ownerId: 'user-1',
        credentialId: 'c1',
        payload: { foo: 'bar' },
        scheduledFor: null,
      });
      const texto = sqlText(sql);
      expect(texto).toContain('insert into jobs');
      expect(texto).not.toContain('returning *');
      expect(texto).toContain('credential_id');
      // payload pasa por sql.json (el mock lo devuelve tal cual): el valor llega como objeto.
      expect(sqlValues(sql)).toContainEqual({ foo: 'bar' });
    });

    it('scheduledFor ausente se inserta como null', async () => {
      const sql = makeSqlReturning([makeRow()]);
      await new JobsRepository(sql).createJob({
        agentId: 'a1',
        ownerId: 'user-1',
        credentialId: 'c1',
        payload: {},
      });
      // ultimo parametro = scheduled_for; sin el campo cae a null.
      expect(sqlValues(sql)).toContain(null);
    });
  });

  describe('getNextPendingJob', () => {
    it('devuelve null si la cola esta vacia', async () => {
      expect(await new JobsRepository(makeSqlReturning([])).getNextPendingJob()).toBeNull();
    });

    it('es read-only: filtra por elegibilidad, ordena por created_at y NO bloquea', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const job = await new JobsRepository(sql).getNextPendingJob();
      expect(job?.id).toBe('99999999-9999-9999-9999-999999999999');
      const texto = sqlText(sql);
      expect(texto).toContain("status = 'pending'");
      expect(texto).toContain('scheduled_for is null or scheduled_for <= now()');
      expect(texto).toContain('order by created_at asc');
      expect(texto).toContain('limit 1');
      // PEEK: jamas debe bloquear ni mutar.
      expect(texto.toLowerCase()).not.toContain('for update');
      expect(texto.toLowerCase()).not.toContain('update jobs set');
    });
  });

  describe('countPending', () => {
    it('devuelve el conteo como number', async () => {
      // count(*)::int puede llegar como number o como string (bigint): ambos se normalizan.
      expect(await new JobsRepository(makeSqlReturning([{ count: 3 }])).countPending()).toBe(3);
      expect(await new JobsRepository(makeSqlReturning([{ count: '7' }])).countPending()).toBe(7);
      expect(await new JobsRepository(makeSqlReturning([])).countPending()).toBe(0);
    });
  });

  describe('claimNextJob', () => {
    it('devuelve null si no hay job elegible', async () => {
      expect(await new JobsRepository(makeSqlReturning([])).claimNextJob()).toBeNull();
    });

    it('toma el job atomicamente con FOR UPDATE SKIP LOCKED y lo pasa a running', async () => {
      const sql = makeSqlReturning([makeRow({ status: 'running', attempts: 1, started_at: '2026-06-30T01:00:00.000Z' })]);
      const job = await new JobsRepository(sql).claimNextJob();
      expect(job?.status).toBe('running');
      expect(job?.attempts).toBe(1);
      expect(job?.startedAt).toBe('2026-06-30T01:00:00.000Z');
      const texto = sqlText(sql).toLowerCase();
      expect(texto).toContain('update jobs set');
      expect(texto).toContain("status = 'running'");
      expect(texto).toContain('attempts = attempts + 1');
      expect(texto).toContain('for update skip locked');
      expect(texto).toContain('returning id');
      expect(texto).not.toContain('returning *');
    });
  });

  describe('transiciones de estado', () => {
    it('markRunning setea running + started_at acotado por id', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).markRunning('job-1');
      const texto = sqlText(sql);
      expect(texto).toContain("status = 'running'");
      expect(texto).toContain('started_at = now()');
      expect(texto).toContain('where id = ');
      expect(sqlValues(sql)).toEqual(['job-1']);
    });

    it('markCompleted setea completed + finished_at', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).markCompleted('job-1');
      const texto = sqlText(sql);
      expect(texto).toContain("status = 'completed'");
      expect(texto).toContain('finished_at = now()');
      expect(sqlValues(sql)).toEqual(['job-1']);
    });

    it('markFailed setea failed + last_error con el detalle', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).markFailed('job-1', 'boom');
      const texto = sqlText(sql);
      expect(texto).toContain("status = 'failed'");
      expect(texto).toContain('last_error = ');
      // valores: last_error primero, luego el id del where.
      expect(sqlValues(sql)).toEqual(['boom', 'job-1']);
    });

    it('markPendingRetry vuelve a pending (no terminal): last_error + scheduled_for + started_at null', async () => {
      const sql = makeSqlReturning([]);
      const when = new Date('2026-07-01T00:00:00.000Z');
      await new JobsRepository(sql).markPendingRetry('job-1', 'transitorio', when);
      const texto = sqlText(sql);
      expect(texto).toContain("status = 'pending'");
      expect(texto).toContain('last_error = ');
      expect(texto).toContain('scheduled_for = ');
      expect(texto).toContain('started_at = null');
      // NO toca attempts (lo lleva el claim) ni finished_at (no es terminal).
      expect(texto).not.toContain('attempts');
      expect(texto).not.toContain('finished_at');
      // valores: last_error, luego scheduled_for, luego el id del where.
      expect(sqlValues(sql)).toEqual(['transitorio', when, 'job-1']);
    });

    it('markPendingRetry sin scheduled_for lo deja en null (elegible de inmediato)', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).markPendingRetry('job-1', 'transitorio');
      expect(sqlValues(sql)).toEqual(['transitorio', null, 'job-1']);
    });

    it('COMPARE-AND-SET: los tres cierres solo aplican si el job SIGUE running (guarda vs reaper / N workers)', async () => {
      const completed = makeSqlReturning([]);
      await new JobsRepository(completed).markCompleted('job-1');
      expect(sqlText(completed)).toContain("where id = ");
      expect(sqlText(completed)).toContain("status = 'running'");

      const failed = makeSqlReturning([]);
      await new JobsRepository(failed).markFailed('job-1', 'boom');
      expect(sqlText(failed)).toContain("status = 'running'");

      const pending = makeSqlReturning([]);
      await new JobsRepository(pending).markPendingRetry('job-1', 'transitorio');
      expect(sqlText(pending)).toContain("status = 'running'");
    });
  });

  describe('reapOrphanedJobs (recuperacion de jobs huerfanos)', () => {
    it('SQL: solo toca running con started_at VIEJO, umbral POR TIPO (payload->>kind), con returning explicito', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).reapOrphanedJobs({
        simpleThresholdMs: 1_800_000,
        recipeThresholdMs: 45_000_000,
        maxAttempts: 3,
      });
      const texto = sqlText(sql).toLowerCase();
      expect(texto).toContain('update jobs set');
      expect(texto).toContain("where status = 'running'");
      expect(texto).toContain('started_at is not null');
      // Solo huerfanos: started_at mas viejo que now() menos el margen.
      expect(texto).toContain('started_at < now() -');
      // Umbral distinto para receta vs simple, discriminado por el payload sin traerlo entero.
      expect(texto).toContain("payload->>'kind'");
      expect(texto).toContain('make_interval');
      expect(texto).toContain('returning id');
      expect(texto).not.toContain('returning *');
      // Umbrales viajan en SEGUNDOS (make_interval secs); y maxAttempts para la decision pending/failed.
      const values = sqlValues(sql);
      expect(values).toContain(45_000); // recipe: 45_000_000 ms / 1000
      expect(values).toContain(1_800); // simple: 1_800_000 ms / 1000
      expect(values).toContain(3); // maxAttempts
    });

    it('SQL: decide pending vs failed por attempts, limpia started_at y solo el failed pone finished_at', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).reapOrphanedJobs({
        simpleThresholdMs: 1000,
        recipeThresholdMs: 2000,
        maxAttempts: 3,
      });
      const texto = sqlText(sql).toLowerCase();
      expect(texto).toContain('attempts >= ');
      expect(texto).toContain("then 'failed'");
      expect(texto).toContain("else 'pending'");
      expect(texto).toContain('started_at = null');
      expect(texto).toContain('finished_at = case when attempts >=');
      // Deja constancia de la recuperacion en last_error.
      expect(sqlValues(sql).some((v) => typeof v === 'string' && v.includes('huerfano'))).toBe(true);
    });

    it('mapea las filas recuperadas a { id, status, attempts }', async () => {
      const sql = makeSqlReturning([
        { id: 'huerfano-a-pending', status: 'pending', attempts: 1 },
        { id: 'huerfano-a-failed', status: 'failed', attempts: 3 },
      ]);
      const reaped = await new JobsRepository(sql).reapOrphanedJobs({
        simpleThresholdMs: 1000,
        recipeThresholdMs: 2000,
        maxAttempts: 3,
      });
      expect(reaped).toEqual([
        { id: 'huerfano-a-pending', status: 'pending', attempts: 1 },
        { id: 'huerfano-a-failed', status: 'failed', attempts: 3 },
      ]);
    });

    it('sin huerfanos (0 filas afectadas) -> devuelve []', async () => {
      const reaped = await new JobsRepository(makeSqlReturning([])).reapOrphanedJobs({
        simpleThresholdMs: 1000,
        recipeThresholdMs: 2000,
        maxAttempts: 3,
      });
      expect(reaped).toEqual([]);
    });
  });

  describe('rowToJob', () => {
    it('mapea timestamps nullables a null y conserva ISO en los not-null', async () => {
      const sql = makeSqlReturning([
        makeRow({
          scheduled_for: '2026-07-01T00:00:00.000Z',
          started_at: '2026-06-30T01:00:00.000Z',
          finished_at: '2026-06-30T02:00:00.000Z',
          last_error: 'algo',
        }),
      ]);
      const job = await new JobsRepository(sql).getNextPendingJob();
      expect(job?.scheduledFor).toBe('2026-07-01T00:00:00.000Z');
      expect(job?.startedAt).toBe('2026-06-30T01:00:00.000Z');
      expect(job?.finishedAt).toBe('2026-06-30T02:00:00.000Z');
      expect(job?.lastError).toBe('algo');
    });
  });

  describe('listByOwner', () => {
    // Fila del LISTADO (resumen): NO trae payload entero, solo `payload_kind` escalar + columnas seguras.
    function makeSummaryRow(overrides: Record<string, unknown> = {}) {
      return {
        id: '99999999-9999-9999-9999-999999999999',
        agent_id: '11111111-1111-1111-1111-111111111111',
        status: 'completed',
        payload_kind: null,
        attempts: 1,
        last_error: null,
        scheduled_for: null,
        created_at: '2026-06-30T00:00:00.000Z',
        started_at: '2026-06-30T00:01:00.000Z',
        finished_at: '2026-06-30T00:02:00.000Z',
        ...overrides,
      };
    }

    it('AISLAMIENTO: filtra por owner_id, ordena por created_at desc y pagina con limit/offset', async () => {
      const sql = makeSqlReturning([makeSummaryRow()]);
      const jobs = await new JobsRepository(sql).listByOwner('user-1', { limit: 20, offset: 40 });
      expect(jobs).toHaveLength(1);
      const texto = sqlText(sql);
      expect(texto).toContain('from jobs');
      expect(texto).toContain('where owner_id = ');
      expect(texto).toContain('order by created_at desc');
      expect(texto).toContain('limit ');
      expect(texto).toContain('offset ');
      // Owner del parametro, limit y offset viajan como parametros (no interpolados en el texto).
      expect(sqlValues(sql)).toEqual(['user-1', 20, 40]);
    });

    it('NO expone el payload: selecciona payload->>\'kind\' como escalar, nunca el payload entero ni select *', async () => {
      const sql = makeSqlReturning([makeSummaryRow()]);
      await new JobsRepository(sql).listByOwner('user-1', { limit: 20, offset: 0 });
      const texto = sqlText(sql);
      expect(texto).toContain("payload->>'kind' as payload_kind");
      expect(texto).not.toContain('select *');
      // No selecciona la columna payload cruda (solo su discriminador escalar).
      expect(texto).not.toMatch(/,\s*payload\s*,/);
    });

    it('sin status: la query no filtra por estado', async () => {
      const sql = makeSqlReturning([]);
      await new JobsRepository(sql).listByOwner('user-1', { limit: 10, offset: 0 });
      const texto = sqlText(sql);
      expect(texto).not.toContain('status = ');
      expect(sqlValues(sql)).toEqual(['user-1', 10, 0]);
    });

    it('con status: agrega el filtro y lo pasa como parametro', async () => {
      const sql = makeSqlReturning([makeSummaryRow({ status: 'failed' })]);
      await new JobsRepository(sql).listByOwner('user-1', { limit: 10, offset: 0, status: 'failed' });
      const texto = sqlText(sql);
      expect(texto).toContain('and status = ');
      // owner, status, limit, offset (en ese orden dentro del template).
      expect(sqlValues(sql)).toEqual(['user-1', 'failed', 10, 0]);
    });

    it('infiere type=recipe cuando payload_kind es \'recipe\', y simple en cualquier otro caso', async () => {
      const sql = makeSqlReturning([
        makeSummaryRow({ id: 'j-recipe', payload_kind: 'recipe' }),
        makeSummaryRow({ id: 'j-simple', payload_kind: null }),
        makeSummaryRow({ id: 'j-otro', payload_kind: 'algo-raro' }),
      ]);
      const jobs = await new JobsRepository(sql).listByOwner('user-1', { limit: 10, offset: 0 });
      expect(jobs.map((j) => [j.id, j.type])).toEqual([
        ['j-recipe', 'recipe'],
        ['j-simple', 'simple'],
        ['j-otro', 'simple'],
      ]);
    });

    it('mapea el resumen a camelCase y NO incluye payload ni ownerId', async () => {
      const sql = makeSqlReturning([
        makeSummaryRow({ status: 'failed', attempts: 3, last_error: 'boom', payload_kind: 'recipe' }),
      ]);
      const [job] = await new JobsRepository(sql).listByOwner('user-1', { limit: 10, offset: 0 });
      expect(job).toEqual({
        id: '99999999-9999-9999-9999-999999999999',
        agentId: '11111111-1111-1111-1111-111111111111',
        status: 'failed',
        type: 'recipe',
        attempts: 3,
        lastError: 'boom',
        scheduledFor: null,
        createdAt: '2026-06-30T00:00:00.000Z',
        startedAt: '2026-06-30T00:01:00.000Z',
        finishedAt: '2026-06-30T00:02:00.000Z',
      });
      // Explicito: el resumen no filtra datos sensibles ni redundantes.
      expect(job).not.toHaveProperty('payload');
      expect(job).not.toHaveProperty('ownerId');
    });
  });
});
