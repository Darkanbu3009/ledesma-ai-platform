import { describe, it, expect, vi } from 'vitest';
import { ProviderCredentialRepository } from '../src/credentials/provider-credential-repository.js';
import { encryptToToken } from '../src/crypto/aes-gcm.js';
import type { Sql } from '../src/db/client.js';

const VAULT = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OTHER_VAULT = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const CRED_ID = '11111111-1111-4111-8111-111111111111';

/** Mock del tagged template `sql`: devuelve el resultado preprogramado, ignorando el query. */
function makeSqlReturning(result: unknown[]): Sql {
  return vi.fn(async () => result) as unknown as Sql;
}

/**
 * Mock que IMPLEMENTA el aislamiento por owner: las queries por id pasan (..., ownerId) como ultimo
 * valor; solo devuelve la fila si ese owner coincide con el dueno almacenado. Reproduce el efecto del
 * `where owner_id = ${ownerId}` (y de RLS) sin una base real, para probar el aislamiento de verdad.
 */
function makeOwnerScopedSql(storedOwner: string, row: Record<string, unknown>): Sql {
  return vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const owner = values[values.length - 1];
    return owner === storedOwner ? [row] : [];
  }) as unknown as Sql;
}

/** Texto del template SQL de la primera llamada, con <param> en cada hueco. */
function sqlTemplateText(sql: Sql): string {
  const calls = (sql as unknown as { mock: { calls: Array<[readonly string[], ...unknown[]]> } }).mock.calls;
  return (calls[0]?.[0] ?? []).join('<param>');
}

function sqlValues(sql: Sql): unknown[] {
  const calls = (sql as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const [, ...values] = (calls[0] ?? []) as [unknown, ...unknown[]];
  return values;
}

describe('ProviderCredentialRepository', () => {
  describe('create', () => {
    it('inserta con owner_id y encrypted_key, y devuelve metadata SIN la key', async () => {
      const sql = makeSqlReturning([
        {
          id: CRED_ID,
          label: 'Mi key de OpenAI',
          provider_id: 'openai',
          base_url: null,
          created_at: '2026-06-30T00:00:00.000Z',
        },
      ]);
      const repo = new ProviderCredentialRepository(sql);
      const meta = await repo.create({
        ownerId: 'user-1',
        label: 'Mi key de OpenAI',
        providerId: 'openai',
        encryptedKey: 'CIFRADO-OPACO-abc123',
        baseUrl: null,
      });

      // La metadata devuelta jamas incluye la key (ni cifrada ni en claro).
      expect(meta).toEqual({
        id: CRED_ID,
        label: 'Mi key de OpenAI',
        providerId: 'openai',
        baseUrl: null,
        createdAt: '2026-06-30T00:00:00.000Z',
      });
      const serialized = JSON.stringify(meta).toLowerCase();
      expect(serialized).not.toContain('apikey');
      expect(serialized).not.toContain('encrypted');
      expect(serialized).not.toContain('cifrado-opaco');

      // El insert manda owner_id y encrypted_key; el RETURNING NO trae encrypted_key.
      const text = sqlTemplateText(sql);
      expect(text).toContain('insert into provider_credentials');
      expect(text).toContain('returning id, label, provider_id, base_url, created_at');
      expect(text).not.toMatch(/returning[\s\S]*encrypted_key/);
      expect(sqlValues(sql)).toEqual(['user-1', 'Mi key de OpenAI', 'openai', 'CIFRADO-OPACO-abc123', null]);
    });
  });

  describe('listByOwner', () => {
    it('acota por owner_id y nunca selecciona encrypted_key', async () => {
      const sql = makeSqlReturning([
        { id: CRED_ID, label: 'k1', provider_id: 'anthropic', base_url: null, created_at: '2026-06-30T00:00:00.000Z' },
      ]);
      const repo = new ProviderCredentialRepository(sql);
      const list = await repo.listByOwner('user-1');

      expect(list).toHaveLength(1);
      expect(list[0]).not.toHaveProperty('encryptedKey');
      expect(JSON.stringify(list).toLowerCase()).not.toContain('apikey');

      const text = sqlTemplateText(sql);
      expect(text).toContain('from provider_credentials');
      expect(text).toMatch(/where owner_id = <param>/);
      expect(text).not.toContain('encrypted_key');
      expect(sqlValues(sql)).toEqual(['user-1']);
    });
  });

  describe('getDecryptedKeyForOwner', () => {
    it('round-trip real: descifra la key original con aes-gcm cuando el owner coincide', async () => {
      const encrypted = encryptToToken('sk-openai-secreta-roundtrip', VAULT);
      const sql = makeSqlReturning([{ encrypted_key: encrypted, provider_id: 'openai', base_url: 'https://api.example.com/v1' }]);
      const repo = new ProviderCredentialRepository(sql);

      const resolved = await repo.getDecryptedKeyForOwner('user-1', CRED_ID, VAULT);
      expect(resolved).toEqual({
        apiKey: 'sk-openai-secreta-roundtrip',
        providerId: 'openai',
        baseUrl: 'https://api.example.com/v1',
      });

      // El where acota por id Y owner_id (segunda condicion del aislamiento).
      const text = sqlTemplateText(sql);
      expect(text).toMatch(/where id = <param> and owner_id = <param>/);
      expect(sqlValues(sql)).toEqual([CRED_ID, 'user-1']);
    });

    it('AISLAMIENTO: el usuario B con el credentialId de A no obtiene la key (fila ajena -> null)', async () => {
      const encrypted = encryptToToken('sk-de-A-jamas-para-B', VAULT);
      const row = { encrypted_key: encrypted, provider_id: 'anthropic', base_url: null };
      const repo = new ProviderCredentialRepository(makeOwnerScopedSql('user-A', row));

      // A descifra su propia credencial.
      const asA = await repo.getDecryptedKeyForOwner('user-A', CRED_ID, VAULT);
      expect(asA?.apiKey).toBe('sk-de-A-jamas-para-B');

      // B usa el MISMO credentialId: el filtro por owner no devuelve la fila -> null, nunca la key.
      const asB = await repo.getDecryptedKeyForOwner('user-B', CRED_ID, VAULT);
      expect(asB).toBeNull();
    });

    it('credencial inexistente -> null', async () => {
      const repo = new ProviderCredentialRepository(makeSqlReturning([]));
      expect(await repo.getDecryptedKeyForOwner('user-1', CRED_ID, VAULT)).toBeNull();
    });

    it('vaultSecret incorrecto -> null (no lanza, no filtra): el descifrado falla de forma controlada', async () => {
      const encrypted = encryptToToken('sk-secreta', VAULT);
      const sql = makeSqlReturning([{ encrypted_key: encrypted, provider_id: 'anthropic', base_url: null }]);
      const repo = new ProviderCredentialRepository(sql);
      expect(await repo.getDecryptedKeyForOwner('user-1', CRED_ID, OTHER_VAULT)).toBeNull();
    });

    it('encrypted_key corrupta -> null (no lanza)', async () => {
      const sql = makeSqlReturning([{ encrypted_key: '@@@no-es-un-token@@@', provider_id: 'anthropic', base_url: null }]);
      const repo = new ProviderCredentialRepository(sql);
      expect(await repo.getDecryptedKeyForOwner('user-1', CRED_ID, VAULT)).toBeNull();
    });
  });

  describe('deleteForOwner', () => {
    it('devuelve true si borro una fila propia y acota por id + owner_id', async () => {
      const sql = makeSqlReturning([{ id: CRED_ID }]);
      const repo = new ProviderCredentialRepository(sql);
      expect(await repo.deleteForOwner('user-1', CRED_ID)).toBe(true);

      const text = sqlTemplateText(sql);
      expect(text).toContain('delete from provider_credentials');
      expect(text).toMatch(/where id = <param> and owner_id = <param>/);
      expect(sqlValues(sql)).toEqual([CRED_ID, 'user-1']);
    });

    it('devuelve false si no borro nada (credencial ajena o inexistente)', async () => {
      const repo = new ProviderCredentialRepository(makeSqlReturning([]));
      expect(await repo.deleteForOwner('user-2', CRED_ID)).toBe(false);
    });
  });
});
