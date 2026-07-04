import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { TriggersRepository } from '../src/triggers/triggers-repository.js';
import type { Sql } from '../src/db/client.js';

function makeMetadataRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    owner_id: 'user-1',
    agent_id: '11111111-1111-4111-8111-111111111111',
    credential_id: '22222222-2222-4222-8222-222222222222',
    auth_mode: 'hmac',
    payload_template: { messages: [{ role: 'user', content: 'hola' }] },
    is_active: true,
    last_triggered_at: null,
    created_at: '2026-06-30T00:00:00.000Z',
    updated_at: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

function makeDispatchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    owner_id: 'user-1',
    agent_id: '11111111-1111-4111-8111-111111111111',
    credential_id: '22222222-2222-4222-8222-222222222222',
    auth_mode: 'hmac',
    hmac_secret_encrypted: 'cifrado-xyz',
    url_token_hash: null,
    payload_template: { messages: [{ role: 'user', content: 'hola' }] },
    is_active: true,
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

describe('TriggersRepository', () => {
  describe('createTrigger', () => {
    it('inserta con columnas explicitas, usa sql.json para el template y NO devuelve material de auth', async () => {
      const sql = makeSqlReturning([makeMetadataRow()]);
      const trigger = await new TriggersRepository(sql).createTrigger({
        ownerId: 'user-1',
        agentId: 'a1',
        credentialId: 'c1',
        authMode: 'hmac',
        hmacSecretEncrypted: 'cifrado-xyz',
        payloadTemplate: { messages: [{ role: 'user', content: 'hola' }] },
      });
      const texto = sqlText(sql);
      expect(texto).toContain('insert into triggers');
      expect(texto).toContain('auth_mode');
      expect(texto).toContain('hmac_secret_encrypted');
      expect(texto).toContain('url_token_hash');
      expect(texto).not.toContain('returning *');
      // El RETURNING de metadata JAMAS trae el material de auth.
      expect(texto).not.toMatch(/returning[\s\S]*hmac_secret_encrypted/);
      expect(texto).not.toMatch(/returning[\s\S]*url_token_hash/);
      // El template pasa por sql.json.
      expect(sqlValues(sql)).toContainEqual({ messages: [{ role: 'user', content: 'hola' }] });
      // Mapea snake_case -> camelCase, sin exponer secreto.
      expect(trigger).toMatchObject({ id: makeMetadataRow().id, ownerId: 'user-1', authMode: 'hmac', isActive: true });
      expect(trigger).not.toHaveProperty('hmacSecretEncrypted');
      expect(trigger).not.toHaveProperty('urlTokenHash');
    });

    it('url_token: guarda el hash (no el token) y null en el secreto hmac', async () => {
      const sql = makeSqlReturning([makeMetadataRow({ auth_mode: 'url_token' })]);
      await new TriggersRepository(sql).createTrigger({
        ownerId: 'user-1',
        agentId: 'a1',
        credentialId: 'c1',
        authMode: 'url_token',
        urlTokenHash: 'hash-abc',
        payloadTemplate: {},
      });
      const values = sqlValues(sql);
      // authMode, hmac (null), urlTokenHash presentes como parametros.
      expect(values).toContain('url_token');
      expect(values).toContain('hash-abc');
      expect(values).toContain(null); // hmac_secret_encrypted null
    });
  });

  describe('listByOwner', () => {
    it('filtra por owner, ordena por created_at desc y NO selecciona material de auth', async () => {
      const sql = makeSqlReturning([makeMetadataRow()]);
      const list = await new TriggersRepository(sql).listByOwner('user-1');
      const texto = sqlText(sql);
      expect(texto).toContain('from triggers');
      expect(texto).toContain('where owner_id = ');
      expect(texto).toContain('order by created_at desc');
      expect(texto).not.toContain('hmac_secret_encrypted');
      expect(texto).not.toContain('url_token_hash');
      expect(sqlValues(sql)).toEqual(['user-1']);
      expect(list).toHaveLength(1);
    });
  });

  describe('getForOwner', () => {
    it('acota por id + owner_id y no trae material de auth', async () => {
      const sql = makeSqlReturning([makeMetadataRow()]);
      const t = await new TriggersRepository(sql).getForOwner('t1', 'user-1');
      const texto = sqlText(sql);
      expect(texto).toContain('where id = ');
      expect(texto).toContain('owner_id = ');
      expect(texto).not.toContain('hmac_secret_encrypted');
      expect(sqlValues(sql)).toEqual(['t1', 'user-1']);
      expect(t?.id).toBe(makeMetadataRow().id);
    });

    it('null si no existe / es ajeno', async () => {
      expect(await new TriggersRepository(makeSqlReturning([])).getForOwner('t1', 'user-1')).toBeNull();
    });
  });

  describe('updateForOwner', () => {
    it('setea is_active, ROTA con coalesce(${nuevo}, actual) y devuelve metadata (sin secreto)', async () => {
      const sql = makeSqlReturning([makeMetadataRow({ is_active: false })]);
      await new TriggersRepository(sql).updateForOwner('t1', 'user-1', {
        isActive: false,
        hmacSecretEncrypted: 'nuevo-cifrado',
      });
      const texto = sqlText(sql);
      expect(texto).toContain('update triggers set');
      expect(texto).toContain('is_active = ');
      // coalesce conserva el actual si el nuevo es null (no rotacion).
      expect(texto).toContain('coalesce(');
      expect(texto).toContain('hmac_secret_encrypted = coalesce(');
      expect(texto).toContain('url_token_hash = coalesce(');
      expect(texto).toContain('where id = ');
      expect(texto).toContain('owner_id = ');
      expect(texto).not.toMatch(/returning[\s\S]*hmac_secret_encrypted/);
      // valores: isActive, hmacSecretEncrypted(nuevo), urlTokenHash(null), id, owner
      const values = sqlValues(sql);
      expect(values).toContain(false);
      expect(values).toContain('nuevo-cifrado');
      expect(values).toContain('t1');
      expect(values).toContain('user-1');
    });

    it('sin rotacion pasa null en ambos secretos (coalesce conserva)', async () => {
      const sql = makeSqlReturning([makeMetadataRow()]);
      await new TriggersRepository(sql).updateForOwner('t1', 'user-1', { isActive: true });
      const values = sqlValues(sql);
      // isActive true, hmac null, urlToken null, id, owner
      expect(values).toEqual([true, null, null, 't1', 'user-1']);
    });

    it('null si el trigger es ajeno / inexistente', async () => {
      expect(
        await new TriggersRepository(makeSqlReturning([])).updateForOwner('t1', 'user-1', { isActive: true }),
      ).toBeNull();
    });
  });

  describe('deleteForOwner', () => {
    it('borra acotado por id + owner y devuelve true si borro', async () => {
      const sql = makeSqlReturning([{ id: 't1' }]);
      const ok = await new TriggersRepository(sql).deleteForOwner('t1', 'user-1');
      const texto = sqlText(sql);
      expect(texto).toContain('delete from triggers');
      expect(texto).toContain('where id = ');
      expect(texto).toContain('owner_id = ');
      expect(sqlValues(sql)).toEqual(['t1', 'user-1']);
      expect(ok).toBe(true);
    });
    it('false si no borro (ajeno/inexistente)', async () => {
      expect(await new TriggersRepository(makeSqlReturning([])).deleteForOwner('t1', 'user-1')).toBe(false);
    });
  });

  describe('getByIdForDispatch', () => {
    it('SI trae material de auth y NO es owner-scoped (solo por id)', async () => {
      const sql = makeSqlReturning([makeDispatchRow()]);
      const t = await new TriggersRepository(sql).getByIdForDispatch('t1');
      const texto = sqlText(sql);
      expect(texto).toContain('from triggers');
      expect(texto).toContain('hmac_secret_encrypted');
      expect(texto).toContain('url_token_hash');
      expect(texto).toContain('where id = ');
      // NO filtra por owner_id (el evento entrante no tiene usuario).
      expect(texto).not.toContain('owner_id = ');
      expect(sqlValues(sql)).toEqual(['t1']);
      expect(t).toMatchObject({
        id: makeDispatchRow().id,
        ownerId: 'user-1',
        agentId: makeDispatchRow().agent_id,
        credentialId: makeDispatchRow().credential_id,
        authMode: 'hmac',
        hmacSecretEncrypted: 'cifrado-xyz',
        urlTokenHash: null,
        isActive: true,
      });
    });
    it('null si no existe', async () => {
      expect(await new TriggersRepository(makeSqlReturning([])).getByIdForDispatch('t1')).toBeNull();
    });
  });

  describe('markTriggered', () => {
    it('setea last_triggered_at acotado por id', async () => {
      const sql = makeSqlReturning([]);
      await new TriggersRepository(sql).markTriggered('t1');
      const texto = sqlText(sql);
      expect(texto).toContain('update triggers set last_triggered_at = now()');
      expect(texto).toContain('where id = ');
      expect(sqlValues(sql)).toEqual(['t1']);
    });
  });

  describe('countActiveByOwner', () => {
    it('cuenta server-side los activos del owner (where owner_id + is_active), sin material de auth', async () => {
      const sql = makeSqlReturning([{ count: 2 }]);
      expect(await new TriggersRepository(sql).countActiveByOwner('user-1')).toBe(2);
      const texto = sqlText(sql);
      expect(texto).toContain('count(*)::int');
      expect(texto).toContain('from triggers');
      expect(texto).toContain('where owner_id = ');
      expect(texto).toContain('is_active = true');
      // Un conteo jamas selecciona el material de auth.
      expect(texto).not.toContain('hmac_secret_encrypted');
      expect(texto).not.toContain('url_token_hash');
      expect(sqlValues(sql)).toEqual(['user-1']);
    });

    it('normaliza el conteo a number (bigint string) y 0 sin filas', async () => {
      expect(await new TriggersRepository(makeSqlReturning([{ count: '9' }])).countActiveByOwner('user-1')).toBe(9);
      expect(await new TriggersRepository(makeSqlReturning([])).countActiveByOwner('user-1')).toBe(0);
    });
  });
});
