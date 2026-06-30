import { z } from 'zod';
import type { AgentEvent, Job, NormalizedMessage, TokenUsage } from '@ledesma-platform/shared';
// IMPORTS DE TIPOS (type-only): el motor real (assembleAgentRun/runAgent), los repos y la boveda se
// INYECTAN como dependencias (ver JobRunnerDeps). Asi este modulo no carga en runtime el backend ni sus
// SDK de proveedor: los tests pasan fakes y nunca llaman al modelo. El cableado de las implementaciones
// reales vive solo en index.ts.
import type {
  AgentConfig,
  AgentDeps,
  AgentRunInput,
  AssembleAgentRunParams,
  AssembledAgentRun,
  DecryptedProviderCredential,
  ProfileTier,
} from '@ledesma-platform/backend/execution';
import type { Logger } from './logger.js';

/**
 * Maximo de intentos por job antes de darlo por FALLIDO definitivo. claimNextJob incrementa attempts en
 * cada toma, asi que la cuenta es: toma 1 (attempts=1) -> ... -> toma 3 (attempts=3). Tras el 3er fallo
 * transitorio el job queda 'failed' y no se reintenta mas.
 */
export const MAX_ATTEMPTS = 3;

/** Base del backoff lineal entre reintentos (ms). El claim no retoma el job hasta que venza. */
const RETRY_BACKOFF_BASE_MS = 5_000;

/**
 * Fallo PERMANENTE: no tiene sentido reintentar porque no se va a arreglar solo (hoy: tier
 * insuficiente). Va directo a 'failed' SIN consumir los reintentos, a diferencia de un fallo
 * transitorio (error de proveedor, timeout) que si se reintenta.
 */
export class PermanentExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentExecutionError';
  }
}

/** El run supero el deadline de pared del worker: fallo TRANSITORIO del intento (cuenta para reintentos). */
export class RunTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`el run supero el timeout de pared de ${timeoutMs}ms`);
    this.name = 'RunTimeoutError';
  }
}

/**
 * El worker se esta apagando (SIGTERM/SIGINT) y aborto el run en curso. NO es culpa del job: se devuelve
 * a 'pending' para que se re-reclame, sin marcarlo failed aunque haya agotado intentos.
 */
export class ShutdownAbortError extends Error {
  constructor() {
    super('ejecucion abortada por apagado del worker');
    this.name = 'ShutdownAbortError';
  }
}

/** Subconjunto del JobsRepository que la ejecucion necesita (facil de mockear en tests). */
export interface JobQueue {
  claimNextJob(): Promise<Job | null>;
  markCompleted(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  markPendingRetry(id: string, error: string, scheduledFor?: Date | string | null): Promise<void>;
}

/** Cortes y parametros del motor que el worker aplica al ejecutar un job. */
export interface ExecutionConfig {
  /** Deadline de pared del run, en ms (RUN_TIMEOUT_SECONDS * 1000). Lo aplica el worker, no runAgent. */
  runTimeoutMs: number;
  /** Cap de tokens acumulados del run (RUN_MAX_TOKENS). */
  runMaxTokens: number;
  /** Worker nativo de plataforma (tools nativas). Si falta alguno, no se inyectan nativas. */
  webWorkerUrl?: string;
  webWorkerSecret?: string;
}

/**
 * Dependencias de la ejecucion de un job. TODO se inyecta para poder testear sin tocar la DB, el motor
 * real ni el modelo. index.ts cablea las implementaciones reales (repos del backend + assembleAgentRun
 * + runAgent); los tests pasan fakes.
 */
export interface JobRunnerDeps {
  jobs: JobQueue;
  /** Lee profiles.tier del owner para el gate server-side (nunca se confia en el cliente). */
  getProfileTier(ownerId: string): Promise<ProfileTier | null>;
  /** Carga la config del agente (autoritativa). null si no existe. */
  loadAgent(agentId: string): Promise<AgentConfig | null>;
  /** Resuelve y descifra la credencial guardada del owner. Lanza si no existe / no es resoluble. */
  resolveCredential(ownerId: string, credentialId: string): Promise<DecryptedProviderCredential>;
  /** Ensamblado reutilizable del run (sin HTTP). */
  assembleAgentRun(params: AssembleAgentRunParams): AssembledAgentRun;
  /** Loop agentico generico (no aplica timeout: lo aplica el worker). */
  runAgent(input: AgentRunInput, deps: AgentDeps): AsyncIterable<AgentEvent>;
  logger: Logger;
  config: ExecutionConfig;
}

/** Mensajes del payload de un job: mismo shape que el body de /v1/run/:agentId. */
const JobPayloadSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .min(1),
  // Cota de iteraciones opcional; runAgent valida su rango (1..cap) y lanza si se excede.
  maxIterations: z.number().int().positive().optional(),
});

interface ParsedPayload {
  messages: NormalizedMessage[];
  maxIterations?: number;
}

/**
 * Valida el payload del job y lo normaliza a NormalizedMessage[]. A diferencia de la ruta HTTP, el
 * worker NO incorpora adjuntos (su extraccion vive acoplada a la ruta): un job autonomo lleva solo
 * texto. Un payload mal formado lanza -> se trata como fallo transitorio del intento.
 */
function parsePayloadMessages(payload: unknown): ParsedPayload {
  const parsed = JobPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`payload del job invalido: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  const messages: NormalizedMessage[] = parsed.data.messages.map((m) => ({
    role: m.role,
    content: [{ type: 'text', text: m.content }],
  }));
  return {
    messages,
    ...(parsed.data.maxIterations !== undefined ? { maxIterations: parsed.data.maxIterations } : {}),
  };
}

/** Mensaje de error sanitizado para logs / last_error. NUNCA incluye la apiKey ni datos sensibles. */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'error desconocido';
}

/**
 * Ejecuta runAgent aplicando el DEADLINE DE PARED del worker (runAgent no lo aplica). Patron del
 * sse-runner SIN HTTP: un AbortController + setTimeout(runTimeoutMs) que llama abort(); el signal va a
 * runAgent. El mismo controller se aborta tambien si llega el apagado del worker (shutdownSignal). Se
 * consume el AsyncIterable hasta el final para detectar el stop y acumular el uso. clearTimeout SIEMPRE
 * en finally (sin fugas de timers). Distingue el corte por timeout (RunTimeoutError, transitorio) del
 * corte por apagado (ShutdownAbortError, re-reclamable).
 */
async function runAgentWithDeadline(
  deps: JobRunnerDeps,
  input: AgentRunInput,
  executeTool: AssembledAgentRun['executeTool'],
  shutdownSignal?: AbortSignal,
): Promise<{ stopReason: string; usage: TokenUsage }> {
  const controller = new AbortController();
  let timedOut = false;
  const onShutdown = (): void => controller.abort();
  if (shutdownSignal) {
    if (shutdownSignal.aborted) controller.abort();
    else shutdownSignal.addEventListener('abort', onShutdown, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.config.runTimeoutMs);

  let stopReason: string | null = null;
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  try {
    for await (const event of deps.runAgent({ ...input, signal: controller.signal }, { executeTool })) {
      if (controller.signal.aborted) break;
      if (event.type === 'stop') {
        stopReason = event.reason;
        usage = event.usage;
      }
    }
    // Un stop natural manda: si el run llego a emitir su stop final, TERMINO ok aunque el abort por
    // timeout/apagado se haya disparado en el mismo instante (no re-encolar ni re-cobrar un run hecho).
    if (stopReason !== null) return { stopReason, usage };
    // Sin stop: el controller se aborto, o por timeout (transitorio) o por apagado (re-reclamable).
    if (timedOut) throw new RunTimeoutError(deps.config.runTimeoutMs);
    if (controller.signal.aborted) throw new ShutdownAbortError();
    throw new Error('el run termino sin un evento stop');
  } catch (error) {
    // El abort puede hacer que el proveedor/loop lance (p.ej. AbortError): reclasificar segun la causa.
    if (timedOut) throw new RunTimeoutError(deps.config.runTimeoutMs);
    if (controller.signal.aborted && shutdownSignal?.aborted) throw new ShutdownAbortError();
    throw error;
  } finally {
    clearTimeout(timer);
    if (shutdownSignal) shutdownSignal.removeEventListener('abort', onShutdown);
  }
}

/**
 * Ejecuta UN job ya reclamado (claimNextJob ya lo puso 'running' e incremento attempts) de punta a
 * punta y lo CIERRA en la cola segun el desenlace:
 *  - gate por tier: si el owner no es 'autonomous' -> fallo PERMANENTE -> 'failed' directo (sin gastar
 *    reintentos), porque no se arregla solo;
 *  - exito (el run llega a un stop natural) -> markCompleted;
 *  - fallo TRANSITORIO (agente ausente, credencial irresoluble, error de proveedor, timeout) ->
 *    si attempts < MAX_ATTEMPTS vuelve a 'pending' con backoff (markPendingRetry); si attempts >=
 *    MAX_ATTEMPTS queda 'failed' definitivo;
 *  - apagado del worker a media ejecucion -> vuelve a 'pending' SIN gastar el intento como permanente.
 * Captura TODO el flujo: nunca propaga (el loop no se cae por un job roto). Las transiciones de cierre
 * tambien estan protegidas; si una falla de DB, se propaga al loop, que hace back off por intervalo.
 */
export async function processClaimedJob(
  deps: JobRunnerDeps,
  job: Job,
  shutdownSignal?: AbortSignal,
): Promise<void> {
  const { logger } = deps;
  try {
    // 1. GATE POR TIER (server-side, antes de gastar nada): la ejecucion autonoma es premium. Un owner
    //    que no es 'autonomous' no debe seguir corriendo jobs -> fallo permanente, no transitorio.
    const tier = await deps.getProfileTier(job.ownerId);
    if (tier !== 'autonomous') {
      throw new PermanentExecutionError('autonomous execution requires the autonomous plan');
    }

    // 2. Cargar el agente (config autoritativa: provider/model/tools/...).
    const agent = await deps.loadAgent(job.agentId);
    if (!agent) {
      throw new Error(`agente ${job.agentId} no encontrado`);
    }

    // 3. Resolver la credencial de la boveda por owner + credential (descifra server-side).
    const credential = await deps.resolveCredential(job.ownerId, job.credentialId);

    // 4. Defensa: una credencial guardada solo sirve contra un agente del MISMO proveedor (igual que la
    //    ruta /v1/run/:agentId). Sin esto la key de un proveedor iria al endpoint de otro.
    if (credential.providerId !== agent.providerId) {
      throw new Error(
        `la credencial es de ${credential.providerId} pero el agente usa ${agent.providerId}`,
      );
    }

    // 5. Mensajes del payload -> NormalizedMessage[].
    const { messages, maxIterations } = parsePayloadMessages(job.payload);

    // 6. Ensamblar el run (executeTool + AgentRunInput) con el motor reutilizable, sin HTTP.
    const { input, executeTool } = deps.assembleAgentRun({
      agent,
      credential: { apiKey: credential.apiKey, baseUrl: credential.baseUrl },
      messages,
      nativeTools: {
        ...(deps.config.webWorkerUrl !== undefined ? { workerUrl: deps.config.webWorkerUrl } : {}),
        ...(deps.config.webWorkerSecret !== undefined ? { workerSecret: deps.config.webWorkerSecret } : {}),
      },
      limits: { maxTokens: deps.config.runMaxTokens, runTimeoutMs: deps.config.runTimeoutMs },
      ...(maxIterations !== undefined ? { maxIterations } : {}),
      warn: (message) => logger.warn('aviso al ensamblar el run', { jobId: job.id, message }),
    });

    // 7. Ejecutar con el deadline de pared propio del worker.
    const { stopReason, usage } = await runAgentWithDeadline(deps, input, executeTool, shutdownSignal);

    await deps.jobs.markCompleted(job.id);
    logger.info('job completado', {
      jobId: job.id,
      agentId: job.agentId,
      stopReason,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  } catch (error) {
    await handleFailure(deps, job, error);
  }
}

/** Decide el cierre de un job que fallo: permanente / apagado / transitorio (reintento o definitivo). */
async function handleFailure(deps: JobRunnerDeps, job: Job, error: unknown): Promise<void> {
  const { logger } = deps;
  const reason = describeError(error);

  // Apagado del worker: no es culpa del job. Vuelve a 'pending' para re-reclamar, sin gastar el intento
  // como fallo permanente (incluso si ya agoto attempts: el corte fue externo).
  if (error instanceof ShutdownAbortError) {
    await deps.jobs.markPendingRetry(job.id, reason, null);
    logger.info('job devuelto a pending por apagado del worker', { jobId: job.id, attempts: job.attempts });
    return;
  }

  // Fallo PERMANENTE (tier insuficiente): no se reintenta, va directo a 'failed'.
  if (error instanceof PermanentExecutionError) {
    await deps.jobs.markFailed(job.id, reason);
    logger.warn('job fallido permanente (sin reintento)', {
      jobId: job.id,
      attempts: job.attempts,
      reason,
    });
    return;
  }

  // Fallo TRANSITORIO: reintentar mientras queden intentos; si no, 'failed' definitivo.
  if (job.attempts >= MAX_ATTEMPTS) {
    await deps.jobs.markFailed(job.id, reason);
    logger.error('job fallido definitivo tras agotar reintentos', {
      jobId: job.id,
      attempts: job.attempts,
      reason,
    });
    return;
  }

  const backoffMs = job.attempts * RETRY_BACKOFF_BASE_MS;
  const scheduledFor = new Date(Date.now() + backoffMs);
  await deps.jobs.markPendingRetry(job.id, reason, scheduledFor);
  logger.warn('job reencolado para reintento', {
    jobId: job.id,
    attempts: job.attempts,
    retryInMs: backoffMs,
    reason,
  });
}

/**
 * Toma de forma ATOMICA el proximo job elegible (claimNextJob: FOR UPDATE SKIP LOCKED, asi dos workers
 * nunca toman el mismo) y lo ejecuta. Devuelve 'empty' si la cola no tiene nada elegible, o 'processed'
 * si proceso uno. processClaimedJob no propaga, asi que un job roto no rompe esto.
 */
export async function claimAndProcessOne(
  deps: JobRunnerDeps,
  shutdownSignal?: AbortSignal,
): Promise<'empty' | 'processed'> {
  const job = await deps.jobs.claimNextJob();
  if (!job) return 'empty';
  deps.logger.info('job reclamado', {
    jobId: job.id,
    agentId: job.agentId,
    attempts: job.attempts,
  });
  await processClaimedJob(deps, job, shutdownSignal);
  return 'processed';
}
