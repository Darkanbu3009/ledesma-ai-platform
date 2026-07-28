import { describe, it, expect, vi } from 'vitest';
import { ConsentRepository } from '../src/privacy/consent-repository.js';
import type { Sql } from '../src/db/client.js';

const CONSENT_ID = '55555555-5555-4555-8555-555555555555';
const IP_HASH = 'a'.repeat(64);

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONSENT_ID,
    owner_id: 'user-1',
    documento: 'aviso_privacidad',
    version: '2026-07-28',
    aceptada_en: '2026-06-30T00:00:00.000Z',
    ip_hash: IP_HASH,
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
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } })
    .mock.calls;
  return (calls[index]?.[0] ?? []).join('<param>');
}

function callValues(sql: Sql, index = 0): unknown[] {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } })
    .mock.calls;
  const [, ...values] = (calls[index] ?? [[]]) as [readonly string[], ...unknown[]];
  return values;
}

describe('ConsentRepository', () => {
  describe('recordConsent', () => {
    it('inserta en aceptaciones_legales con columnas explicitas y on conflict do nothing', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const consent = await new ConsentRepository(sql).recordConsent({
        ownerId: 'user-1',
        documentType: 'privacy_notice',
        documentVersion: '2026-07-28',
        ipHash: IP_HASH,
      });
      expect(consent).toMatchObject({
        id: CONSENT_ID,
        ownerId: 'user-1',
        documentType: 'privacy_notice',
        documentVersion: '2026-07-28',
        ipHash: IP_HASH,
      });
      const text = callText(sql);
      expect(text).toContain('insert into aceptaciones_legales');
      expect(text).toContain('on conflict (owner_id, documento, version) do nothing');
      expect(text).not.toContain('returning *');
      const values = callValues(sql);
      expect(values[0]).toBe('user-1');
      expect(values).toContain('2026-07-28');
    });

    it('traduce el tipo del contrato HTTP al vocabulario de la columna `documento`', async () => {
      const sql = makeSqlReturning([makeRow({ documento: 'terminos' })]);
      const consent = await new ConsentRepository(sql).recordConsent({
        ownerId: 'user-1',
        documentType: 'terms',
        documentVersion: '2026-07-28',
      });
      // Hacia la base viaja 'terminos'; hacia el contrato HTTP vuelve 'terms'.
      expect(callValues(sql)).toContain('terminos');
      expect(consent.documentType).toBe('terms');
    });

    it('NUNCA persiste la IP en claro: solo acepta un hash y sin el guarda null', async () => {
      const sql = makeSqlReturning([makeRow({ ip_hash: null })]);
      const consent = await new ConsentRepository(sql).recordConsent({
        ownerId: 'user-1',
        documentType: 'terms',
        documentVersion: '2026-07-28',
      });
      expect(consent.ipHash).toBeNull();
      expect(callValues(sql)).toContain(null);
      // La sentencia no menciona ninguna columna de IP en claro ni de user-agent.
      const text = callText(sql);
      expect(text).not.toContain('ip_address');
      expect(text).not.toContain('user_agent');
      // Y ningun parametro parece una direccion IP.
      for (const value of callValues(sql)) {
        expect(String(value)).not.toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
      }
    });

    it('IDEMPOTENTE: si el insert no devuelve fila (conflicto), consulta y devuelve la aceptacion previa', async () => {
      // Primera llamada (insert) devuelve [] (conflicto); segunda (select) devuelve la existente.
      const sql = makeSqlSequence([[], [makeRow()]]);
      const consent = await new ConsentRepository(sql).recordConsent({
        ownerId: 'user-1',
        documentType: 'privacy_notice',
        documentVersion: '2026-07-28',
      });
      expect(consent.id).toBe(CONSENT_ID);
      const selectText = callText(sql, 1);
      expect(selectText).toContain('from aceptaciones_legales');
      expect(selectText).toMatch(/where owner_id = <param>/);
      expect(callValues(sql, 1)).toEqual(['user-1', 'aviso_privacidad', '2026-07-28']);
    });
  });

  describe('listConsentsByOwner', () => {
    it('acota por owner_id y ordena por aceptada_en desc', async () => {
      const sql = makeSqlReturning([makeRow(), makeRow({ id: 'otro', documento: 'terminos' })]);
      const list = await new ConsentRepository(sql).listConsentsByOwner('user-1');
      expect(list).toHaveLength(2);
      expect(list.map((c) => c.documentType)).toEqual(['privacy_notice', 'terms']);
      const text = callText(sql);
      expect(text).toContain('from aceptaciones_legales');
      expect(text).toMatch(/where owner_id = <param>/);
      expect(text).toContain('order by aceptada_en desc');
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
