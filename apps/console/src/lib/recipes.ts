/**
 * Tipos y logica PURA de las RECETAS en la consola. Espeja la forma camelCase que devuelve el backend
 * (GET/POST/GET:id/PATCH/DELETE /v1/recipes, ver apps/backend/src/routes/recipes.ts y
 * recipes-repository.ts). Sin React ni red: la validacion del formulario, el armado del body y el
 * reordenamiento de pasos se testean como funciones puras, igual que scheduled-tasks.ts.
 *
 * Una receta es un flujo LINEAL multi-paso: agente + credencial + una SECUENCIA ORDENADA de pasos,
 * cada paso una instruccion de texto ({ message }). El orden del array ES el orden de ejecucion.
 */

/** Un paso de la receta: UNA instruccion de texto. El orden en el array es el orden de ejecucion. */
export interface RecipeStep {
  message: string;
}

/**
 * Resumen de una receta en el LISTADO (GET /v1/recipes): no trae los pasos completos, solo su
 * cantidad (stepCount). Para ver/editar los pasos se usa el detalle (GET /v1/recipes/:id -> Recipe).
 */
export interface RecipeSummary {
  id: string;
  name: string;
  agentId: string;
  credentialId: string;
  stepCount: number;
  isActive: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Una receta COMPLETA (GET /v1/recipes/:id), con sus pasos, para ver/editar. */
export interface Recipe {
  id: string;
  ownerId: string;
  agentId: string;
  credentialId: string;
  name: string;
  description: string | null;
  steps: RecipeStep[];
  isActive: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Body de POST /v1/recipes. owner_id lo pone el backend desde el JWT. */
export interface CreateRecipeInput {
  agentId: string;
  credentialId: string;
  name: string;
  /** null = sin descripcion (el backend la acepta nullable). */
  description: string | null;
  steps: RecipeStep[];
}

/** Body de PATCH /v1/recipes/:id. Al menos un campo; el backend fusiona sobre la receta actual. */
export interface RecipePatch {
  name?: string;
  description?: string | null;
  steps?: RecipeStep[];
  isActive?: boolean;
}

/** Respuesta de POST /v1/recipes/:id/run: el job quedo encolado (el worker lo corre async). */
export interface RunRecipeResult {
  status: string;
  jobId: string;
}

/**
 * Estado crudo del formulario de alta/edicion, antes de validar. Los pasos se editan como un array de
 * strings (una instruccion por textarea); el mapeo al body los convierte en [{ message }].
 */
export interface RecipeDraft {
  name: string;
  description: string;
  agentId: string;
  credentialId: string;
  steps: string[];
}

export type RecipeDraftErrors = Partial<
  Record<'name' | 'agentId' | 'credentialId' | 'steps', string>
>;

/** Limites alineados con los schemas Zod del backend (recipes.ts): name 200, cada paso 10000. */
export const RECIPE_NAME_MAX = 200;
export const RECIPE_DESCRIPTION_MAX = 2000;
export const RECIPE_STEP_MAX = 10_000;

/** Un draft nuevo y vacio: un solo paso en blanco para empezar (siempre hay al menos una fila). */
export function emptyRecipeDraft(): RecipeDraft {
  return { name: '', description: '', agentId: '', credentialId: '', steps: [''] };
}

/**
 * Construye el draft del formulario a partir de una receta existente (para EDITAR). Los pasos se
 * expanden a sus mensajes; si por algun dato raro no hubiera pasos, se deja una fila vacia para editar.
 */
export function recipeToDraft(recipe: Recipe): RecipeDraft {
  return {
    name: recipe.name,
    description: recipe.description ?? '',
    agentId: recipe.agentId,
    credentialId: recipe.credentialId,
    steps: recipe.steps.length > 0 ? recipe.steps.map((step) => step.message) : [''],
  };
}

/** Pasos con contenido real (no vacios tras recortar), preservando el orden. */
function nonEmptySteps(steps: string[]): string[] {
  return steps.map((step) => step.trim()).filter((step) => step !== '');
}

/**
 * Valida el borrador en cliente (espejo del backend: name, agente, credencial y al menos 1 paso con
 * contenido). Devuelve un mapa de errores por campo; vacio = valido. El backend sigue siendo la
 * autoridad (revalida y puede devolver 400/403/404).
 */
export function validateRecipeDraft(draft: RecipeDraft): RecipeDraftErrors {
  const errors: RecipeDraftErrors = {};
  const name = draft.name.trim();
  if (name === '') {
    errors.name = 'Ponle un nombre a la receta.';
  } else if (name.length > RECIPE_NAME_MAX) {
    errors.name = `Usa ${RECIPE_NAME_MAX} caracteres o menos.`;
  }
  if (draft.agentId.trim() === '') {
    errors.agentId = 'Elige el agente que ejecutara la receta.';
  }
  if (draft.credentialId.trim() === '') {
    errors.credentialId = 'Elige la credencial que va a usar.';
  }
  if (nonEmptySteps(draft.steps).length === 0) {
    errors.steps = 'Agrega al menos un paso con una instruccion.';
  }
  return errors;
}

/**
 * Arma el body del POST/PATCH desde el borrador ya validado. Descarta pasos vacios y recorta espacios;
 * el ORDEN de los pasos restantes se preserva tal cual. La descripcion vacia viaja como null (limpiar).
 */
export function toRecipeApiInput(draft: RecipeDraft): CreateRecipeInput {
  const description = draft.description.trim();
  return {
    agentId: draft.agentId,
    credentialId: draft.credentialId,
    name: draft.name.trim(),
    description: description === '' ? null : description,
    steps: nonEmptySteps(draft.steps).map((message) => ({ message })),
  };
}

/**
 * Body del PATCH de edicion: name/description/steps (el agente y la credencial son FIJOS, no se
 * editan). isActive se cambia aparte con el toggle pausar/activar.
 */
export function toRecipePatchInput(draft: RecipeDraft): RecipePatch {
  const input = toRecipeApiInput(draft);
  return { name: input.name, description: input.description, steps: input.steps };
}

// --- Editor de pasos: helpers PUROS de reordenamiento (subir/bajar/agregar/borrar/editar) ---
// Todos devuelven un ARRAY NUEVO (no mutan) y son no-ops fuera de rango, para un editor robusto.

/** Agrega un paso vacio al final. */
export function addStep(steps: string[]): string[] {
  return [...steps, ''];
}

/** Actualiza el texto del paso en `index`. Fuera de rango: devuelve el array sin cambios. */
export function updateStep(steps: string[], index: number, value: string): string[] {
  if (index < 0 || index >= steps.length) return steps;
  const next = [...steps];
  next[index] = value;
  return next;
}

/** Borra el paso en `index`. Fuera de rango: sin cambios. No fuerza un minimo (eso lo cuida la UI). */
export function removeStep(steps: string[], index: number): string[] {
  if (index < 0 || index >= steps.length) return steps;
  return steps.filter((_, i) => i !== index);
}

/**
 * Mueve el paso en `index` una posicion (delta -1 = subir, +1 = bajar), intercambiandolo con su
 * vecino. Preserva el resto del orden. No-op si el movimiento cae fuera de rango (el primero no sube,
 * el ultimo no baja).
 */
export function moveStep(steps: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  if (index < 0 || index >= steps.length || target < 0 || target >= steps.length) {
    return steps;
  }
  const next = [...steps];
  const moved = next[index] as string;
  next[index] = next[target] as string;
  next[target] = moved;
  return next;
}
