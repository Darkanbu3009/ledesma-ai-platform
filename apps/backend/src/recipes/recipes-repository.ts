import type { Sql } from '../db/client.js';

/**
 * Acceso a datos de las RECETAS (tabla `recipes`, V013). Una receta es un flujo LINEAL multi-paso:
 * owner + agente + credencial + una SECUENCIA ORDENADA de pasos (cada paso = { message }). Recibe el
 * cliente sql por inyeccion (testeable), mismo patron que ScheduledTaskRepository / AgentRepository, y
 * SIEMPRE acota por owner_id en lecturas/escrituras por id: una receta ajena nunca se resuelve ni se
 * modifica.
 *
 * Columnas SIEMPRE explicitas (nunca select * / returning *): si a la base le falta una columna (p.ej.
 * V013 sin aplicar), Postgres falla ruidosamente en vez de devolver una receta con campos undefined.
 *
 * Este repositorio cubre el CRUD del usuario (crear/listar/editar/borrar via los endpoints del backend).
 * El EJECUTOR multi-paso (worker) es 5.5b: NO vive aqui. El reintento de un job de receta re-ejecuta
 * DESDE EL PASO 1 (Camino A, sin checkpoint); esta tabla no lleva tracking de paso.
 */

/** Un paso de la receta: UNA instruccion de texto. El orden en el array `steps` ES el orden de ejecucion. */
export interface RecipeStep {
  message: string;
}

/** Una receta, tal como vive en la tabla `recipes`. snake_case -> camelCase. */
export interface Recipe {
  id: string;
  /** Dueno de la receta (sub del JWT), misma tenancy que agents.owner_id. */
  ownerId: string;
  /** Agente que ejecuta TODOS los pasos de la receta. */
  agentId: string;
  /** Credencial de la boveda a usar al ejecutar (provider_credentials.id). */
  credentialId: string;
  /** Nombre legible para identificar la receta. */
  name: string;
  /** Descripcion opcional (para que sirve). null = sin descripcion. */
  description: string | null;
  /** Secuencia ORDENADA de pasos (al menos 1). El orden del array es el orden de ejecucion. */
  steps: RecipeStep[];
  /** Pausar/activar sin borrar: solo las activas se dispararian. */
  isActive: boolean;
  /** Ultima vez que se materializo una corrida (job) para esta receta (ISO). null = nunca corrio. */
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Insumos para crear una receta. isActive/timestamps los pone la base. */
export interface CreateRecipeInput {
  ownerId: string;
  agentId: string;
  credentialId: string;
  name: string;
  /** null/ausente = sin descripcion. */
  description?: string | null;
  steps: RecipeStep[];
}

/** Campos editables de una receta. La ruta los fusiona (lee la actual + el patch) y pasa el set final. */
export interface UpdateRecipeFields {
  name: string;
  description: string | null;
  steps: RecipeStep[];
  isActive: boolean;
}

interface RecipeRow {
  id: string;
  owner_id: string;
  agent_id: string;
  credential_id: string;
  name: string;
  description: string | null;
  steps: unknown;
  is_active: boolean;
  last_run_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** ISO 8601 tolerante: null/invalido -> null, sin lanzar RangeError. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO de epoch: fallback no-lanzante para los timestamps not-null (created_at/updated_at). */
const EPOCH_ISO = new Date(0).toISOString();

/**
 * Normaliza el jsonb `steps` de la fila a RecipeStep[]. La base garantiza array no vacio (CHECK V013) y
 * la ruta valida el contenido (Zod), pero mapeamos defensivamente: descartamos cualquier item que no sea
 * { message: string }, para que un dato heredado raro no propague campos undefined.
 */
function rowToSteps(value: unknown): RecipeStep[] {
  if (!Array.isArray(value)) return [];
  const steps: RecipeStep[] = [];
  for (const item of value) {
    if (item !== null && typeof item === 'object' && typeof (item as { message?: unknown }).message === 'string') {
      steps.push({ message: (item as { message: string }).message });
    }
  }
  return steps;
}

function rowToRecipe(row: RecipeRow): Recipe {
  return {
    id: row.id,
    ownerId: row.owner_id,
    agentId: row.agent_id,
    credentialId: row.credential_id,
    name: row.name,
    description: row.description,
    steps: rowToSteps(row.steps),
    isActive: row.is_active,
    lastRunAt: toIso(row.last_run_at),
    createdAt: toIso(row.created_at) ?? EPOCH_ISO,
    updatedAt: toIso(row.updated_at) ?? EPOCH_ISO,
  };
}

export class RecipeRepository {
  constructor(private readonly sql: Sql) {}

  /** Crea una receta. is_active/timestamps los pone la base; steps va como jsonb (array ordenado). */
  async createRecipe(input: CreateRecipeInput): Promise<Recipe> {
    const rows = await this.sql<RecipeRow[]>`
      insert into recipes (owner_id, agent_id, credential_id, name, description, steps)
      values (
        ${input.ownerId},
        ${input.agentId},
        ${input.credentialId},
        ${input.name},
        ${input.description ?? null},
        ${this.sql.json(input.steps as unknown as Parameters<Sql['json']>[0])}
      )
      returning id, owner_id, agent_id, credential_id, name, description, steps, is_active,
        last_run_at, created_at, updated_at
    `;
    return rowToRecipe(rows[0] as RecipeRow);
  }

  /** Lista las recetas del owner (mas nuevas primero), con su estado y ultimo run. */
  async listRecipesByOwner(ownerId: string): Promise<Recipe[]> {
    const rows = await this.sql<RecipeRow[]>`
      select id, owner_id, agent_id, credential_id, name, description, steps, is_active,
        last_run_at, created_at, updated_at
      from recipes
      where owner_id = ${ownerId}
      order by created_at desc
    `;
    return rows.map(rowToRecipe);
  }

  /** Resuelve UNA receta del owner por id. null si no existe o no es del owner (aislamiento por owner). */
  async getRecipeForOwner(id: string, ownerId: string): Promise<Recipe | null> {
    const rows = await this.sql<RecipeRow[]>`
      select id, owner_id, agent_id, credential_id, name, description, steps, is_active,
        last_run_at, created_at, updated_at
      from recipes
      where id = ${id} and owner_id = ${ownerId}
    `;
    const row = rows[0];
    return row ? rowToRecipe(row) : null;
  }

  /**
   * Actualiza una receta del owner con el set de campos YA FUSIONADO por la ruta (name, description,
   * steps, is_active). Acotado por id + owner_id: una receta ajena no se toca (-> null). steps va como
   * jsonb; la ruta ya valido que tenga al menos 1 paso.
   */
  async updateRecipeForOwner(
    id: string,
    ownerId: string,
    fields: UpdateRecipeFields,
  ): Promise<Recipe | null> {
    const rows = await this.sql<RecipeRow[]>`
      update recipes set
        name = ${fields.name},
        description = ${fields.description},
        steps = ${this.sql.json(fields.steps as unknown as Parameters<Sql['json']>[0])},
        is_active = ${fields.isActive},
        updated_at = now()
      where id = ${id} and owner_id = ${ownerId}
      returning id, owner_id, agent_id, credential_id, name, description, steps, is_active,
        last_run_at, created_at, updated_at
    `;
    const row = rows[0];
    return row ? rowToRecipe(row) : null;
  }

  /** Borra una receta del owner. true si borro una fila propia; false si ajena o inexistente. */
  async deleteRecipeForOwner(id: string, ownerId: string): Promise<boolean> {
    const rows = await this.sql<Array<{ id: string }>>`
      delete from recipes
      where id = ${id} and owner_id = ${ownerId}
      returning id
    `;
    return rows.length > 0;
  }

  /**
   * Marca que la receta materializo una corrida (last_run_at = now()). Lo llama el endpoint de
   * ejecucion manual (POST /v1/recipes/:id/run) DESPUES de encolar el job, igual que markTriggered en
   * los triggers. Acotado por id + owner_id: una receta ajena no se toca.
   */
  async markRunNow(id: string, ownerId: string): Promise<void> {
    await this.sql`
      update recipes set last_run_at = now(), updated_at = now()
      where id = ${id} and owner_id = ${ownerId}
    `;
  }
}
