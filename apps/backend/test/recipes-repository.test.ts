import { describe, it, expect, vi } from 'vitest';
import { RecipeRepository } from '../src/recipes/recipes-repository.js';
import type { Sql } from '../src/db/client.js';

const RECIPE_ID = '99999999-9999-4999-8999-999999999999';
const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const CRED_ID = '22222222-2222-4222-8222-222222222222';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RECIPE_ID,
    owner_id: 'user-1',
    agent_id: AGENT_ID,
    credential_id: CRED_ID,
    name: 'Reporte diario',
    description: 'genera y envia el reporte',
    steps: [{ message: 'paso 1' }, { message: 'paso 2' }],
    is_active: true,
    last_run_at: null,
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

describe('RecipeRepository', () => {
  describe('createRecipe', () => {
    it('inserta con columnas explicitas, usa sql.json para steps y mapea snake -> camel', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const recipe = await new RecipeRepository(sql).createRecipe({
        ownerId: 'user-1',
        agentId: AGENT_ID,
        credentialId: CRED_ID,
        name: 'Reporte diario',
        description: 'genera y envia el reporte',
        steps: [{ message: 'paso 1' }, { message: 'paso 2' }],
      });
      expect(recipe).toMatchObject({
        id: RECIPE_ID,
        ownerId: 'user-1',
        agentId: AGENT_ID,
        credentialId: CRED_ID,
        name: 'Reporte diario',
        description: 'genera y envia el reporte',
        isActive: true,
        lastRunAt: null,
      });
      expect(recipe.steps).toEqual([{ message: 'paso 1' }, { message: 'paso 2' }]);

      const text = sqlText(sql);
      expect(text).toContain('insert into recipes');
      expect(text).not.toContain('returning *');
      expect(text).toContain('steps');
      // owner_id es el primer parametro; steps pasa por sql.json (el mock lo devuelve tal cual).
      const values = sqlValues(sql);
      expect(values[0]).toBe('user-1');
      expect(values).toContainEqual([{ message: 'paso 1' }, { message: 'paso 2' }]);
    });

    it('description ausente se inserta como null', async () => {
      const sql = makeSqlReturning([makeRow({ description: null })]);
      const recipe = await new RecipeRepository(sql).createRecipe({
        ownerId: 'user-1',
        agentId: AGENT_ID,
        credentialId: CRED_ID,
        name: 'Sin desc',
        steps: [{ message: 'paso' }],
      });
      expect(recipe.description).toBeNull();
      expect(sqlValues(sql)).toContain(null);
    });
  });

  describe('listRecipesByOwner', () => {
    it('acota por owner_id y ordena por created_at desc', async () => {
      const sql = makeSqlReturning([makeRow(), makeRow({ id: 'otra' })]);
      const list = await new RecipeRepository(sql).listRecipesByOwner('user-1');
      expect(list).toHaveLength(2);
      const text = sqlText(sql);
      expect(text).toContain('from recipes');
      expect(text).toMatch(/where owner_id = <param>/);
      expect(text).toContain('order by created_at desc');
      expect(sqlValues(sql)).toEqual(['user-1']);
    });
  });

  describe('getRecipeForOwner', () => {
    it('acota por id Y owner_id y normaliza steps', async () => {
      const sql = makeSqlReturning([makeRow()]);
      const recipe = await new RecipeRepository(sql).getRecipeForOwner(RECIPE_ID, 'user-1');
      expect(recipe?.id).toBe(RECIPE_ID);
      expect(recipe?.steps).toEqual([{ message: 'paso 1' }, { message: 'paso 2' }]);
      const text = sqlText(sql);
      expect(text).toMatch(/where id = <param> and owner_id = <param>/);
      expect(sqlValues(sql)).toEqual([RECIPE_ID, 'user-1']);
    });

    it('AISLAMIENTO: el owner equivocado no obtiene la receta (-> null)', async () => {
      const repo = new RecipeRepository(makeOwnerScopedSql('user-A', makeRow({ owner_id: 'user-A' })));
      expect((await repo.getRecipeForOwner(RECIPE_ID, 'user-A'))?.id).toBe(RECIPE_ID);
      expect(await repo.getRecipeForOwner(RECIPE_ID, 'user-B')).toBeNull();
    });

    it('descarta pasos malformados heredados (defensivo)', async () => {
      const sql = makeSqlReturning([makeRow({ steps: [{ message: 'ok' }, { noMessage: true }, 'basura'] })]);
      const recipe = await new RecipeRepository(sql).getRecipeForOwner(RECIPE_ID, 'user-1');
      expect(recipe?.steps).toEqual([{ message: 'ok' }]);
    });
  });

  describe('updateRecipeForOwner', () => {
    it('actualiza name/description/steps/is_active acotado por id + owner_id', async () => {
      const sql = makeSqlReturning([makeRow({ is_active: false, name: 'Nuevo nombre' })]);
      const recipe = await new RecipeRepository(sql).updateRecipeForOwner(RECIPE_ID, 'user-1', {
        name: 'Nuevo nombre',
        description: null,
        steps: [{ message: 'nuevo paso' }],
        isActive: false,
      });
      expect(recipe?.isActive).toBe(false);
      expect(recipe?.name).toBe('Nuevo nombre');

      const text = sqlText(sql);
      expect(text).toContain('update recipes set');
      expect(text).toContain('name = ');
      expect(text).toContain('description = ');
      expect(text).toContain('steps = ');
      expect(text).toContain('is_active = ');
      expect(text).toContain('updated_at = now()');
      expect(text).toMatch(/where id = <param> and owner_id = <param>/);
      // los dos ultimos valores son el id y el owner del where.
      const values = sqlValues(sql);
      expect(values.slice(-2)).toEqual([RECIPE_ID, 'user-1']);
    });

    it('devuelve null si la receta es de otro owner (no actualiza nada)', async () => {
      const repo = new RecipeRepository(makeOwnerScopedSql('user-A', makeRow({ owner_id: 'user-A' })));
      const result = await repo.updateRecipeForOwner(RECIPE_ID, 'user-B', {
        name: 'x',
        description: null,
        steps: [{ message: 'x' }],
        isActive: true,
      });
      expect(result).toBeNull();
    });

    it('isActive=false NO se pierde (no se confunde con ausente)', async () => {
      const sql = makeSqlReturning([makeRow({ is_active: false })]);
      await new RecipeRepository(sql).updateRecipeForOwner(RECIPE_ID, 'user-1', {
        name: 'x',
        description: null,
        steps: [{ message: 'x' }],
        isActive: false,
      });
      // false viaja como parametro literal (no null/undefined).
      expect(sqlValues(sql)).toContain(false);
    });

    it('description = null viaja como parametro (limpiar la descripcion)', async () => {
      const sql = makeSqlReturning([makeRow({ description: null })]);
      await new RecipeRepository(sql).updateRecipeForOwner(RECIPE_ID, 'user-1', {
        name: 'x',
        description: null,
        steps: [{ message: 'x' }],
        isActive: true,
      });
      expect(sqlValues(sql)).toContain(null);
    });
  });

  describe('deleteRecipeForOwner', () => {
    it('devuelve true si borro una fila propia y acota por id + owner_id', async () => {
      const sql = makeSqlReturning([{ id: RECIPE_ID }]);
      expect(await new RecipeRepository(sql).deleteRecipeForOwner(RECIPE_ID, 'user-1')).toBe(true);
      const text = sqlText(sql);
      expect(text).toContain('delete from recipes');
      expect(text).toMatch(/where id = <param> and owner_id = <param>/);
      expect(sqlValues(sql)).toEqual([RECIPE_ID, 'user-1']);
    });

    it('devuelve false si no borro nada (receta ajena o inexistente)', async () => {
      expect(await new RecipeRepository(makeSqlReturning([])).deleteRecipeForOwner(RECIPE_ID, 'user-2')).toBe(false);
    });
  });
});
