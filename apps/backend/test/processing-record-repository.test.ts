import { describe, it, expect, vi } from 'vitest';
import { ProcessingRecordRepository } from '../src/privacy/processing-record-repository.js';
import type { Sql } from '../src/db/client.js';

const REC_ID = '77777777-7777-4777-8777-777777777777';
const AGENT_ID = '11111111-1111-4111-8111-111111111111';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REC_ID,
    owner_id: 'user-1',
    agent_id: AGENT_ID,
    purpose: 'responder consultas de clientes',
    data_categories: 'contactos, mensajes de chat',
    created_at: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

function makeSqlReturning(result: unknown[]): Sql {
  const fn = vi.fn(async () => result) as unknown as Sql;
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

describe('ProcessingRecordRepository', () => {
  describe('createRecord', () => {
    it('inserta con owner + agente + finalidad + categorias, columnas explicitas', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const record = await new ProcessingRecordRepository(sql).createRecord({
        ownerId: 'user-1',
        agentId: AGENT_ID,
        purpose: 'responder consultas de clientes',
        dataCategories: 'contactos, mensajes de chat',
      });
      expect(record).toMatchObject({
        id: REC_ID,
        ownerId: 'user-1',
        agentId: AGENT_ID,
        purpose: 'responder consultas de clientes',
        dataCategories: 'contactos, mensajes de chat',
      });
      const text = sqlText(sql);
      expect(text).toContain('insert into processing_records');
      expect(text).not.toContain('returning *');
      expect(sqlValues(sql)[0]).toBe('user-1');
    });

    it('agent_id ausente se inserta como null (tratamiento sin agente)', async () => {
      const sql = makeSqlReturning([makeRow({ agent_id: null })]);
      const record = await new ProcessingRecordRepository(sql).createRecord({
        ownerId: 'user-1',
        purpose: 'analitica agregada',
        dataCategories: 'metricas de uso',
      });
      expect(record.agentId).toBeNull();
      expect(sqlValues(sql)).toContain(null);
    });
  });

  describe('listRecordsByOwner', () => {
    it('acota por owner_id y ordena por created_at desc', async () => {
      const sql = makeSqlReturning([makeRow(), makeRow({ id: 'otro' })]);
      const list = await new ProcessingRecordRepository(sql).listRecordsByOwner('user-1');
      expect(list).toHaveLength(2);
      const text = sqlText(sql);
      expect(text).toContain('from processing_records');
      expect(text).toMatch(/where owner_id = <param>/);
      expect(text).toContain('order by created_at desc');
      expect(sqlValues(sql)).toEqual(['user-1']);
    });

    it('AISLAMIENTO: solo devuelve lo que la query por owner retorna', async () => {
      const sql = makeSqlReturning([]);
      expect(await new ProcessingRecordRepository(sql).listRecordsByOwner('user-2')).toEqual([]);
      expect(sqlValues(sql)).toEqual(['user-2']);
    });
  });
});
