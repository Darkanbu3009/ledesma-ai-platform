import { describe, it, expect, vi } from 'vitest';
import { ConsentRepository } from '../src/privacy/consent-repository.js';
import type { Sql } from '../src/db/client.js';

const CONSENT_ID = '55555555-5555-4555-8555-555555555555';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONSENT_ID,
    owner_id: 'user-1',
    document_type: 'privacy_notice',
    document_version: '2025-03-21',
    accepted_at: '2026-06-30T00:00:00.000Z',
    ip_address: '10.0.0.1',
    user_agent: 'jest',
    ...overrides,
  };
}

/** Mock del tagged template `sql` que devuelve, en orden, cada resultado preprogramado (uno por llamada). */
function makeSqlSequence(results: unknown[][]): Sql {
  let call = 0;
  const fn = vi.fn(async () => results[call++] ?? []) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

function makeSqlReturning(result: unknown[]): Sql {
  const fn = vi.fn(async () => result) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

function callText(sql: Sql, index = 0): string {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  return (calls[index]?.[0] ?? []).join('<param>');
}

function callValues(sql: Sql, index = 0): unknown[] {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  const [, ...values] = (calls[index] ?? [[]]) as [readonly string[], ...unknown[]];
  return values;
}

describe('ConsentRepository', () => {
  describe('recordConsent', () => {
    it('inserta con columnas explicitas, on conflict do nothing, y mapea snake -> camel', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const consent = await new ConsentRepository(sql).recordConsent({
        ownerId: 'user-1',
        documentType: 'privacy_notice',
        documentVersion: '2025-03-21',
        ipAddress: '10.0.0.1',
        userAgent: 'jest',
      });
      expect(consent).toMatchObject({
        id: CONSENT_ID,
        ownerId: 'user-1',
        documentType: 'privacy_notice',
        documentVersion: '2025-03-21',
        ipAddress: '10.0.0.1',
        userAgent: 'jest',
      });
      const text = callText(sql);
      expect(text).toContain('insert into consents');
      expect(text).toContain('on conflict (owner_id, document_type, document_version) do nothing');
      expect(text).not.toContain('returning *');
      // owner_id es el primer parametro; version y evidencia viajan como parametros.
      const values = callValues(sql);
      expect(values[0]).toBe('user-1');
      expect(values).toContain('2025-03-21');
    });

    it('ip/user-agent ausentes se insertan como null', async () => {
      const sql = makeSqlReturning([makeRow({ ip_address: null, user_agent: null })]);
      const consent = await new ConsentRepository(sql).recordConsent({
        ownerId: 'user-1',
        documentType: 'terms',
        documentVersion: '2025-03-21',
      });
      expect(consent.ipAddress).toBeNull();
      expect(consent.userAgent).toBeNull();
      expect(callValues(sql)).toContain(null);
    });

    it('IDEMPOTENTE: si el insert no devuelve fila (conflicto), consulta y devuelve el consentimiento previo', async () => {
      // Primera llamada (insert) devuelve [] (conflicto); segunda (select) devuelve el existente.
      const sql = makeSqlSequence([[], [makeRow()]]);
      const consent = await new ConsentRepository(sql).recordConsent({
        ownerId: 'user-1',
        documentType: 'privacy_notice',
        documentVersion: '2025-03-21',
      });
      expect(consent.id).toBe(CONSENT_ID);
      // La segunda query es un select acotado por owner + tipo + version.
      const selectText = callText(sql, 1);
      expect(selectText).toContain('from consents');
      expect(selectText).toMatch(/where owner_id = <param>/);
      expect(callValues(sql, 1)).toEqual(['user-1', 'privacy_notice', '2025-03-21']);
    });
  });

  describe('listConsentsByOwner', () => {
    it('acota por owner_id y ordena por accepted_at desc', async () => {
      const sql = makeSqlReturning([makeRow(), makeRow({ id: 'otro', document_type: 'terms' })]);
      const list = await new ConsentRepository(sql).listConsentsByOwner('user-1');
      expect(list).toHaveLength(2);
      const text = callText(sql);
      expect(text).toContain('from consents');
      expect(text).toMatch(/where owner_id = <param>/);
      expect(text).toContain('order by accepted_at desc');
      expect(callValues(sql)).toEqual(['user-1']);
    });

    it('AISLAMIENTO: solo devuelve lo que la query por owner retorna', async () => {
      const sql = makeSqlReturning([]);
      const list = await new ConsentRepository(sql).listConsentsByOwner('user-2');
      expect(list).toEqual([]);
      expect(callValues(sql)).toEqual(['user-2']);
    });
  });
});
