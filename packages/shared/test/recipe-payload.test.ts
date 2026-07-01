import { describe, it, expect } from 'vitest';
import {
  RECIPE_JOB_KIND,
  isRecipeJobPayload,
  parseRecipeJobPayload,
  buildRecipeJobPayload,
} from '../src/jobs/recipe-payload.js';

const RECIPE_ID = '99999999-9999-4999-8999-999999999999';

// Payload de un job SIMPLE (el de hoy): { messages, maxIterations? }. NO tiene `kind`.
const simpleJobPayload = {
  messages: [{ role: 'user', content: 'hola' }],
  maxIterations: 3,
};

// Payload de un job de RECETA valido.
const recipeJobPayload = {
  kind: RECIPE_JOB_KIND,
  recipeId: RECIPE_ID,
  steps: [{ message: 'paso 1' }, { message: 'paso 2' }],
};

describe('recipe-payload: discriminador isRecipeJobPayload', () => {
  it('un payload de receta es reconocido', () => {
    expect(isRecipeJobPayload(recipeJobPayload)).toBe(true);
  });

  it('un job SIMPLE ({ messages }) NO se confunde con uno de receta', () => {
    expect(isRecipeJobPayload(simpleJobPayload)).toBe(false);
  });

  it('basura (null, string, array, objeto sin kind) no es receta', () => {
    expect(isRecipeJobPayload(null)).toBe(false);
    expect(isRecipeJobPayload('recipe')).toBe(false);
    expect(isRecipeJobPayload([])).toBe(false);
    expect(isRecipeJobPayload({})).toBe(false);
    expect(isRecipeJobPayload({ kind: 'otra-cosa' })).toBe(false);
  });
});

describe('recipe-payload: parseRecipeJobPayload', () => {
  it('un payload de receta valido pasa y devuelve los datos tipados', () => {
    const result = parseRecipeJobPayload(recipeJobPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe(RECIPE_JOB_KIND);
      expect(result.data.recipeId).toBe(RECIPE_ID);
      expect(result.data.steps).toEqual([{ message: 'paso 1' }, { message: 'paso 2' }]);
    }
  });

  it('descarta campos extra de cada paso (snapshot exacto: solo message)', () => {
    const result = parseRecipeJobPayload({
      kind: RECIPE_JOB_KIND,
      recipeId: RECIPE_ID,
      steps: [{ message: 'paso 1', extra: 'ignorar' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps).toEqual([{ message: 'paso 1' }]);
    }
  });

  it('un job SIMPLE ({ messages }) es RECHAZADO (le falta kind: recipe)', () => {
    const result = parseRecipeJobPayload(simpleJobPayload);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('recipe');
  });

  it('kind ausente o incorrecto -> rechazado', () => {
    expect(parseRecipeJobPayload({ recipeId: RECIPE_ID, steps: [{ message: 'x' }] }).success).toBe(false);
    expect(
      parseRecipeJobPayload({ kind: 'nope', recipeId: RECIPE_ID, steps: [{ message: 'x' }] }).success,
    ).toBe(false);
  });

  it('recipeId no-string o vacio -> rechazado', () => {
    expect(parseRecipeJobPayload({ kind: RECIPE_JOB_KIND, recipeId: 123, steps: [{ message: 'x' }] }).success).toBe(
      false,
    );
    expect(parseRecipeJobPayload({ kind: RECIPE_JOB_KIND, recipeId: '', steps: [{ message: 'x' }] }).success).toBe(
      false,
    );
  });

  it('steps vacio -> rechazado (una receta necesita al menos 1 paso)', () => {
    const result = parseRecipeJobPayload({ kind: RECIPE_JOB_KIND, recipeId: RECIPE_ID, steps: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('al menos 1 paso');
  });

  it('steps no-array -> rechazado', () => {
    expect(
      parseRecipeJobPayload({ kind: RECIPE_JOB_KIND, recipeId: RECIPE_ID, steps: 'paso 1' }).success,
    ).toBe(false);
  });

  it('un paso sin message / con message vacio / no-objeto -> rechazado con el indice', () => {
    const r1 = parseRecipeJobPayload({ kind: RECIPE_JOB_KIND, recipeId: RECIPE_ID, steps: [{ message: 'ok' }, {}] });
    expect(r1.success).toBe(false);
    if (!r1.success) expect(r1.error).toContain('steps[1]');

    expect(
      parseRecipeJobPayload({ kind: RECIPE_JOB_KIND, recipeId: RECIPE_ID, steps: [{ message: '' }] }).success,
    ).toBe(false);
    expect(
      parseRecipeJobPayload({ kind: RECIPE_JOB_KIND, recipeId: RECIPE_ID, steps: ['paso 1'] }).success,
    ).toBe(false);
  });

  it('el orden de los pasos se preserva', () => {
    const result = parseRecipeJobPayload({
      kind: RECIPE_JOB_KIND,
      recipeId: RECIPE_ID,
      steps: [{ message: 'a' }, { message: 'b' }, { message: 'c' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps.map((s) => s.message)).toEqual(['a', 'b', 'c']);
    }
  });
});

describe('recipe-payload: buildRecipeJobPayload', () => {
  it('construye el shape correcto a partir de una receta', () => {
    const payload = buildRecipeJobPayload({
      id: RECIPE_ID,
      steps: [{ message: 'paso 1' }, { message: 'paso 2' }],
    });
    expect(payload).toEqual({
      kind: 'recipe',
      recipeId: RECIPE_ID,
      steps: [{ message: 'paso 1' }, { message: 'paso 2' }],
    });
  });

  it('su output es un payload de receta valido y reconocible (round-trip)', () => {
    const payload = buildRecipeJobPayload({ id: RECIPE_ID, steps: [{ message: 'unico' }] });
    expect(isRecipeJobPayload(payload)).toBe(true);
    const result = parseRecipeJobPayload(payload);
    expect(result.success).toBe(true);
  });

  it('copia SOLO message de cada paso (descarta campos extra)', () => {
    const payload = buildRecipeJobPayload({
      id: RECIPE_ID,
      steps: [{ message: 'x', foo: 'bar' } as unknown as { message: string }],
    });
    expect(payload.steps).toEqual([{ message: 'x' }]);
  });
});
