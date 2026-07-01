import { describe, expect, it } from 'vitest';
import {
  addStep,
  emptyRecipeDraft,
  moveStep,
  recipeToDraft,
  removeStep,
  toRecipeApiInput,
  toRecipePatchInput,
  updateStep,
  validateRecipeDraft,
  type Recipe,
  type RecipeDraft,
} from '../src/lib/recipes';

const draft = (overrides: Partial<RecipeDraft>): RecipeDraft => ({
  name: 'Reporte diario',
  description: 'genera y envia el reporte',
  agentId: 'agent-1',
  credentialId: 'cred-1',
  steps: ['paso 1', 'paso 2'],
  ...overrides,
});

describe('validateRecipeDraft', () => {
  it('no devuelve errores cuando el borrador esta completo', () => {
    expect(validateRecipeDraft(draft({}))).toEqual({});
  });

  it('marca el nombre faltante (incluso con solo espacios)', () => {
    expect(validateRecipeDraft(draft({ name: '   ' })).name).toBeDefined();
  });

  it('marca el nombre demasiado largo (> 200)', () => {
    expect(validateRecipeDraft(draft({ name: 'x'.repeat(201) })).name).toBeDefined();
  });

  it('marca el agente faltante', () => {
    expect(validateRecipeDraft(draft({ agentId: '' })).agentId).toBeDefined();
  });

  it('marca la credencial faltante', () => {
    expect(validateRecipeDraft(draft({ credentialId: '' })).credentialId).toBeDefined();
  });

  it('marca cuando no hay ningun paso con contenido', () => {
    expect(validateRecipeDraft(draft({ steps: [] })).steps).toBeDefined();
    expect(validateRecipeDraft(draft({ steps: ['', '   '] })).steps).toBeDefined();
  });

  it('un solo paso con contenido es suficiente', () => {
    expect(validateRecipeDraft(draft({ steps: ['   ', 'hace algo'] })).steps).toBeUndefined();
  });

  it('acumula varios errores a la vez', () => {
    const errors = validateRecipeDraft(
      draft({ name: '', agentId: '', credentialId: '', steps: [''] }),
    );
    expect(Object.keys(errors).sort()).toEqual(['agentId', 'credentialId', 'name', 'steps']);
  });
});

describe('toRecipeApiInput', () => {
  it('mapea el borrador al body del POST con los pasos como [{ message }] en orden', () => {
    const input = toRecipeApiInput(
      draft({ name: 'Mi receta', steps: ['primero', 'segundo', 'tercero'] }),
    );
    expect(input).toEqual({
      agentId: 'agent-1',
      credentialId: 'cred-1',
      name: 'Mi receta',
      description: 'genera y envia el reporte',
      steps: [{ message: 'primero' }, { message: 'segundo' }, { message: 'tercero' }],
    });
  });

  it('descarta pasos vacios preservando el orden de los que quedan', () => {
    const input = toRecipeApiInput(draft({ steps: ['  ', 'uno', '', 'dos', '   '] }));
    expect(input.steps).toEqual([{ message: 'uno' }, { message: 'dos' }]);
  });

  it('recorta espacios del nombre y de cada paso', () => {
    const input = toRecipeApiInput(draft({ name: '  Receta  ', steps: ['  con espacios  '] }));
    expect(input.name).toBe('Receta');
    expect(input.steps).toEqual([{ message: 'con espacios' }]);
  });

  it('descripcion vacia viaja como null (limpiar la descripcion)', () => {
    expect(toRecipeApiInput(draft({ description: '   ' })).description).toBeNull();
  });
});

describe('toRecipePatchInput', () => {
  it('solo incluye name/description/steps (agente y credencial son fijos)', () => {
    const patch = toRecipePatchInput(draft({ steps: ['solo uno'] }));
    expect(patch).toEqual({
      name: 'Reporte diario',
      description: 'genera y envia el reporte',
      steps: [{ message: 'solo uno' }],
    });
    expect(patch).not.toHaveProperty('agentId');
    expect(patch).not.toHaveProperty('credentialId');
  });
});

describe('recipeToDraft', () => {
  const recipe: Recipe = {
    id: 'r1',
    ownerId: 'u1',
    agentId: 'agent-9',
    credentialId: 'cred-9',
    name: 'Receta guardada',
    description: null,
    steps: [{ message: 'a' }, { message: 'b' }],
    isActive: true,
    lastRunAt: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
  };

  it('expande la receta a un draft editable (pasos como strings, description null -> "")', () => {
    expect(recipeToDraft(recipe)).toEqual({
      name: 'Receta guardada',
      description: '',
      agentId: 'agent-9',
      credentialId: 'cred-9',
      steps: ['a', 'b'],
    });
  });

  it('si la receta no tuviera pasos, deja una fila vacia para editar', () => {
    expect(recipeToDraft({ ...recipe, steps: [] }).steps).toEqual(['']);
  });
});

describe('emptyRecipeDraft', () => {
  it('arranca con un unico paso vacio (siempre hay al menos una fila)', () => {
    expect(emptyRecipeDraft().steps).toEqual(['']);
  });
});

describe('editor de pasos: helpers de reordenamiento (puros, sin mutar)', () => {
  it('addStep agrega un paso vacio al final', () => {
    expect(addStep(['a', 'b'])).toEqual(['a', 'b', '']);
  });

  it('updateStep cambia solo el paso indicado', () => {
    expect(updateStep(['a', 'b', 'c'], 1, 'B')).toEqual(['a', 'B', 'c']);
  });

  it('updateStep fuera de rango no cambia nada', () => {
    expect(updateStep(['a'], 5, 'x')).toEqual(['a']);
  });

  it('removeStep borra el paso indicado preservando el resto', () => {
    expect(removeStep(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('moveStep sube un paso (delta -1) intercambiando con el anterior y preserva el resto', () => {
    expect(moveStep(['a', 'b', 'c', 'd'], 2, -1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('moveStep baja un paso (delta +1) intercambiando con el siguiente y preserva el resto', () => {
    expect(moveStep(['a', 'b', 'c', 'd'], 1, 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('moveStep es no-op en los bordes (el primero no sube, el ultimo no baja)', () => {
    expect(moveStep(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveStep(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('no muta el array original', () => {
    const original = ['a', 'b', 'c'];
    moveStep(original, 0, 1);
    addStep(original);
    removeStep(original, 0);
    updateStep(original, 0, 'z');
    expect(original).toEqual(['a', 'b', 'c']);
  });
});
