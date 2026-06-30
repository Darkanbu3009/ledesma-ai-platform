import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  ContentBlock,
  NormalizedMessage,
  NormalizedRequest,
  ProviderCredentials,
} from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { extractDocumentText, truncateText } from '../attachments/extract.js';
import { AppError } from '../errors/app-error.js';
import { verifySessionToken } from '../auth/session-token.js';
import { getSql } from '../db/client.js';
import { AgentRepository } from '../agents/agent-repository.js';
import { AgentRunRepository } from '../agents/run-repository.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';
import { ProviderCredentialRepository } from '../credentials/provider-credential-repository.js';
import { resolveStoredCredential } from '../credentials/resolve-stored-credential.js';
import { createDemoRegistry } from '../tools/demo-registry.js';
import { createWebhookExecutor, storedToolsToDefinitions } from '../tools/webhook-tools.js';
import { createNativeExecutor, nativeToolsToDefinitions, NATIVE_TOOL_NAMES } from '../tools/native-tools.js';
import { AGENT_LIMITS, type ToolExecutor } from '../agent/index.js';
import { streamAgentRun } from './sse-runner.js';

// Adjuntos por referencia (URL): imagenes a vision nativa, documentos a texto extraido.
// Las URLs son chicas y no presionan el limite de body (1MB); el TEXTO extraido de documentos
// SI cuenta para maxTotalContentChars y se trunca al armar el request (ver abajo).
const AttachmentSchema = z.object({
  kind: z.enum(['image', 'pdf', 'excel', 'word']),
  url: z.string().url().max(2048),
  mimeType: z.string().min(1).max(255),
  // name acotado: ademas de sanidad, evita que un encabezado '[Adjunto: <name>]' enorme infle el
  // presupuesto de caracteres del contenido.
  name: z.string().min(1).max(255),
});

const RunByIdBodySchema = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
      .min(1)
      .max(AGENT_LIMITS.maxMessages),
    maxIterations: z.number().int().positive().max(AGENT_LIMITS.maxIterationsCap).optional(),
    attachments: z.array(AttachmentSchema).max(AGENT_LIMITS.maxAttachments).optional(),
  })
  .refine(
    (body) => body.messages.reduce((s, m) => s + m.content.length, 0) <= AGENT_LIMITS.maxTotalContentChars,
    { message: `Total content length exceeds ${AGENT_LIMITS.maxTotalContentChars} characters` },
  );

type AttachmentInput = z.infer<typeof AttachmentSchema>;

/**
 * Arma los mensajes normalizados incorporando los adjuntos al ultimo turno del usuario:
 *  - imagenes -> ImageBlock (source url) para la vision nativa del proveedor;
 *  - documentos (pdf/excel/word) -> texto extraido como TextBlock con encabezado, prepended.
 * El texto de documentos respeta el presupuesto restante de maxTotalContentChars y se trunca con
 * marca si excede. Un adjunto que falla en extraerse se degrada a una nota; nunca tumba el run.
 */
async function buildMessagesWithAttachments(params: {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  attachments: AttachmentInput[];
  systemChars: number;
  warn: (message: string) => void;
}): Promise<NormalizedMessage[]> {
  const { messages, attachments, systemChars, warn } = params;
  const baseMessages: NormalizedMessage[] = messages.map((m) => ({
    role: m.role,
    content: [{ type: 'text', text: m.content }],
  }));

  if (attachments.length === 0) return baseMessages;

  // Los adjuntos pertenecen al turno actual: el ultimo mensaje de rol user.
  let targetIdx = -1;
  for (let i = baseMessages.length - 1; i >= 0; i--) {
    if (baseMessages[i]?.role === 'user') {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx === -1) {
    warn('se recibieron adjuntos pero ningun mensaje de rol user; se ignoran');
    return baseMessages;
  }

  // Presupuesto de chars para texto de documentos: lo que queda de maxTotalContentChars tras
  // descontar system + el texto de los mensajes. Las URLs de imagen no consumen presupuesto.
  const baseChars = systemChars + messages.reduce((s, m) => s + m.content.length, 0);
  let remaining = Math.max(0, AGENT_LIMITS.maxTotalContentChars - baseChars);

  const docBlocks: ContentBlock[] = [];
  const imageBlocks: ContentBlock[] = [];

  for (const att of attachments) {
    if (att.kind === 'image') {
      imageBlocks.push({
        type: 'image',
        source: { kind: 'url', url: att.url, mimeType: att.mimeType },
      });
      continue;
    }

    const header = `[Adjunto: ${att.name}]\n`;
    const budget = Math.max(0, remaining - header.length);
    let body: string;
    try {
      body = await extractDocumentText(
        { kind: att.kind, url: att.url, mimeType: att.mimeType, name: att.name },
        { maxChars: budget },
      );
    } catch (error) {
      body = `(no se pudo procesar el adjunto: ${error instanceof Error ? error.message : 'error desconocido'})`;
      warn(`extraccion de adjunto '${att.name}' fallo: ${error instanceof Error ? error.message : 'desconocido'}`);
    }
    // El bloque COMPLETO (encabezado + cuerpo) se acota al presupuesto restante: truncateText nunca
    // devuelve mas de 'remaining' caracteres, asi la suma de documentos jamas empuja el total por
    // encima de maxTotalContentChars, aun con encabezados o cuerpos largos.
    const blockText = truncateText(`${header}${body}`, remaining);
    docBlocks.push({ type: 'text', text: blockText });
    remaining = Math.max(0, remaining - blockText.length);
  }

  const target = baseMessages[targetIdx];
  if (target) {
    // Documentos prepended (encabezado claro), luego el texto original, luego las imagenes.
    target.content = [...docBlocks, ...target.content, ...imageBlocks];
  }
  return baseMessages;
}

/**
 * Contrato de integracion para sistemas externos: la config del agente vive en la plataforma;
 * el integrador solo manda mensajes + su key BYOK. Devuelve el mismo SSE que /v1/agent/run.
 */
export function runAgentByIdRoutes(
  config: Env,
  deps?: { verifier?: JwtVerifier; credentialRepo?: ProviderCredentialRepository },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const repo = new AgentRepository(getSql(config));
    const runRepo = new AgentRunRepository(getSql(config));
    const credentialRepo = deps?.credentialRepo ?? new ProviderCredentialRepository(getSql(config));
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);

    // Plano de ejecucion: BYOK por header o token de sesion efimero; el agentId (uuid)
    // identifica la config.
    app.post('/v1/run/:agentId', { bodyLimit: AGENT_LIMITS.maxBodyBytes }, async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      // Fuente de la key, con PRECEDENCIA explicita. Las dos primeras ramas son el flujo del widget
      // publico y NO cambian (no requieren identidad de usuario / JWT):
      //  1) x-session-token (emitido en /v1/session-tokens): trae la key cifrada atada a este agentId;
      //     cualquier fallo (corrupto, expirado, de otro agente) responde 401 generico.
      //  2) x-provider-key: la key BYOK al momento.
      //  3) x-credential-id: una credencial GUARDADA. A diferencia del widget, esto SI requiere
      //     identidad de usuario (JWT Bearer) porque una credencial guardada solo es usable por su
      //     owner; sin key al momento y con credentialId, resolvemos la credencial del usuario
      //     autenticado. La config del agente sigue siendo autoritativa (providerId/model/baseUrl):
      //     la credencial solo aporta la apiKey.
      const sessionToken = request.headers['x-session-token'];
      const credentialIdHeader = request.headers['x-credential-id'];
      let apiKey: string;
      if (typeof sessionToken === 'string' && sessionToken !== '') {
        apiKey = verifySessionToken(sessionToken, agentId, config.SESSION_TOKEN_SECRET).providerKey;
      } else {
        const headerKey = request.headers['x-provider-key'];
        if (typeof headerKey === 'string' && headerKey.trim() !== '') {
          apiKey = headerKey;
        } else if (typeof credentialIdHeader === 'string' && credentialIdHeader.trim() !== '') {
          const user = await requireUser(request, verifier);
          const credential = await resolveStoredCredential(
            credentialRepo,
            user.id,
            credentialIdHeader,
            config.VAULT_SECRET,
          );
          apiKey = credential.apiKey;
        } else {
          throw new AppError('VALIDATION_ERROR', 400, 'Missing x-provider-key header');
        }
      }
      const agent = await repo.getById(agentId);
      if (!agent) {
        throw new AppError('NOT_FOUND', 404, 'Agent not found');
      }
      const parsed = RunByIdBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid request body', parsed.error.issues);
      }

      // Tools nativas de plataforma: se inyectan en TODOS los agentes cuando el worker esta
      // configurado (ambas env vars). Las tools de cliente se ejecutan por webhook (firmadas con el
      // secreto del agente); si no hay ni nativas ni stored tools, se mantiene el registro demo
      // (mismo comportamiento que /v1/agent/run).
      const workerUrl = config.WEB_WORKER_URL;
      const workerSecret = config.WEB_WORKER_SECRET;
      const nativasActivas = Boolean(workerUrl && workerSecret);
      const hasStoredTools = agent.tools.length > 0;

      // Defs del modelo: nativas (si activas) + las del cliente. El demo solo cuando no hay ninguna.
      const nativeDefs = nativasActivas ? nativeToolsToDefinitions() : [];
      const clientDefs = hasStoredTools ? storedToolsToDefinitions(agent.tools) : [];
      const registry = !nativasActivas && !hasStoredTools ? createDemoRegistry() : null;

      // Dedupe defensivo: las nativas tienen precedencia; el modelo nunca recibe dos tools con el
      // mismo name (el prefijo reservado platform_ ya lo evita al crear, esto es cinturon y tirantes).
      const nativeNames = new Set(nativeDefs.map((d) => d.name));
      const clientDefsSinColision = clientDefs.filter((d) => {
        if (nativeNames.has(d.name)) {
          request.log.warn(`tool de cliente '${d.name}' descartada por colision con una tool nativa de la plataforma`);
          return false;
        }
        return true;
      });
      const toolDefinitions = registry
        ? registry.toToolDefinitions()
        : [...nativeDefs, ...clientDefsSinColision];

      // Ejecutor con dispatch por nombre: las nativas van primero (defensa anti-colision), el resto
      // al ejecutor de cliente (webhook o demo). El flujo de cliente queda intacto.
      const clientExec = hasStoredTools
        ? createWebhookExecutor(agent.tools, agent.webhookSecret, undefined, {
            warn: (message) => request.log.warn(message),
          })
        : registry
          ? registry.toExecutor()
          : null;
      const nativeExec =
        workerUrl && workerSecret
          ? createNativeExecutor(workerUrl, workerSecret, undefined, {
              warn: (message) => request.log.warn(message),
            })
          : null;
      const executeTool: ToolExecutor = (call, abortSignal) => {
        if (nativeExec && NATIVE_TOOL_NAMES.has(call.name)) return nativeExec(call, abortSignal);
        if (clientExec) return clientExec(call, abortSignal);
        return Promise.resolve({ content: `Tool desconocida: ${call.name}`, isError: true });
      };
      const messages = await buildMessagesWithAttachments({
        messages: parsed.data.messages,
        attachments: parsed.data.attachments ?? [],
        systemChars: agent.systemPrompt?.length ?? 0,
        warn: (message) => request.log.warn(message),
      });
      const normalizedRequest: NormalizedRequest = {
        ...(agent.systemPrompt ? { system: agent.systemPrompt } : {}),
        messages,
        tools: toolDefinitions,
        modelConfig: {
          model: agent.model,
          maxTokens: agent.maxTokens,
          ...(agent.temperature !== null ? { temperature: agent.temperature } : {}),
        },
      };
      const credentials: ProviderCredentials = {
        apiKey,
        ...(agent.providerId === 'openai-compatible' && agent.baseUrl ? { baseUrl: agent.baseUrl } : {}),
      };

      return streamAgentRun(
        request,
        reply,
        {
          providerId: agent.providerId,
          credentials,
          request: normalizedRequest,
          ...(parsed.data.maxIterations !== undefined ? { maxIterations: parsed.data.maxIterations } : {}),
        },
        executeTool,
        // Registro fire-and-forget de la corrida (solo metadatos): la corrida del cliente JAMAS
        // falla por el registro; si el insert falla solo se deja un warn.
        (outcome) => {
          void runRepo
            .record({
              agentId: agent.id,
              ownerId: agent.ownerId,
              providerId: agent.providerId,
              model: agent.model,
              inputTokens: outcome.inputTokens,
              outputTokens: outcome.outputTokens,
              stopReason: outcome.stopReason,
              status: outcome.status,
              errorCode: outcome.errorCode,
              durationMs: outcome.durationMs,
            })
            .catch((error) => {
              request.log.warn(
                { err: { message: error instanceof Error ? error.message : 'unknown' } },
                'run record failed',
              );
            });
        },
      );
    });
  };
}
