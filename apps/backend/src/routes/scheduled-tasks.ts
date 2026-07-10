import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { tierAllowsAutonomy } from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { AgentRepository } from '../agents/agent-repository.js';
import { ProviderCredentialRepository } from '../credentials/provider-credential-repository.js';
import { RegistrationRepository } from '../registration/registration-repository.js';
import { ScheduledTaskRepository } from '../scheduling/scheduled-tasks-repository.js';
import { isValidCronExpression, nextCronRun } from '../scheduling/cron.js';
import { AGENT_LIMITS } from '../agent/index.js';

// Payload fijo de la tarea: el MISMO shape que ejecuta el worker (apps/worker JobPayloadSchema) y que
// el body de /v1/run/:agentId. messages no vacio (role user/assistant, content no vacio);
// maxIterations opcional (runAgent valida su rango). Asi el job encolado por el disparo es ejecutable
// tal cual, sin transformacion.
const PayloadSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) }))
    .min(1)
    .max(AGENT_LIMITS.maxMessages),
  maxIterations: z.number().int().positive().max(AGENT_LIMITS.maxIterationsCap).optional(),
});

// cron en formato estandar de 5 campos, VALIDADO server-side (nunca se confia en input crudo). El cap
// de longitud corta entradas patologicas antes de parsear; isValidCronExpression rechaza lo malformado.
const CronExpressionSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(isValidCronExpression, { message: 'cron_expression invalida (formato estandar de 5 campos)' });

const CreateScheduledTaskSchema = z.object({
  agentId: z.string().uuid(),
  credentialId: z.string().uuid(),
  cronExpression: CronExpressionSchema,
  payload: PayloadSchema,
});

// PATCH: editar el cron y/o el payload, o activar/desactivar. Al menos un campo presente.
const UpdateScheduledTaskSchema = z
  .object({
    cronExpression: CronExpressionSchema.optional(),
    payload: PayloadSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'al menos un campo (cronExpression, payload o isActive) es requerido',
  });

const TaskIdParamSchema = z.object({ id: z.string().uuid() });

/**
 * Endpoints CRUD de TAREAS PROGRAMADAS (ejecucion autonoma por horario), todos scoped por el usuario
 * autenticado (requireUser, mismo auth JWT que /v1/agents). El owner_id SIEMPRE sale del token.
 *
 * Reglas clave:
 *  - GATE POR TIER server-side en la CREACION: programar ejecucion autonoma es premium; solo el tier
 *    'autonomous' puede crear tareas. Se lee profiles.tier (nunca se confia en el cliente). El worker
 *    vuelve a gatear por tier al ejecutar (defensa en profundidad), por eso PATCH/DELETE no re-gatean.
 *  - PERTENENCIA: el agente y la credencial deben ser del owner (no se programa un recurso ajeno).
 *  - next_run_at se calcula server-side desde el cron al crear y al editar el cron / reactivar.
 *
 * Permite inyectar el verifier y los repos en tests (sin red ni DB en CI).
 */
export function scheduledTaskRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    taskRepo?: Pick<
      ScheduledTaskRepository,
      'createTask' | 'listTasksByOwner' | 'getTaskForOwner' | 'updateTaskForOwner' | 'deleteTaskForOwner'
    >;
    agentRepo?: Pick<AgentRepository, 'getByIdForOwner'>;
    credentialRepo?: Pick<ProviderCredentialRepository, 'existsForOwner'>;
    registrationRepo?: Pick<RegistrationRepository, 'getProfileTier'>;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const taskRepo = deps?.taskRepo ?? new ScheduledTaskRepository(getSql(config));
    const agentRepo = deps?.agentRepo ?? new AgentRepository(getSql(config));
    const credentialRepo = deps?.credentialRepo ?? new ProviderCredentialRepository(getSql(config));
    const registrationRepo = deps?.registrationRepo ?? new RegistrationRepository(getSql(config));

    // Crea una tarea programada. Gate por tier 'autonomous'; valida pertenencia de agente/credencial;
    // calcula next_run_at desde el cron. owner_id SIEMPRE = usuario del token.
    app.post('/v1/scheduled-tasks', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);

      const parsed = CreateScheduledTaskSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid scheduled task', parsed.error.issues);
      }

      // GATE SERVER-SIDE: programar ejecucion autonoma exige un plan con AUTONOMIA. La capacidad se
      // deriva del modulo central de planes (tierAllowsAutonomy) sobre profiles.tier, nunca del
      // cliente. Corre antes de tocar la DB de tareas: sin el plan se recibe 403 y no se crea nada.
      const tier = await registrationRepo.getProfileTier(user.id);
      if (!tierAllowsAutonomy(tier)) {
        throw new AppError('FORBIDDEN', 403, 'Scheduling requires a plan with autonomy (Pro or Business)');
      }

      // PERTENENCIA: el agente y la credencial deben ser del owner. Una referencia ajena/inexistente
      // se trata como NOT_FOUND (no se revela la existencia de recursos de otros).
      const agent = await agentRepo.getByIdForOwner(parsed.data.agentId, user.id);
      if (!agent) throw new AppError('NOT_FOUND', 404, 'Agent not found');
      const credentialExists = await credentialRepo.existsForOwner(user.id, parsed.data.credentialId);
      if (!credentialExists) throw new AppError('NOT_FOUND', 404, 'Credential not found');

      // next_run_at desde el cron (UTC). El cron ya es valido (Zod), pero puede ser IMPOSIBLE (p.ej.
      // 30 de febrero): nextCronRun -> null -> 400, en vez de crear una tarea que jamas dispara.
      const next = nextCronRun(parsed.data.cronExpression, new Date());
      if (next === null) {
        throw new AppError('VALIDATION_ERROR', 400, 'cron_expression sin proximas ejecuciones');
      }

      const task = await taskRepo.createTask({
        ownerId: user.id,
        agentId: parsed.data.agentId,
        credentialId: parsed.data.credentialId,
        cronExpression: parsed.data.cronExpression,
        payload: parsed.data.payload,
        nextRunAt: next,
      });
      return reply.status(201).send({ task });
    });

    // Lista las tareas del owner (estado, ultimo y proximo run).
    app.get('/v1/scheduled-tasks', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const tasks = await taskRepo.listTasksByOwner(user.id);
      return reply.send({ tasks });
    });

    // Activa/desactiva o edita (cron/payload) una tarea del owner. Recalcula next_run_at si cambia el
    // cron o si se REACTIVA (para no disparar un horario viejo apenas se vuelve a activar).
    app.patch(
      '/v1/scheduled-tasks/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);

        const params = TaskIdParamSchema.safeParse(request.params);
        if (!params.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid task id', params.error.issues);
        }
        const parsed = UpdateScheduledTaskSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid scheduled task update', parsed.error.issues);
        }

        const current = await taskRepo.getTaskForOwner(params.data.id, user.id);
        if (!current) throw new AppError('NOT_FOUND', 404, 'Scheduled task not found');

        // Fusiona el patch sobre la tarea actual (campos no enviados se preservan).
        const cronExpression = parsed.data.cronExpression ?? current.cronExpression;
        const payload = parsed.data.payload ?? current.payload;
        const isActive = parsed.data.isActive ?? current.isActive;

        const cronChanged = parsed.data.cronExpression !== undefined && cronExpression !== current.cronExpression;
        const reactivated = isActive && !current.isActive;

        // next_run_at: se recalcula desde ahora si cambia el cron o se reactiva; si no, se preserva el
        // valor actual (no se reinicia el horario por editar solo el payload).
        let nextRunAt: Date | string | null = current.nextRunAt;
        if (cronChanged || reactivated) {
          const next = nextCronRun(cronExpression, new Date());
          if (next === null) {
            throw new AppError('VALIDATION_ERROR', 400, 'cron_expression sin proximas ejecuciones');
          }
          nextRunAt = next;
        }

        const task = await taskRepo.updateTaskForOwner(params.data.id, user.id, {
          cronExpression,
          payload,
          isActive,
          nextRunAt,
        });
        if (!task) throw new AppError('NOT_FOUND', 404, 'Scheduled task not found');
        return reply.send({ task });
      },
    );

    // Borra una tarea del owner. Acotado al owner: solo borra las propias.
    app.delete(
      '/v1/scheduled-tasks/:id',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await requireUser(request, verifier);
        const params = TaskIdParamSchema.safeParse(request.params);
        if (!params.success) {
          throw new AppError('VALIDATION_ERROR', 400, 'Invalid task id', params.error.issues);
        }
        const removed = await taskRepo.deleteTaskForOwner(params.data.id, user.id);
        if (!removed) throw new AppError('NOT_FOUND', 404, 'Scheduled task not found');
        return reply.status(204).send();
      },
    );
  };
}
