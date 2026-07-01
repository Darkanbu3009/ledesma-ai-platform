/**
 * SHAPE del payload de un JOB DE RECETA (Fase 5.5a). Una receta es un flujo LINEAL multi-paso; para
 * EJECUTARLA, un futuro disparador (manual/scheduler/trigger) encola UN job en la cola `jobs` (V008)
 * cuyo `payload` (jsonb) tiene la forma de RECETA definida aqui. El worker que lo CONSUME y ejecuta los
 * pasos en orden se construye en 5.5b: este modulo solo DEFINE el shape + su validador para que 5.5b
 * pueda DETECTAR y PARSEAR un job de receta sin ambiguedad. NO ejecuta nada.
 *
 * Vive en packages/shared (junto a los tipos de la cola, jobs/types.ts) porque lo consumen DOS
 * workspaces: el backend (el disparador que encola) y el worker (que ejecuta). Son tipos PUROS con un
 * validador SIN dependencias (ni Zod), igual que agent-spec.ts: shared no incorpora librerias de
 * validacion; el discriminador es simple y se valida a mano.
 *
 * DISCRIMINADOR (el punto critico: distinguir job simple vs job de receta SIN ambiguedad):
 *   - Job SIMPLE (el de hoy, intacto): payload = { messages: [{role, content}], maxIterations? }. NO
 *     tiene campo `kind`. El worker lo valida con su JobPayloadSchema (apps/worker execution.ts), que
 *     EXIGE `messages`; un payload de receta (sin `messages`) ya falla ahi.
 *   - Job de RECETA (nuevo): payload = { kind: 'recipe', recipeId, steps: [{ message }] }. Lleva el
 *     literal `kind: 'recipe'`, que un payload simple nunca tiene.
 * Ambas formas son MUTUAMENTE EXCLUYENTES: isRecipeJobPayload() es true solo para la de receta, y
 * parseRecipeJobPayload() rechaza un payload simple (le falta `kind: 'recipe'`). Asi 5.5b ramifica:
 * `if (isRecipeJobPayload(payload)) { ...receta... } else { ...simple (JobPayloadSchema)... }`.
 *
 * CAMINO A (deliberado): los `steps` viajan EMBEBIDOS en el payload (un snapshot de la receta al momento
 * de encolar), asi el job es autocontenido y editar/borrar la receta despues no altera una corrida ya
 * en vuelo. Un job corre los N pasos internamente; si se REINTENTA, re-ejecuta DESDE EL PASO 1 (no hay
 * checkpoint). `recipeId` queda como trazabilidad (de que receta salio esta corrida).
 */

/** Discriminador del payload de receta. Un payload de job simple nunca lleva este valor en `kind`. */
export const RECIPE_JOB_KIND = 'recipe';

/** Un paso de la receta dentro del payload: UNA instruccion de texto. El orden en el array ES el orden. */
export interface RecipeStepPayload {
  /** Instruccion de texto del paso (no vacia). */
  message: string;
}

/** Payload de un job que representa la ejecucion de una receta lineal multi-paso. */
export interface RecipeJobPayload {
  /** Literal 'recipe': marca el payload como de receta y lo distingue de un job simple. */
  kind: typeof RECIPE_JOB_KIND;
  /** Receta de la que salio esta corrida (trazabilidad). */
  recipeId: string;
  /** La secuencia ORDENADA de pasos a ejecutar (snapshot de la receta; al menos 1). */
  steps: RecipeStepPayload[];
}

/** Resultado de validar un payload como de receta (estilo safeParse, sin lanzar). */
export type RecipeJobPayloadParseResult =
  | { success: true; data: RecipeJobPayload }
  | { success: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * DISCRIMINADOR barato: ¿este payload AFIRMA ser de receta (kind === 'recipe')? No valida la forma
 * completa (para eso esta parseRecipeJobPayload); es el check que el worker usa para RAMIFICAR entre el
 * camino de receta y el simple. Devuelve false para un job simple ({ messages, ... }) y para basura.
 */
export function isRecipeJobPayload(value: unknown): boolean {
  return isRecord(value) && value.kind === RECIPE_JOB_KIND;
}

/**
 * Valida COMPLETAMENTE un payload como RecipeJobPayload: kind === 'recipe', recipeId string no vacio, y
 * steps un array NO VACIO de { message: string no vacio }. Devuelve { success, data } o { success,
 * error } (no lanza), para que 5.5b lo use igual que un safeParse de Zod. Un payload de job simple
 * ({ messages }) o malformado -> success:false.
 */
export function parseRecipeJobPayload(value: unknown): RecipeJobPayloadParseResult {
  if (!isRecord(value)) {
    return { success: false, error: 'payload no es un objeto' };
  }
  if (value.kind !== RECIPE_JOB_KIND) {
    return { success: false, error: `kind debe ser '${RECIPE_JOB_KIND}'` };
  }
  if (typeof value.recipeId !== 'string' || value.recipeId.length === 0) {
    return { success: false, error: 'recipeId debe ser un string no vacio' };
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    return { success: false, error: 'steps debe ser un array con al menos 1 paso' };
  }
  const steps: RecipeStepPayload[] = [];
  for (let i = 0; i < value.steps.length; i++) {
    const step: unknown = value.steps[i];
    if (!isRecord(step) || typeof step.message !== 'string' || step.message.length === 0) {
      return { success: false, error: `steps[${i}].message debe ser un string no vacio` };
    }
    steps.push({ message: step.message });
  }
  return { success: true, data: { kind: RECIPE_JOB_KIND, recipeId: value.recipeId, steps } };
}

/**
 * Construye el payload de un job de receta a partir de una receta (o su forma minima). PURO y sin
 * efectos: lo usara el disparador (manual/scheduler/trigger) de 5.5b para encolar via createJob
 * ({ agentId, ownerId, credentialId, payload: buildRecipeJobPayload(recipe) }). Copia solo `message` de
 * cada paso (descarta campos extra) para que el snapshot sea exactamente el shape validado.
 */
export function buildRecipeJobPayload(recipe: { id: string; steps: RecipeStepPayload[] }): RecipeJobPayload {
  return {
    kind: RECIPE_JOB_KIND,
    recipeId: recipe.id,
    steps: recipe.steps.map((step) => ({ message: step.message })),
  };
}
