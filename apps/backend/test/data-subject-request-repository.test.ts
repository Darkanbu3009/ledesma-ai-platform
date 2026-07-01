import { describe, it, expect, vi } from 'vitest';
import { DataSubjectRequestRepository } from '../src/privacy/data-subject-request-repository.js';
import type { Sql } from '../src/db/client.js';

const REQ_ID = '66666666-6666-4666-8666-666666666666';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQ_ID,
    owner_id: 'user-1',
    request_type: 'access',
    status: 'pending',
    details: 'quiero mis datos',
    created_at: '2026-06-30T00:00:00.000Z',
    resolved_at: null,
    resolution_note: null,
    ...overrides,
  };
}

function makeSqlReturning(result: unknown[]): Sql {
  const fn = vi.fn(async () => result) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

/** Mock que implementa el aislamiento por owner en las queries por (id, owner). */
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

describe('DataSubjectRequestRepository', () => {
  describe('createRequest', () => {
    it('inserta con owner + tipo, status por default de la base, columnas explicitas', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const req = await new DataSubjectRequestRepository(sql).createRequest({
        ownerId: 'user-1',
        requestType: 'access',
        details: 'quiero mis datos',
      });
      expect(req).toMatchObject({
        id: REQ_ID,
        ownerId: 'user-1',
        requestType: 'access',
        status: 'pending',
        resolvedAt: null,
      });
      const text = sqlText(sql);
      expect(text).toContain('insert into data_subject_requests');
      expect(text).not.toContain('returning *');
      expect(sqlValues(sql)[0]).toBe('user-1');
    });

    it('cada tipo ARCO/erasure se persiste como parametro', async () => {
      for (const type of ['rectification', 'cancellation', 'opposition', 'erasure'] as const) {
        const sql = makeSqlReturning([makeRow({ request_type: type })]);
        const req = await new DataSubjectRequestRepository(sql).createRequest({
          ownerId: 'user-1',
          requestType: type,
        });
        expect(req.requestType).toBe(type);
        expect(sqlValues(sql)).toContain(type);
      }
    });

    it('details ausente se inserta como null', async () => {
      const sql = makeSqlReturning([makeRow({ details: null })]);
      const req = await new DataSubjectRequestRepository(sql).createRequest({
        ownerId: 'user-1',
        requestType: 'access',
      });
      expect(req.details).toBeNull();
      expect(sqlValues(sql)).toContain(null);
    });
  });

  describe('listRequestsByOwner', () => {
    it('acota por owner_id y ordena por created_at desc', async () => {
      const sql = makeSqlReturning([makeRow(), makeRow({ id: 'otra', request_type: 'erasure' })]);
      const list = await new DataSubjectRequestRepository(sql).listRequestsByOwner('user-1');
      expect(list).toHaveLength(2);
      const text = sqlText(sql);
      expect(text).toContain('from data_subject_requests');
      expect(text).toMatch(/where owner_id = <param>/);
      expect(text).toContain('order by created_at desc');
      expect(sqlValues(sql)).toEqual(['user-1']);
    });
  });

  describe('getRequestForOwner', () => {
    it('acota por id Y owner_id', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const req = await new DataSubjectRequestRepository(sql).getRequestForOwner(REQ_ID, 'user-1');
      expect(req?.id).toBe(REQ_ID);
      expect(sqlText(sql)).toMatch(/where id = <param> and owner_id = <param>/);
      expect(sqlValues(sql)).toEqual([REQ_ID, 'user-1']);
    });

    it('AISLAMIENTO: owner equivocado -> null', async () => {
      const repo = new DataSubjectRequestRepository(makeOwnerScopedSql('user-A', makeRow({ owner_id: 'user-A' })));
      expect((await repo.getRequestForOwner(REQ_ID, 'user-A'))?.id).toBe(REQ_ID);
      expect(await repo.getRequestForOwner(REQ_ID, 'user-B')).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('a estado terminal (completed) fija resolved_at via CASE y guarda la nota', async () => {
      const sql = makeSqlReturning([
        makeRow({ status: 'completed', resolved_at: '2026-07-01T00:00:00.000Z', resolution_note: 'listo' }),
      ]);
      const req = await new DataSubjectRequestRepository(sql).updateStatus(REQ_ID, 'completed', 'listo');
      expect(req?.status).toBe('completed');
      expect(req?.resolvedAt).toBe('2026-07-01T00:00:00.000Z');
      const text = sqlText(sql);
      expect(text).toContain('update data_subject_requests set');
      expect(text).toContain('resolved_at = case when');
      expect(text).toContain('now()');
      // El booleano terminal (true) viaja como parametro; luego la nota y el id.
      const values = sqlValues(sql);
      expect(values).toContain('completed');
      expect(values).toContain('listo');
      expect(values).toContain(true);
      expect(values[values.length - 1]).toBe(REQ_ID);
    });

    it('a un estado abierto (in_progress) el CASE deja resolved_at null (parametro false)', async () => {
      const sql = makeSqlReturning([makeRow({ status: 'in_progress' })]);
      await new DataSubjectRequestRepository(sql).updateStatus(REQ_ID, 'in_progress', null);
      expect(sqlValues(sql)).toContain(false);
    });

    it('devuelve null si la solicitud no existe', async () => {
      const sql = makeSqlReturning([]);
      expect(await new DataSubjectRequestRepository(sql).updateStatus(REQ_ID, 'completed', null)).toBeNull();
    });
  });
});
