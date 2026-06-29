import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { AgentRepository } from '../agents/agent-repository.js';
import { AgentRunRepository } from '../agents/run-repository.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { createWebhookExecutor } from '../tools/webhook-tools.js';
import { NATIVE_TOOL_PREFIX } from '../tools/native-tools.js';

// Exportado (sin cambiar sus reglas) para que el validador del agent-spec (agents/agent-spec.ts)
// REUSE el mismo schema de webhook tools en vez de redefinirlo. La compuerta del Configurador y el
// endpoint comparten asi una unica fuente de verdad.
export const StoredToolSchema = z.object({
  // El prefijo platform_ esta reservado para las tools nativas de la plataforma: el cliente no
  // puede crear/actualizar tools con el (aplica en POST y PUT, ambos via AgentInputSchema).
  name: z
    .string()
    .min(1)
    .refine((n) => !n.startsWith(NATIVE_TOOL_PREFIX), {
      message: 'El prefijo platform_ esta reservado para herramientas nativas de la plataforma',
    }),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  url: z.string().url().startsWith('https://', 'Webhook URL must use https'),
});

// webhookSecret NO es parte del input: lo genera la base al crear y el update nunca lo toca.
// Las respuestas si lo incluyen (viene en el AgentConfig del repo) para mostrarlo en Conectar.
// La rotacion del secreto tiene endpoint dedicado: POST /v1/agents/:id/webhook-secret/rotate.
const TestToolBodySchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
});

const UsageQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// Exportado (sin cambiar sus reglas) para que el validador del agent-spec reuse el MISMO schema de
// creacion como compuerta final: garantiza que el `value` que produce sea input directo de POST
// /v1/agents sin duplicar las reglas de validacion del endpoint.
export const AgentInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  providerId: z.enum(['anthropic', 'openai', 'openai-compatible']),
  model: z.string().min(1).max(120),
  systemPrompt: z.string().max(50000).optional(),
  maxTokens: z.number().int().positive().max(32000).optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  baseUrl: z.string().url().nullable().optional(),
  tools: z.array(StoredToolSchema).max(50).optional(),
});

/** Input EXACTO que acepta POST /v1/agents (lo que el handler pasa a repo.create, sin ownerId). */
export type AgentCreateInput = z.infer<typeof AgentInputSchema>;

/** Permite inyectar el verifier en tests. */
export function agentRoutes(config: Env, deps?: { verifier?: JwtVerifier }) {
  return async function (app: FastifyInstance): Promise<void> {
    const repo = new AgentRepository(getSql(config));
    const runRepo = new AgentRunRepository(getSql(config));
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);

    app.get('/v1/agents', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const agents = await repo.listByOwner(user.id);
      return reply.send({ agents });
    });

    app.get('/v1/agents/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const agent = await repo.getByIdForOwner(request.params.id, user.id);
      if (!agent) throw new AppError('NOT_FOUND', 404, 'Agent not found');
      return reply.send({ agent });
    });

    // Uso por agente: totales, corridas recientes y serie diaria (solo metadatos), acotado al
    // owner y opcionalmente a un rango de fechas ISO via ?from= y ?to=.
    app.get('/v1/agents/:id/usage', async (request: FastifyRequest<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = UsageQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid usage range', parsed.error.issues);
      const agent = await repo.getByIdForOwner(request.params.id, user.id);
      if (!agent) throw new AppError('NOT_FOUND', 404, 'Agent not found');
      const range = {
        from: parsed.data.from ? new Date(parsed.data.from) : undefined,
        to: parsed.data.to ? new Date(parsed.data.to) : undefined,
      };
      const [totals, recent, runsByDay] = await Promise.all([
        runRepo.totalsForAgent(agent.id, range),
        runRepo.recentForAgent(agent.id, range),
        runRepo.runsByDay(agent.id, range),
      ]);
      return reply.send({ totals, recent, runsByDay });
    });

    app.post('/v1/agents', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = AgentInputSchema.safeParse(request.body);
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid agent config', parsed.error.issues);
      // owner_id SIEMPRE = usuario autenticado (ignora cualquier ownerId del body).
      const agent = await repo.create({ ...parsed.data, ownerId: user.id });
      return reply.status(201).send({ agent });
    });

    app.put('/v1/agents/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const parsed = AgentInputSchema.safeParse(request.body);
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid agent config', parsed.error.issues);
      const agent = await repo.updateForOwner(request.params.id, user.id, parsed.data);
      if (!agent) throw new AppError('NOT_FOUND', 404, 'Agent not found');
      return reply.send({ agent });
    });

    // Rota el secreto de webhooks del agente (acotado al owner); la base genera el valor nuevo.
    app.post('/v1/agents/:id/webhook-secret/rotate', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const agent = await repo.rotateWebhookSecret(request.params.id, user.id);
      if (!agent) throw new AppError('NOT_FOUND', 404, 'Agent not found');
      return reply.send({ agent });
    });

    // Prueba una tool GUARDADA con un input dado, usando el MISMO ejecutor firmado de produccion
    // (firma HMAC, guardas anti-SSRF y timeout incluidos). Acotado al owner.
    app.post('/v1/agents/:id/tools/:toolName/test', async (request: FastifyRequest<{ Params: { id: string; toolName: string } }>, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const agent = await repo.getByIdForOwner(request.params.id, user.id);
      if (!agent) throw new AppError('NOT_FOUND', 404, 'Agent not found');
      const tool = agent.tools.find((t) => t.name === request.params.toolName);
      if (!tool) throw new AppError('NOT_FOUND', 404, 'Tool not found');
      const parsed = TestToolBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid test input', parsed.error.issues);
      // Los fallos del ejecutor se reportan al log del request (pino, con redaccion) en vez
      // del console.warn por default.
      const executor = createWebhookExecutor([tool], agent.webhookSecret, undefined, {
        warn: (message) => request.log.warn(message),
      });
      const startedAt = Date.now();
      const result = await executor({ id: 'test', name: tool.name, input: parsed.data.input });
      return reply.send({
        content: result.content,
        isError: result.isError === true,
        durationMs: Date.now() - startedAt,
      });
    });

    app.delete('/v1/agents/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await requireUser(request, verifier);
      const removed = await repo.removeForOwner(request.params.id, user.id);
      if (!removed) throw new AppError('NOT_FOUND', 404, 'Agent not found');
      return reply.status(204).send();
    });
  };
}
