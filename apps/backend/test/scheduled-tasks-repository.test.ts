import { describe, it, expect, vi } from 'vitest';
import { ScheduledTaskRepository } from '../src/scheduling/scheduled-tasks-repository.js';
import type { Sql } from '../src/db/client.js';

const TASK_ID = '99999999-9999-4999-8999-999999999999';
const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const CRED_ID = '22222222-2222-4222-8222-222222222222';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    owner_id: 'user-1',
    agent_id: AGENT_ID,
    credential_id: CRED_ID,
    cron_expression: '0 8 * * *',
    payload: { messages: [{ role: 'user', content: 'hola' }] },
    is_active: true,
    last_run_at: null,
    next_run_at: '2026-07-01T08:00:00.000Z',
    created_at: '2026-06-30T00:00:00.000Z',
    updated_at: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

/** Mock del tagged template `sql`: devuelve el resultado preprogramado y expone `.json`. */
function makeSqlReturning(result: unknown[]): Sql {
  const fn = vi.fn(async () => result) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

/**
 * Mock que IMPLEMENTA el aislamiento por owner: las queries por id pasan (id, ownerId) y solo devuelven
 * la fila si el owner coincide con el dueno almacenado. Reproduce el efecto del where owner_id sin DB.
 */
function makeOwnerScopedSql(storedOwner: string, row: Record<string, unknown>): Sql {
  const fn = vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const owner = values[values.length - 1];
    return owner === storedOwner ? [row] : [];
  }) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

function sqlText(sql: Sql): string {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  return (calls[0]?.[0] ?? []).join('<param>');
}

function sqlValues(sql: Sql): unknown[] {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  const [, ...values] = (calls[0] ?? [[]]) as [readonly string[], ...unknown[]];
  return values;
}

describe('ScheduledTaskRepository', () => {
  describe('createTask', () => {
    it('inserta con columnas explicitas, usa sql.json para el payload y mapea snake -> camel', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const task = await new ScheduledTaskRepository(sql).createTask({
        ownerId: 'user-1',
        agentId: AGENT_ID,
        credentialId: CRED_ID,
        cronExpression: '0 8 * * *',
        payload: { messages: [{ role: 'user', content: 'hola' }] },
        nextRunAt: '2026-07-01T08:00:00.000Z',
      });
      expect(task).toMatchObject({
        id: TASK_ID,
        ownerId: 'user-1',
        agentId: AGENT_ID,
        credentialId: CRED_ID,
        cronExpression: '0 8 * * *',
        isActive: true,
        lastRunAt: null,
        nextRunAt: '2026-07-01T08:00:00.000Z',
      });

      const text = sqlText(sql);
      expect(text).toContain('insert into scheduled_tasks');
      expect(text).not.toContain('returning *');
      expect(text).toContain('cron_expression');
      expect(text).toContain('next_run_at');
      // owner_id es el primer parametro; el payload pasa por sql.json (el mock lo devuelve tal cual).
      const values = sqlValues(sql);
      expect(values[0]).toBe('user-1');
      expect(values).toContainEqual({ messages: [{ role: 'user', content: 'hola' }] });
    });

    it('nextRunAt ausente se inserta como null', async () => {
      const sql = makeSqlReturning([makeRow()]);
      await new ScheduledTaskRepository(sql).createTask({
        ownerId: 'user-1',
        agentId: AGENT_ID,
        credentialId: CRED_ID,
        cronExpression: '* * * * *',
        payload: {},
      });
      expect(sqlValues(sql)).toContain(null);
    });
  });

  describe('listTasksByOwner', () => {
    it('acota por owner_id y ordena por created_at desc', async () => {
      const sql = makeSqlReturning([makeRow(), makeRow({ id: 'otra' })]);
      const list = await new ScheduledTaskRepository(sql).listTasksByOwner('user-1');
      expect(list).toHaveLength(2);
      const text = sqlText(sql);
      expect(text).toContain('from scheduled_tasks');
      expect(text).toMatch(/where owner_id = <param>/);
      expect(text).toContain('order by created_at desc');
      expect(sqlValues(sql)).toEqual(['user-1']);
    });
  });

  describe('getTaskForOwner', () => {
    it('acota por id Y owner_id', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const task = await new ScheduledTaskRepository(sql).getTaskForOwner(TASK_ID, 'user-1');
      expect(task?.id).toBe(TASK_ID);
      const text = sqlText(sql);
      expect(text).toMatch(/where id = <param> and owner_id = <param>/);
      expect(sqlValues(sql)).toEqual([TASK_ID, 'user-1']);
    });

    it('AISLAMIENTO: el owner equivocado no obtiene la tarea (-> null)', async () => {
      const repo = new ScheduledTaskRepository(makeOwnerScopedSql('user-A', makeRow({ owner_id: 'user-A' })));
      expect((await repo.getTaskForOwner(TASK_ID, 'user-A'))?.id).toBe(TASK_ID);
      expect(await repo.getTaskForOwner(TASK_ID, 'user-B')).toBeNull();
    });
  });

  describe('updateTaskForOwner', () => {
    it('actualiza cron/payload/is_active/next_run_at acotado por id + owner_id', async () => {
      const sql = makeSqlReturning([makeRow({ is_active: false, cron_expression: '*/5 * * * *' })]);
      const task = await new ScheduledTaskRepository(sql).updateTaskForOwner(TASK_ID, 'user-1', {
        cronExpression: '*/5 * * * *',
        payload: { messages: [{ role: 'user', content: 'nuevo' }] },
        isActive: false,
        nextRunAt: '2026-07-01T00:05:00.000Z',
      });
      expect(task?.isActive).toBe(false);
      expect(task?.cronExpression).toBe('*/5 * * * *');

      const text = sqlText(sql);
      expect(text).toContain('update scheduled_tasks set');
      expect(text).toContain('cron_expression = ');
      expect(text).toContain('is_active = ');
      expect(text).toContain('next_run_at = ');
      expect(text).toContain('updated_at = now()');
      expect(text).toMatch(/where id = <param> and owner_id = <param>/);
      // los dos ultimos valores son el id y el owner del where.
      const values = sqlValues(sql);
      expect(values.slice(-2)).toEqual([TASK_ID, 'user-1']);
    });

    it('devuelve null si la tarea es de otro owner (no actualiza nada)', async () => {
      const repo = new ScheduledTaskRepository(makeOwnerScopedSql('user-A', makeRow({ owner_id: 'user-A' })));
      const result = await repo.updateTaskForOwner(TASK_ID, 'user-B', {
        cronExpression: '0 0 * * *',
        payload: {},
        isActive: true,
        nextRunAt: null,
      });
      expect(result).toBeNull();
    });

    it('isActive=false NO se pierde (no se confunde con ausente)', async () => {
      const sql = makeSqlReturning([makeRow({ is_active: false })]);
      await new ScheduledTaskRepository(sql).updateTaskForOwner(TASK_ID, 'user-1', {
        cronExpression: '0 8 * * *',
        payload: {},
        isActive: false,
        nextRunAt: null,
      });
      // false viaja como parametro literal (no null/undefined).
      expect(sqlValues(sql)).toContain(false);
    });
  });

  describe('deleteTaskForOwner', () => {
    it('devuelve true si borro una fila propia y acota por id + owner_id', async () => {
      const sql = makeSqlReturning([{ id: TASK_ID }]);
      expect(await new ScheduledTaskRepository(sql).deleteTaskForOwner(TASK_ID, 'user-1')).toBe(true);
      const text = sqlText(sql);
      expect(text).toContain('delete from scheduled_tasks');
      expect(text).toMatch(/where id = <param> and owner_id = <param>/);
      expect(sqlValues(sql)).toEqual([TASK_ID, 'user-1']);
    });

    it('devuelve false si no borro nada (tarea ajena o inexistente)', async () => {
      expect(await new ScheduledTaskRepository(makeSqlReturning([])).deleteTaskForOwner(TASK_ID, 'user-2')).toBe(false);
    });
  });

  describe('countActiveByOwner', () => {
    it('cuenta server-side las activas del owner (where owner_id + is_active), sin traer la lista', async () => {
      const sql = makeSqlReturning([{ count: 4 }]);
      expect(await new ScheduledTaskRepository(sql).countActiveByOwner('user-1')).toBe(4);
      const text = sqlText(sql);
      expect(text).toContain('count(*)::int');
      expect(text).toContain('from scheduled_tasks');
      expect(text).toContain('where owner_id = ');
      expect(text).toContain('is_active = true');
      expect(sqlValues(sql)).toEqual(['user-1']);
    });

    it('normaliza el conteo a number (bigint string) y 0 sin filas', async () => {
      expect(await new ScheduledTaskRepository(makeSqlReturning([{ count: '7' }])).countActiveByOwner('user-1')).toBe(7);
      expect(await new ScheduledTaskRepository(makeSqlReturning([])).countActiveByOwner('user-1')).toBe(0);
    });
  });
});
