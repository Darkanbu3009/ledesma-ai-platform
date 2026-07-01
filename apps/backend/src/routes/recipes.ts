import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { JobsRepository, buildRecipeJobPayload } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { AgentRepository } from '../agents/agent-repository.js';
import { ProviderCredentialRepository } from '../credentials/provider-credential-repository.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import { RecipeRepository, type Recipe } from '../recipes/recipes-repository.js';

// Cotas defensivas del modelo de recetas (evitan input patologico; el worker de 5.5b re-gatea por tier y
// aplica sus propios caps de tokens/iteraciones al EJECUTAR). Una receta es un flujo lineal ACOTADO.
const MAX_STEPS = 50;
const MAX_STEP_CHARS = 10_000;
const MAX_NAME_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 2_000;

// Cada paso = UN mensaje de texto (instruccion) NO vacio. El orden del array ES el orden de ejecucion.
const StepSchema = z.object({
  message: z.string().min(1).max(MAX_STEP_CHARS),
});

// La secuencia ORDENADA de pasos: AL MENOS 1 (una receta sin pasos no ejecuta nada), con un cap superior.
const StepsSchema = z.array(StepSchema).min(1).max(MAX_STEPS);

const NameSchema = z.string().min(1).max(MAX_NAME_CHARS);
// description puede omitirse (undefined) o setearse a null (limpiarla) o a un texto acotado.
const DescriptionSchema = z.string().max(MAX_DESCRIPTION_CHARS).nullable();

const CreateRecipeSchema = z.object({
  agentId: z.string().uuid(),
  credentialId: z.string().uuid(),
  name: NameSchema,
  description: DescriptionSchema.optional(),
  steps: StepsSchema,
});

// PATCH: editar name/description/steps o activar/desactivar. Al menos un campo presente. NO permite
// cambiar agentId/credentialId (el agente y la credencial son FIJOS para la receta, igual que en
// scheduled_tasks): por eso el PATCH no re-valida pertenencia.
const UpdateRecipeSchema = z
  .object({
    name: NameSchema.optional(),
    description: DescriptionSchema.optional(),
    steps: StepsSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'al menos un campo (name, description, steps o isActive) es requerido',
  });

const RecipeIdParamSchema = z.object({ id: z.string().uuid() });

/** Resumen de una receta para el LISTADO: no envia los pasos completos, solo su cantidad. */
function toRecipeSummary(recipe: Recipe) {
  return {
    id: recipe.id,
    name: recipe.name,
    agentId: recipe.agentId,
    credentialId: recipe.credentialId,
    stepCount: recipe.steps.length,
    isActive: recipe.isActive,
    lastRunAt: recipe.lastRunAt,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };
}

/**
 * Endpoints CRUD de RECETAS (flujos LINEALES multi-paso; Fase 5.5a), todos scoped por el usuario
 * autenticado (requireUser, mismo auth JWT que /v1/agents). El owner_id SIEMPRE sale del token.
 *
 * Reglas clave (mismo molde que scheduled_tasks / triggers):
 *  - GATE POR TIER server-side en la CREACION: crear una receta es premium; solo el tier 'autonomous'
 *    puede crearlas. Se lee profiles.tier (nunca se confia en el cliente). El worker de 5.5b vuelve a
 *    gatear por tier al EJECUTAR (defensa en profundidad), por eso PATCH/DELETE no re-gatean.
 *  - PERTENENCIA: el agente y la credencial deben ser del owner (no se referencia un recurso ajeno). El
 *    agente y la credencial son FIJOS: solo se validan en la CREACION (PATCH no los cambia).
 *  - STEPS: la secuencia ORDENADA se valida con Zod (al menos 1 paso, cada paso con texto no vacio); la
 *    base (V013) lo respalda con un CHECK de array no vacio.
 *
 * NO construye el EJECUTOR multi-paso (worker) ni la UI: eso es 5.5b/5.5c. El shape del payload de un
 * job de receta vive en packages/shared (buildRecipeJobPayload), listo para que 5.5b lo encole.
 *
 * Permite inyectar el verifier y los repos en tests (sin red ni DB en CI).
 */
export function recipeRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    recipeRepo?: Pick<
      RecipeRepository,
      | 'createRecipe'
      | 'listRecipesByOwner'
      | 'getRecipeForOwner'
      | 'updateRecipeForOwner'
      | 'deleteRecipeForOwner'
      | 'markRunNow'
    >;
    agentRepo?: Pick<AgentRepository, 'getByIdForOwner'>;
    credentialRepo?: Pick<ProviderCredentialRepository, 'existsForOwner'>;
    registrationRepo?: Pick<RegistrationRepository, 'getProfileTier'>;
    jobsRepo?: Pick<JobsRepository, 'createJob'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const recipeRepo = deps?.recipeRepo ?? new RecipeRepository(getSql(config));
    const agentRepo = deps?.agentRepo ?? new AgentRepository(getSql(config));
    const credentialRepo = deps?.credentialRepo ?? new ProviderCredentialRepository(getSql(config));
    const registrationRepo = deps?.registrationRepo ?? new RegistrationRepository(getSql(config));
    const jobsRepo = deps?.jobsRepo ?? new JobsRepository(getSql(config));

    // Crea una receta. Gate por tier 'autonomous'; valida pertenencia de agente/credencial y que steps
    // no este vacio. owner_id SIEMPRE = usuario del token.
    app.post('/v1/recipes', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);

      const parsed = CreateRecipeSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid recipe', parsed.error.issues);
      }

      // GATE SERVER-SIDE: crear una receta exige tier 'autonomous'. Corre antes de tocar la DB de
      // recetas: un usuario sin el plan recibe un 403 claro y no crea nada.
      const tier = await registrationRepo.getProfileTier(user.id);
      if (tier !== 'autonomous') {
        throw new AppError('FORBIDDEN', 403, 'Recipes require the autonomous plan (tier autonomous)');
      }

      // PERTENENCIA: el agente y la credencial deben ser del owner. Una referencia ajena/inexistente se
      // trata como NOT_FOUND (no se revela la existencia de recursos de otros).
      const agent = await agentRepo.getByIdForOwner(parsed.data.agentId, user.id);
      if (!agent) throw new AppError('NOT_FOUND', 404, 'Agent not found');
      const credentialExists = await credentialRepo.existsForOwner(user.id, parsed.data.credentialId);
      if (!credentialExists) throw new AppError('NOT_FOUND', 404, 'Credential not found');

      const recipe = await recipeRepo.createRecipe({
        ownerId: user.id,
        agentId: parsed.data.agentId,
        credentialId: parsed.data.credentialId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        steps: parsed.data.steps,
      });
      return reply.status(201).send({ recipe });
    });

    // Lista las recetas del owner (resumen: nombre, agente, numero de pasos, activa, ultimo run).
    app.get('/v1/recipes', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const recipes = await recipeRepo.listRecipesByOwner(user.id);
      return reply.send({ recipes: recipes.map(toRecipeSummary) });
    });

    // Devuelve UNA receta del owner CON sus pasos (para ver/editar). Solo el owner.
    app.get(
      '/v1/recipes/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        const params = RecipeIdParamSchema.safeParse(request.params);
        if (!params.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid recipe id', params.error.issues);
        }
        const recipe = await recipeRepo.getRecipeForOwner(params.data.id, user.id);
        if (!recipe) throw new AppError('NOT_FOUND', 404, 'Recipe not found');
        return reply.send({ recipe });
      },
    );

    // Edita (name/description/steps) o activa/desactiva una receta del owner. Re-valida steps (Zod) si
    // cambian. NO cambia agente/credencial (fijos), por eso no re-valida pertenencia.
    app.patch(
      '/v1/recipes/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);

        const params = RecipeIdParamSchema.safeParse(request.params);
        if (!params.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid recipe id', params.error.issues);
        }
        const parsed = UpdateRecipeSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid recipe update', parsed.error.issues);
        }

        const current = await recipeRepo.getRecipeForOwner(params.data.id, user.id);
        if (!current) throw new AppError('NOT_FOUND', 404, 'Recipe not found');

        // Fusiona el patch sobre la receta actual (campos no enviados se preservan). description es
        // NULLABLE: se compara con undefined (no ??) para permitir limpiarla enviando null.
        const name = parsed.data.name ?? current.name;
        const description =
          parsed.data.description !== undefined ? parsed.data.description : current.description;
        const steps = parsed.data.steps ?? current.steps;
        const isActive = parsed.data.isActive ?? current.isActive;

        const recipe = await recipeRepo.updateRecipeForOwner(params.data.id, user.id, {
          name,
          description,
          steps,
          isActive,
        });
        if (!recipe) throw new AppError('NOT_FOUND', 404, 'Recipe not found');
        return reply.send({ recipe });
      },
    );

    // Borra una receta del owner. Acotado al owner: solo borra las propias.
    app.delete(
      '/v1/recipes/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        const params = RecipeIdParamSchema.safeParse(request.params);
        if (!params.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid recipe id', params.error.issues);
        }
        const removed = await recipeRepo.deleteRecipeForOwner(params.data.id, user.id);
        if (!removed) throw new AppError('NOT_FOUND', 404, 'Recipe not found');
        return reply.status(204).send();
      },
    );

    // EJECUTAR AHORA (disparo MANUAL): encola UN job de receta para el worker (5.5b), que corre los N
    // pasos async con encadenamiento. NO ejecuta sincronamente aqui: solo mete un job 'pending' en la
    // cola, EXACTAMENTE como el scheduler / los triggers (mismo JobsRepository.createJob).
    //
    // Reglas (espejo del CRUD y del entrante de triggers):
    //  - GATE POR TIER server-side: ejecutar una receta es premium (tier 'autonomous'), igual que
    //    crearla. Corre ANTES de resolver la receta, asi un usuario sin plan recibe 403 y no se le
    //    revela si la receta existe. El worker RE-gatea por tier al ejecutar (defensa en profundidad).
    //  - PERTENENCIA: la receta debe ser del owner. Ajena/inexistente -> 404 (no filtra recursos ajenos).
    //  - ACTIVA: una receta pausada (is_active=false) no se dispara ni manualmente -> 400 claro.
    //  - El payload es un SNAPSHOT de los pasos (buildRecipeJobPayload): editar/borrar la receta luego
    //    no altera una corrida ya encolada. Un reintento del job re-ejecuta DESDE EL PASO 1 (sin
    //    checkpoint): la UI lo advierte para evitar acciones irreversibles en pasos tempranos.
    app.post(
      '/v1/recipes/:id/run',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);

        const params = RecipeIdParamSchema.safeParse(request.params);
        if (!params.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid recipe id', params.error.issues);
        }

        // GATE SERVER-SIDE: ejecutar exige tier 'autonomous'. Antes de tocar la DB de recetas.
        const tier = await registrationRepo.getProfileTier(user.id);
        if (tier !== 'autonomous') {
          throw new AppError('FORBIDDEN', 403, 'Recipes require the autonomous plan (tier autonomous)');
        }

        // Carga la receta del owner. Ajena/inexistente -> 404 (no revela recursos de otros).
        const recipe = await recipeRepo.getRecipeForOwner(params.data.id, user.id);
        if (!recipe) throw new AppError('NOT_FOUND', 404, 'Recipe not found');

        // Una receta pausada no se ejecuta: 400 claro (activala para correrla).
        if (!recipe.isActive) {
          throw new AppError('VALIDATION_ERROR', 400, 'Recipe is not active');
        }

        // Encola el job de receta EXACTAMENTE como el scheduler/triggers: payload de receta (snapshot
        // de los pasos), agente/credencial de la receta, owner del token, status 'pending' (default),
        // sin scheduled_for (ASAP). El worker lo tomara y lo ejecutara.
        const payload = buildRecipeJobPayload(recipe);
        // Fail-fast defensivo (igual que el entrante de triggers, incoming-triggers.ts): la API y el
        // CHECK de la base garantizan >= 1 paso, pero el mapeo defensivo del repo (rowToSteps descarta
        // items sin `message`) podria dejar 0 pasos ante datos corruptos (p.ej. un INSERT directo). No
        // encolamos un job vacio que el worker rechazaria tras reintentos: cortamos en el origen.
        if (payload.steps.length === 0) {
          request.log.warn({ recipeId: recipe.id }, 'receta sin pasos validos: no se encola');
          throw new AppError('INTERNAL_ERROR', 500, 'Recipe misconfigured');
        }
        const job = await jobsRepo.createJob({
          agentId: recipe.agentId,
          ownerId: user.id,
          credentialId: recipe.credentialId,
          payload,
        });
        // Marca la ultima corrida encolada (last_run_at). Acotado al owner.
        await recipeRepo.markRunNow(recipe.id, user.id);

        // 202: aceptado y encolado; el worker lo ejecutara async (no hay resultado inline). Devuelve el
        // jobId por si una futura vista de ejecuciones quiere seguir la corrida.
        return reply.status(202).send({ status: 'accepted', jobId: job.id });
      },
    );
  };
}
