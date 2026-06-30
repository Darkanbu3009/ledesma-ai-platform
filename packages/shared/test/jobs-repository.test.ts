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
});
