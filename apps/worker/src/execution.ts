import { z } from 'zod';
import {
  HEARTBEAT_INTERVAL_MS,
  REAP_SIN_LATIDO_MULTIPLO,
  isRecipeJobPayload,
  isGrabacionJobPayload,
  isPromoverTrayectoriaJobPayload,
  isSitioJobPayload,
  isTareaWebJobPayload,
  parseRecipeJobPayload,
  tierAllowsAutonomy,
} from '@ledesma-platform/shared';
import type {
  AgentEvent,
  Job,
  JobStatus,
  NormalizedMessage,
  ReapedJob,
  RecipeStepPayload,
  TokenUsage,
} from '@ledesma-platform/shared';
// IMPORTS DE TIPOS (type-only): el motor real (assembleAgentRun/runAgent), los repos y la boveda se
// INYECTAN como dependencias (ver JobRunnerDeps). Asi este modulo no carga en runtime el backend ni sus
// SDK de proveedor: los tests pasan fakes y nunca llaman al modelo. El cableado de las implementaciones
// reales vive solo en index.ts.
import type {
  AgentConfig,
  AgentDeps,
  AgentRunInput,
  AgentRunRecord,
  AssembleAgentRunParams,
  AssembledAgentRun,
  DecryptedProviderCredential,
  ProfileTier,
} from '@ledesma-platform/backend/execution';
import { procesarJobDeSitio } from './sitios.js';
import type { SitiosJobDeps } from './sitios.js';
import { procesarTareaWeb } from './tarea-web.js';
import type { TareaWebDeps } from './tarea-web.js';
import { procesarJobDeGrabacion } from './grabacion.js';
import type { GrabacionDeps } from './grabacion.js';
import { procesarJobDePromoverTrayectoria } from './promover-trayectoria.js';
import type { PromocionTrayectoriaDeps } from './promover-trayectoria.js';
import type { BarridoAprobacionesDeps } from './aprobaciones.js';
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
 * Umbral del REAPER POR LATIDO (ms): un job 'running' cuyo updated_at (el latido, ver iniciarLatido)
 * es mas viejo que esto esta DETENIDO con certeza, sea cual sea su tipo: mientras el worker que lo
 * posee este vivo, late cada HEARTBEAT_INTERVAL_MS. 3 intervalos (90s) toleran una escritura de
 * latido fallida (best-effort) sin declarar muerto a un job vivo. REEMPLAZA a los margenes por tipo
 * derivados de started_at: el latido cubre TODA corrida reclamada (se arranca en processClaimedJob,
 * antes de ejecutar nada), asi que no queda ninguna ruta sin latido que necesite el umbral viejo.
 */
export const REAP_STALE_MS = REAP_SIN_LATIDO_MULTIPLO * HEARTBEAT_INTERVAL_MS;

/**
 * Intentos de la ESCRITURA de cierre exitoso (markCompleted) ante un fallo TRANSITORIO de la DB, ANTES
 * de rendirse. Reduce la ventana de DOBLE EJECUCION del informe 06 (H1): un blip de red a Postgres justo
 * despues de un run exitoso ya no cae directo a re-encolar (y por tanto re-ejecutar) el job.
 */
const COMPLETION_RETRY_ATTEMPTS = 3;

/** Base del backoff CORTO entre reintentos de markCompleted (ms). Crece lineal por intento (200/400ms). */
const COMPLETION_RETRY_BASE_MS = 200;

/**
 * Tope de contexto ACUMULADO de una receta, en caracteres. El historial conversacional crece paso a
 * paso (el user + el assistant de cada paso); si al armar un paso el historial supera este tope,
 * cortamos la receta con un fallo claro en vez de mandarle al modelo un historial gigante. Es un CORTE
 * DE SEGURIDAD, no un resumen (Camino A: sin over-engineering). Espeja el presupuesto del cuerpo del
 * backend (AGENT_LIMITS.maxTotalContentChars, ~50k tokens); se define LOCAL a proposito para no
 * importar runtime del backend (este modulo se testea sin cargar sus SDK de proveedor).
 */
const RECIPE_MAX_CONTEXT_CHARS = 200_000;

// Clases de error movidas a errores.ts (modulo sin dependencias) para que sitios.ts las comparta sin
// un ciclo de imports con este modulo. Se RE-EXPORTAN aca: la superficie publica no cambia.
import { PermanentExecutionError, RunTimeoutError, ShutdownAbortError } from './errores.js';
export { PermanentExecutionError, RunTimeoutError, ShutdownAbortError };

/** Subconjunto del JobsRepository que la ejecucion necesita (facil de mockear en tests). */
export interface JobQueue {
  claimNextJob(): Promise<Job | null>;
  markCompleted(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  markPendingRetry(id: string, error: string, scheduledFor?: Date | string | null): Promise<void>;
  /** Latido: refresca updated_at si el job sigue 'running' y devuelve su status actual (o null). */
  latirJob(id: string): Promise<JobStatus | null>;
  /** Recupera jobs 'running' detenidos (sin latido por mas de staleMs). Lo usa el loop del worker. */
  reapOrphanedJobs(params: { staleMs: number; maxAttempts: number }): Promise<ReapedJob[]>;
}

/** Cortes y parametros del motor que el worker aplica al ejecutar un job. */
export interface ExecutionConfig {
  /** Deadline de pared del run, en ms (RUN_TIMEOUT_SECONDS * 1000). Lo aplica el worker, no runAgent. */
  runTimeoutMs: number;
  /** Deadline de pared de los jobs de tarea_web, en ms (TAREA_WEB_TIMEOUT_SECONDS * 1000). Solo lo
   *  consume el reaper para calibrar el umbral de huerfanos de ese tipo; el handler recibe el suyo
   *  via TareaWebDeps.runTimeoutMs. */
  tareaWebTimeoutMs: number;
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
  /**
   * Notifica por correo (best-effort) un fallo DEFINITIVO del job. Se invoca SOLO tras markFailed (fallo
   * permanente o reintentos agotados), NUNCA en un reintento ni en un apagado. La implementacion real
   * (Resend + cooldown + lectura del email del owner) vive en alertas.ts y se cablea en index.ts; en
   * tests es un vi.fn(). OPCIONAL: si no se cablea, no se notifica. La llamada ademas se envuelve en
   * try/catch (ver notifyDefinitiveFailure), asi una alerta jamas bloquea el cierre del job.
   */
  notifyJobFailure?: (job: Job, reason: string) => Promise<void>;
  /**
   * Persiste (best-effort) UNA fila en agent_runs por ejecucion autonoma -- el MISMO metodo
   * (AgentRunRepository.record) que usa la ruta sincrona -- para unificar ambas vias en una sola fuente
   * de verdad de ejecuciones. OPCIONAL: si no se cablea, el worker EJECUTA IGUAL (degrada sin telemetria,
   * no se cae). Un fallo de esta escritura NUNCA cambia el estado del job ni tumba el worker (ver
   * recordRunBestEffort). Se cablea en index.ts con el mismo cliente sql del worker; en tests es un vi.fn().
   */
  recordRun?: (run: AgentRunRecord) => Promise<void>;
  /**
   * Dependencias de los JOBS DE SITIOS CONECTADOS (7.1b): repositorio de 7.1a + puerto al proveedor
   * de navegador remoto + encadenado ARCO. OPCIONAL: index.ts lo cablea SOLO si BROWSERBASE_API_KEY
   * y BROWSERBASE_PROJECT_ID estan en el entorno; sin cablear, un job de sitio falla permanente con
   * mensaje claro (procesarJobDeSitio) y el resto del worker no cambia en nada.
   */
  sitios?: SitiosJobDeps;
  /**
   * Dependencias del JOB DE TAREA WEB (7.1d): navegacion por IA dentro de la sesion activa de un
   * sitio conectado. OPCIONAL con el mismo criterio que `sitios`: index.ts lo cablea SOLO si la
   * config de Browserbase esta completa; sin cablear, un job de tarea web falla permanente con
   * mensaje claro (procesarTareaWeb) y el resto del worker no cambia en nada.
   */
  tareaWeb?: TareaWebDeps;
  /**
   * Dependencias de los JOBS DE GRABACION DE TAREA (V036): la via COMPLEMENTARIA con la que el usuario
   * le ensena una tarea al sistema haciendola el mismo una vez. OPCIONAL con el mismo criterio que
   * `sitios`/`tareaWeb`: sin la config de Browserbase, un job de grabacion falla permanente con
   * mensaje claro y el resto del worker no cambia en nada.
   */
  grabacion?: GrabacionDeps;
  /**
   * Dependencias del job que GUARDA COMO TAREA APRENDIDA una tarea web exitosa (promocion
   * trayectoria -> receta con consentimiento). No necesita navegador ni modelo (es lectura de V030 y
   * escritura de V035), asi que index.ts lo cablea SIEMPRE, sin la compuerta de Browserbase.
   */
  promocionTrayectoria?: PromocionTrayectoriaDeps;
  /**
   * Dependencias del BARRIDO de aprobaciones vencidas (7.1e): expira los checkpoints sin decision,
   * cierra su sesion de navegador (que se mantuvo VIVA mientras estuvo pendiente) y cierra el job
   * pausado. OPCIONAL con el mismo criterio que `sitios`/`tareaWeb`: se cablea solo con la config
   * de Browserbase completa; sin cablear, no corre.
   */
  barridoAprobaciones?: BarridoAprobacionesDeps;
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

/** Espera `ms` milisegundos (para el backoff corto del reintento de cierre). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Persiste el CIERRE EXITOSO de un job (markCompleted) con REINTENTO + backoff CORTO. Endurece el cierre
 * contra la DOBLE EJECUCION del informe 06 (H1): el run ya ocurrio (proveedor llamado, tokens cobrados,
 * tools ejecutadas) ANTES de esta escritura; si markCompleted falla por un blip transitorio de red a
 * Postgres, sin reintento el job caeria al catch -> handleFailure -> markPendingRetry -> se RE-EJECUTA
 * (doble cobro/efectos). Reintentar aqui absorbe el blip y evita ese camino en el caso comun.
 *
 * HONESTIDAD DE DISENO (at-least-once, NO exactly-once): esto REDUCE la probabilidad de doble ejecucion,
 * no la elimina. Si markCompleted sigue fallando tras agotar los reintentos (Postgres realmente caido),
 * se PROPAGA el error a proposito: handleFailure devuelve el job a 'pending' y se re-ejecutara -- residual
 * ACEPTADO del modelo de entrega. La unica defensa COMPLETA es la idempotencia de los efectos colaterales
 * (claves de idempotencia en las tools que escriben / dedupe por job id) o un checkpoint por paso de
 * receta; ambos son un cambio grande y quedan FUERA de alcance de este fix (ver README / PR).
 */
async function markCompletedWithRetry(deps: JobRunnerDeps, jobId: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= COMPLETION_RETRY_ATTEMPTS; attempt++) {
    try {
      await deps.jobs.markCompleted(jobId);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < COMPLETION_RETRY_ATTEMPTS) {
        const nextRetryMs = COMPLETION_RETRY_BASE_MS * attempt;
        deps.logger.warn('fallo transitorio al marcar el job completado; reintentando el cierre', {
          jobId,
          attempt,
          maxAttempts: COMPLETION_RETRY_ATTEMPTS,
          nextRetryMs,
          err: describeError(error),
        });
        await sleep(nextRetryMs);
      }
    }
  }
  // Agotados los reintentos del cierre: el run YA ocurrio pero no pudimos persistir 'completed'. Se
  // propaga -> handleFailure devolvera el job a 'pending' y PUEDE re-ejecutarse (residual at-least-once).
  deps.logger.error(
    'markCompleted fallo tras agotar los reintentos del cierre; el job volvera a pending y puede ' +
      're-ejecutarse (modelo at-least-once, ver nota de diseno)',
    { jobId, attempts: COMPLETION_RETRY_ATTEMPTS, err: describeError(lastError) },
  );
  throw lastError;
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
): Promise<{ stopReason: string; usage: TokenUsage; text: string }> {
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
  // Acumula el TEXTO generado por el agente (los text_delta) a lo largo de la corrida: es el OUTPUT del
  // paso, que la ejecucion de recetas encadena como historial (mensaje assistant) al paso siguiente. El
  // job simple lo ignora (mismo comportamiento observable: solo consume stopReason + usage).
  let text = '';
  try {
    for await (const event of deps.runAgent({ ...input, signal: controller.signal }, { executeTool })) {
      if (controller.signal.aborted) break;
      if (event.type === 'text_delta') text += event.text;
      if (event.type === 'stop') {
        stopReason = event.reason;
        usage = event.usage;
      }
    }
    // Un stop natural manda: si el run llego a emitir su stop final, TERMINO ok aunque el abort por
    // timeout/apagado se haya disparado en el mismo instante (no re-encolar ni re-cobrar un run hecho).
    if (stopReason !== null) return { stopReason, usage, text };
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

// --- PERSISTENCIA DEL USAGE (telemetria de la ejecucion autonoma) ------------------------------------
// ADITIVO: al CERRAR un job (exito o fallo -- ambos consumieron tokens) el worker escribe UNA fila en
// agent_runs -- la MISMA tabla y el MISMO metodo (AgentRunRepository.record via deps.recordRun) que la
// ruta sincrona -- con owner+agente+modelo+proveedor+los 4 cubos de tokens (cache incluido)+stop+status+
// duration. NO cambia la logica de ejecucion/reintentos/claim: solo agrega el registro del resultado, y
// es BEST-EFFORT (un fallo al registrar jamas altera el estado del job ni tumba el worker).

/** Acumulador mutable de los 4 cubos de tokens de una ejecucion (input, output, cache_read, cache_write). */
interface MutableTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Suma el usage de una corrida al acumulador, INCLUYENDO los cubos de cache. El acumulador previo del
 * worker sumaba solo input/output y DESCARTABA cache (auditoria 08, H-04); esto los captura igual que el
 * camino sincrono. Un proveedor sin caching deja los cubos de cache ausentes -> se suman como 0.
 */
function addUsage(acc: MutableTokenUsage, usage: TokenUsage): void {
  acc.inputTokens += usage.inputTokens;
  acc.outputTokens += usage.outputTokens;
  acc.cacheReadTokens += usage.cacheReadTokens ?? 0;
  acc.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
}

/** Codigo corto para agent_runs.error_code: el `code` del error si lo trae (p.ej. ProviderError), si no su nombre. */
function errorCodeOf(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string' && code !== '') return code;
  }
  if (error instanceof Error) return error.name;
  return 'UNKNOWN';
}

/** Traduce el error de cierre de un job al (status, error_code) de agent_runs. */
function classifyFailure(error: unknown): { status: AgentRunRecord['status']; errorCode: string | null } {
  // Apagado del worker: la ejecucion se ABORTO (el job vuelve a 'pending' y se re-reclama). Sin error_code.
  if (error instanceof ShutdownAbortError) return { status: 'aborted', errorCode: null };
  if (error instanceof RunTimeoutError) return { status: 'error', errorCode: 'TIMEOUT' };
  if (error instanceof PermanentExecutionError) return { status: 'error', errorCode: 'PERMANENT' };
  return { status: 'error', errorCode: errorCodeOf(error) };
}

/** Arma la fila de agent_runs (AgentRunRecord) de una ejecucion, con el shape exacto que espera record(). */
function buildRunRecord(
  job: Job,
  // agentId viaja DENTRO de la atribucion (no de job.agentId, que es nullable desde V026): si hay
  // atribucion es que el agente se resolvio, y con el vino su id no-nulo.
  attribution: { agentId: string; providerId: string; model: string },
  usage: MutableTokenUsage,
  status: AgentRunRecord['status'],
  stopReason: string | null,
  errorCode: string | null,
  startedAt: number,
): AgentRunRecord {
  return {
    agentId: attribution.agentId,
    ownerId: job.ownerId,
    providerId: attribution.providerId,
    model: attribution.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    stopReason,
    status,
    errorCode,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Persiste (best-effort) la fila de agent_runs de una ejecucion. NUNCA lanza: si deps.recordRun no esta
 * cableado es un NO-OP (el worker degrada sin telemetria) y si la escritura falla (error de DB) se loguea
 * y se sigue -- el estado real del job ya lo fijaron markCompleted/handleFailure. La persistencia del run
 * es un efecto secundario, no parte del exito del job.
 */
async function recordRunBestEffort(deps: JobRunnerDeps, run: AgentRunRecord): Promise<void> {
  if (!deps.recordRun) return;
  try {
    await deps.recordRun(run);
  } catch (error) {
    deps.logger.error('fallo al registrar el usage de la ejecucion en agent_runs (se ignora, best-effort)', {
      agentId: run.agentId,
      status: run.status,
      err: describeError(error),
    });
  }
}

/**
 * LATIDO del job en ejecucion (CAMBIO 1 + CAMBIO 3): mientras el job esta 'running', refresca
 * updated_at cada HEARTBEAT_INTERVAL_MS y RELEE su status en la misma pasada. Best-effort: un fallo
 * de escritura se loguea y se reintenta al siguiente intervalo; JAMAS se aborta el job por un fallo
 * de latido. Si el status dejo de ser 'running':
 *  - 'pausado' (checkpoint de aprobacion): el latido se detiene en silencio (un pausado NO late; lo
 *    protege su propio TTL de aprobacion, no el reaper).
 *  - cualquier otro (tipicamente 'failed' por cancelarPorUsuario desde la consola): se invoca
 *    alCancelar para abortar la corrida SIN escribir el cierre encima del estado nuevo.
 * Devuelve la funcion que detiene el latido; llamarla SIEMPRE al terminar la corrida.
 */
function iniciarLatido(deps: JobRunnerDeps, jobId: string, alCancelar: () => void): () => void {
  let detenido = false;
  let enVuelo = false;
  const timer = setInterval(() => {
    if (enVuelo) return; // un latido lento no se encima con el siguiente
    enVuelo = true;
    void (async () => {
      try {
        const status = await deps.jobs.latirJob(jobId);
        if (detenido || status === 'running') return;
        detenido = true;
        clearInterval(timer);
        if (status === 'pausado') return;
        deps.logger.warn('el job dejo de estar running a mitad de la corrida; se aborta sin escribir el cierre', {
          jobId,
          status,
        });
        alCancelar();
      } catch (error) {
        deps.logger.warn('no se pudo escribir el latido del job (se reintenta en el proximo intervalo)', {
          jobId,
          err: describeError(error),
        });
      } finally {
        enVuelo = false;
      }
    })();
  }, HEARTBEAT_INTERVAL_MS);
  return () => {
    detenido = true;
    clearInterval(timer);
  };
}

/**
 * Une el APAGADO del worker y la CANCELACION del job en UNA senal para el motor (cualquiera aborta
 * la corrida). Devuelve tambien la limpieza de listeners: la senal de apagado vive lo que el proceso
 * y acumularia un listener por job procesado si no se removiera al cerrar cada corrida.
 */
function combinarSenales(
  apagado: AbortSignal | undefined,
  cancelacion: AbortSignal,
): { senal: AbortSignal; limpiar: () => void } {
  if (!apagado) return { senal: cancelacion, limpiar: () => {} };
  const controller = new AbortController();
  if (apagado.aborted || cancelacion.aborted) {
    controller.abort();
    return { senal: controller.signal, limpiar: () => {} };
  }
  const abortar = (): void => controller.abort();
  apagado.addEventListener('abort', abortar, { once: true });
  cancelacion.addEventListener('abort', abortar, { once: true });
  return {
    senal: controller.signal,
    limpiar: () => {
      apagado.removeEventListener('abort', abortar);
      cancelacion.removeEventListener('abort', abortar);
    },
  };
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
  // Estado de la ejecucion para PERSISTIR el run en agent_runs al cerrar (best-effort, ver
  // recordRunBestEffort). Se puebla a medida que avanza el job: `usage` acumula los 4 cubos de tokens
  // (cache incluido) -- para una receta, la SUMA de todos los pasos, disponible aun si un paso posterior
  // falla. `attribution` (provider/model del agente) queda null en un fallo TEMPRANO (antes de resolver
  // el agente): sin provider/model no se escribe fila (agent_runs los exige NOT NULL, ademas de agent_id
  // valido). Nada de esto cambia la ejecucion: solo se AGREGA la escritura del resultado.
  const startedAt = Date.now();
  const usage: MutableTokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let attribution: { agentId: string; providerId: string; model: string } | null = null;
  let stopReason: string | null = null;
  // CANCELACION COOPERATIVA (CAMBIO 3): toda la corrida late (iniciarLatido) y, si el status del job
  // deja de ser 'running' (cancelado desde la consola, o re-transicionado por otro actor), se aborta
  // via este controller. El corte llega al motor por la senal combinada (simple/receta) o por el
  // signal propio de la tarea web; el catch de abajo detecta la cancelacion y NO escribe el cierre.
  const cancelacion = new AbortController();
  // Sesion de navegador ACTIVA de la corrida de tarea web (si la hay). Es la referencia del CORTE
  // DURO (D4): si el abort no detiene al motor a mitad de un paso, cerrar la sesion de Browserbase
  // si lo hace, y ademas garantiza que no quede una sesion viva sin job que la respalde.
  const sesionEnCurso: { id: string | null } = { id: null };
  const detenerLatido = iniciarLatido(deps, job.id, () => {
    cancelacion.abort();
    const sesionId = sesionEnCurso.id;
    if (sesionId !== null && deps.tareaWeb) {
      void deps.tareaWeb.navegador.cerrarSesion(sesionId).catch((error: unknown) => {
        logger.warn('no se pudo cerrar la sesion de navegador en el corte duro (se ignora, best-effort)', {
          jobId: job.id,
          err: describeError(error),
        });
      });
    }
  });
  const { senal, limpiar } = combinarSenales(shutdownSignal, cancelacion.signal);
  try {
    // 1. GATE POR TIER (server-side, antes de gastar nada): la ejecucion autonoma es premium. La
    //    capacidad se deriva del modulo central de planes (tierAllowsAutonomy): un owner cuyo plan no
    //    incluye autonomia no debe seguir corriendo jobs -> fallo permanente, no transitorio.
    const tier = await deps.getProfileTier(job.ownerId);
    if (!tierAllowsAutonomy(tier)) {
      throw new PermanentExecutionError('autonomous execution requires a plan with autonomy');
    }

    // 1.5. RAMIFICAR los jobs de SITIOS CONECTADOS (7.1b) ANTES de tocar agente/credencial/motor:
    //      estos jobs no ejecutan ningun modelo (hay un humano manejando el navegador) y no tienen
    //      agente ni credencial que resolver. El gate por tier de arriba SI aplica (la conexion de
    //      sitios es parte de la suite autonoma). La discriminacion por payload.kind es inequivoca,
    //      igual que la de recetas. procesarJobDeSitio lanza en fallo (handleFailure decide
    //      reintento/permanente como con cualquier job); sin telemetria de agent_runs: no hay
    //      provider/model ni tokens que registrar.
    if (isSitioJobPayload(job.payload)) {
      await procesarJobDeSitio(deps.sitios, job);
      await markCompletedWithRetry(deps, job.id);
      logger.info('job de sitio conectado completado', { jobId: job.id });
      return;
    }

    // 1.6. RAMIFICAR el job de TAREA WEB (7.1d) con el mismo criterio que los de sitios: aca SI corre
    //      un modelo (Stagehand), pero con su PROPIA credencial resuelta adentro (la del job, via
    //      deps.tareaWeb.resolveCredential) y su propio deadline; no pasa por agente/assemble. El
    //      gate por tier de arriba SI aplica. procesarTareaWeb lanza en fallo; TODOS sus fallos
    //      posteriores a abrir la sesion son PERMANENTES (no se re-ejecuta una navegacion a medias
    //      sobre la cuenta real del usuario), asi que handleFailure no los reintenta.
    if (isTareaWebJobPayload(job.payload)) {
      // Solo la senal de CANCELACION (no la de apagado) llega al motor de la tarea web: un apagado
      // del worker conserva su semantica actual (no aborta una navegacion a medias sobre la cuenta
      // real; el latido/reaper la recogen). alCambiarSesion mantiene la referencia del corte duro.
      const resultado = await procesarTareaWeb(deps.tareaWeb, job, {
        signal: cancelacion.signal,
        alCambiarSesion: (sesionExternaId) => {
          sesionEnCurso.id = sesionExternaId;
        },
      });
      if (resultado === 'pausada') {
        // Checkpoint de aprobacion humana (7.1e): el handler YA dejo el job 'pausado' (y la sesion
        // de navegador VIVA). No se marca completado: el job vuelve a 'pending' cuando el humano
        // decide, o a 'failed' si la aprobacion expira (barrido de aprobaciones vencidas).
        logger.info('job de tarea web pausado en checkpoint de aprobacion humana', { jobId: job.id });
        return;
      }
      await markCompletedWithRetry(deps, job.id);
      logger.info('job de tarea web completado', { jobId: job.id });
      return;
    }

    // 1.65. RAMIFICAR los jobs de GRABACION DE TAREA (V036) con el mismo criterio que los de sitios:
    //       tampoco ejecutan ningun modelo (hay un humano haciendo la tarea en la vista en vivo) ni
    //       tienen agente ni credencial que resolver. El gate por tier de arriba SI aplica. La senal de
    //       CANCELACION llega al handler para que terminar la tarea desde la consola corte la
    //       grabacion; alCambiarSesion mantiene la referencia del corte duro, igual que la tarea web.
    if (isGrabacionJobPayload(job.payload)) {
      await procesarJobDeGrabacion(deps.grabacion, job, {
        signal: cancelacion.signal,
        alCambiarSesion: (sesionExternaId) => {
          sesionEnCurso.id = sesionExternaId;
        },
      });
      await markCompletedWithRetry(deps, job.id);
      logger.info('job de grabacion de tarea completado', { jobId: job.id });
      return;
    }

    // 1.66. RAMIFICAR el job de GUARDAR COMO TAREA APRENDIDA (promocion trayectoria -> receta con
    //       consentimiento) con el mismo criterio: sin agente, sin credencial, sin modelo y sin
    //       navegador (lectura de V030, escritura de V035). El gate por tier de arriba SI aplica.
    if (isPromoverTrayectoriaJobPayload(job.payload)) {
      await procesarJobDePromoverTrayectoria(deps.promocionTrayectoria, job);
      await markCompletedWithRetry(deps, job.id);
      logger.info('job de promocion de trayectoria completado', { jobId: job.id });
      return;
    }

    // 1.7. DEFENSA post-V026: agent_id/credential_id son nullables SOLO para los jobs de sitios (ya
    //      ramificados y retornados arriba). Un job simple/receta sin ellos es un dato corrupto que
    //      jamas podra ejecutar -> fallo permanente con mensaje claro, sin tocar el motor.
    const { agentId, credentialId } = job;
    if (agentId === null || credentialId === null) {
      throw new PermanentExecutionError(
        'job sin agente o credencial: solo los jobs de sitios conectados pueden omitirlos',
      );
    }

    // 2. Cargar el agente (config autoritativa: provider/model/tools/...).
    const agent = await deps.loadAgent(agentId);
    if (!agent) {
      throw new Error(`agente ${agentId} no encontrado`);
    }
    // Atribucion del run (agente + provider/model) para agent_runs: disponible desde aca (tras resolver
    // el agente) para el cierre exitoso Y para un fallo posterior (ambos consumieron tokens del agente).
    attribution = { agentId, providerId: agent.providerId, model: agent.model };

    // 3. Resolver la credencial de la boveda por owner + credential (descifra server-side).
    const credential = await deps.resolveCredential(job.ownerId, credentialId);

    // 4. Defensa: una credencial guardada solo sirve contra un agente del MISMO proveedor (igual que la
    //    ruta /v1/run/:agentId). Sin esto la key de un proveedor iria al endpoint de otro.
    if (credential.providerId !== agent.providerId) {
      throw new Error(
        `la credencial es de ${credential.providerId} pero el agente usa ${agent.providerId}`,
      );
    }

    // 5. RAMIFICAR simple vs receta. El gate/carga/resolucion/match de proveedor de arriba corren UNA
    //    vez para AMBOS tipos. Un job de RECETA (payload con kind:'recipe', via el validador de 5.5a)
    //    ejecuta N pasos EN SECUENCIA dentro del mismo job (encadenando el output de cada paso como
    //    historial). Un job SIMPLE (sin kind:'recipe') sigue el camino de siempre, INTACTO. La deteccion
    //    es INEQUIVOCA: un job simple nunca entra al bucle, uno de receta nunca al camino simple.
    if (isRecipeJobPayload(job.payload)) {
      // La receta acumula el usage de TODOS sus pasos en `usage` (un run por job, no por paso) y devuelve
      // el stopReason del ultimo paso; su cierre (markCompleted) ya ocurrio dentro de runRecipeJob.
      stopReason = await runRecipeJob(deps, job, agent, credential, usage, senal);
      // TELEMETRIA (best-effort): UN agent_run por job de receta con el usage AGREGADO de los N pasos.
      await recordRunBestEffort(
        deps,
        buildRunRecord(job, attribution, usage, 'completed', stopReason, null, startedAt),
      );
      return;
    }

    // 6. Mensajes del payload -> NormalizedMessage[] (CAMINO SIMPLE, sin cambios).
    const { messages, maxIterations } = parsePayloadMessages(job.payload);

    // 7. Ensamblar el run (executeTool + AgentRunInput) con el motor reutilizable, sin HTTP.
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

    // 8. Ejecutar con el deadline de pared propio del worker.
    const result = await runAgentWithDeadline(deps, input, executeTool, senal);
    stopReason = result.stopReason;
    // Captura los 4 cubos de tokens (cache incluido) del resultado -- el camino sincrono ya los tiene.
    addUsage(usage, result.usage);

    await markCompletedWithRetry(deps, job.id);
    logger.info('job completado', {
      jobId: job.id,
      agentId: job.agentId,
      stopReason,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    // TELEMETRIA (best-effort): un agent_run por ejecucion simple exitosa, con los 4 cubos de tokens.
    await recordRunBestEffort(
      deps,
      buildRunRecord(job, attribution, usage, 'completed', stopReason, null, startedAt),
    );
  } catch (error) {
    // LA CORRIDA YA TERMINO: se detiene el latido ANTES de escribir el cierre. El latido existe para
    // detectar que un job dejo de estar 'running' MIENTRAS corre (una cancelacion desde la consola);
    // si sigue vivo mientras handleFailure escribe 'failed', lee el estado que acabamos de escribir
    // NOSOTROS y lo trata como una cancelacion externa: aborta la corrida y cierra la sesion de
    // navegador de una tarea que ya no existe. Eso fue lo que convirtio un bloqueo de la guardia (un
    // desenlace normal del sistema) en una corrida abortada a mitad de camino. Detenerlo aqui corta
    // ese encadenamiento: el estado que este bloque escribe no puede cancelarse a si mismo.
    detenerLatido();
    // CANCELACION (CAMBIO 3): el estado nuevo ('failed' + CANCELADO_POR_USUARIO, o el que haya
    // puesto otro actor) YA esta escrito por quien cancelo; aqui la corrida solo se termina, SIN
    // escribir ningun cierre encima (los mark* igual tienen CAS sobre 'running', doble red). La
    // senal ya esta marcada cuando el error llega hasta aca, asi que detener el latido arriba no
    // puede ocultar una cancelacion real.
    if (cancelacion.signal.aborted) {
      logger.info('corrida abortada: el job fue cancelado mientras corria; no se escribe el cierre', {
        jobId: job.id,
      });
      return;
    }
    await handleFailure(deps, job, error);
    // TELEMETRIA (best-effort): la ejecucion FALLIDA tambien consumio tokens (los ya acumulados: 0 en un
    // fallo simple sin stop, o la suma de los pasos ya corridos en una receta). Solo se registra si hubo
    // atribucion (agente resuelto); un fallo temprano (gate/carga/credencial) no tiene provider/model ni
    // agent_id valido y no puede escribir una fila. Va DESPUES de handleFailure: el estado del job ya
    // quedo fijado por su ejecucion real; este registro es un efecto secundario que no lo altera.
    if (attribution) {
      const { status, errorCode } = classifyFailure(error);
      await recordRunBestEffort(
        deps,
        buildRunRecord(job, attribution, usage, status, stopReason, errorCode, startedAt),
      );
    }
  } finally {
    detenerLatido();
    limpiar();
  }
}

/** Construye un NormalizedMessage de un solo bloque de texto para el rol dado (user / assistant). */
function textMessage(role: NormalizedMessage['role'], text: string): NormalizedMessage {
  return { role, content: [{ type: 'text', text }] };
}

/** Suma los caracteres de todo el texto de un historial (para el corte de contexto acumulado). */
function totalContentChars(messages: NormalizedMessage[]): number {
  let total = 0;
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') total += block.text.length;
    }
  }
  return total;
}

/**
 * Ejecuta un job de RECETA: un flujo LINEAL de N pasos DENTRO del mismo job (Camino A, sin checkpoint).
 * Cada paso corre el MISMO agente/credencial con su PROPIO deadline y cap (una corrida de runAgent por
 * paso, no comparten presupuesto), captura el OUTPUT de texto y lo inyecta como HISTORIAL
 * CONVERSACIONAL (un mensaje assistant) en el paso siguiente, de modo que el paso i+1 ve toda la
 * conversacion previa. El job ENTERO es la unidad de reintento: si un paso falla, se PROPAGA el error
 * -> handleFailure lo reintenta / marca failed y, al re-reclamarse, la receta re-corre DESDE EL PASO 1
 * (el last_error indica en que paso fallo, para diagnostico). Al completar TODOS los pasos:
 * markCompleted. Corre DENTRO del try de processClaimedJob, asi que un job de receta roto no tumba el
 * worker (lo cierra handleFailure como cualquier otro).
 */
async function runRecipeJob(
  deps: JobRunnerDeps,
  job: Job,
  agent: AgentConfig,
  credential: DecryptedProviderCredential,
  // Acumulador COMPARTIDO con processClaimedJob: la receta suma aca el usage de cada paso (los 4 cubos,
  // cache incluido). Se comparte para que, si un paso falla, el usage ya consumido siga disponible para
  // registrar el run fallido. Devuelve el stopReason del ULTIMO paso corrido.
  usage: MutableTokenUsage,
  shutdownSignal?: AbortSignal,
): Promise<string | null> {
  const { logger } = deps;

  // Validar COMPLETAMENTE el snapshot embebido en el payload (kind ya es 'recipe'; falta la forma). Un
  // payload de receta malformado es un fallo del intento (transitorio), como un payload simple invalido.
  const parsed = parseRecipeJobPayload(job.payload);
  if (!parsed.success) {
    throw new Error(`payload de receta invalido: ${parsed.error}`);
  }
  const steps: RecipeStepPayload[] = parsed.data.steps;
  const totalSteps = steps.length;

  // Historial conversacional que se ACUMULA entre pasos. Arranca vacio; el paso 1 solo lleva su user.
  const history: NormalizedMessage[] = [];
  // stopReason del ultimo paso corrido: es el que atribuye la fila de agent_runs del job de receta.
  let lastStopReason: string | null = null;

  for (let i = 0; i < totalSteps; i++) {
    const stepNumber = i + 1;
    const step = steps[i];
    if (step === undefined) continue; // inalcanzable (i < totalSteps); satisface noUncheckedIndexedAccess.

    // Apagado ENTRE pasos: no arrancar un paso nuevo si ya llego la senal. Devuelve el job a 'pending'
    // (re-reclamable) sin dejarlo running huerfano; al re-reclamarse re-corre desde el paso 1.
    if (shutdownSignal?.aborted) throw new ShutdownAbortError();

    // Mensajes de ESTE paso: el historial acumulado + la instruccion (user) del paso actual.
    const messages: NormalizedMessage[] = [...history, textMessage('user', step.message)];

    // Corte de seguridad de contexto: si el historial acumulado supera el tope, cortar la receta con un
    // fallo claro (indicando el paso) en vez de mandar un historial gigante al modelo.
    const chars = totalContentChars(messages);
    if (chars > RECIPE_MAX_CONTEXT_CHARS) {
      throw new Error(
        `la receta excedio el limite de contexto acumulado en el paso ${stepNumber} de ${totalSteps}: ` +
          `${chars} caracteres supera el tope de ${RECIPE_MAX_CONTEXT_CHARS}`,
      );
    }

    // Ensamblar el run de ESTE paso: MISMO agente/credencial, su propio deadline/cap (por corrida).
    const { input, executeTool } = deps.assembleAgentRun({
      agent,
      credential: { apiKey: credential.apiKey, baseUrl: credential.baseUrl },
      messages,
      nativeTools: {
        ...(deps.config.webWorkerUrl !== undefined ? { workerUrl: deps.config.webWorkerUrl } : {}),
        ...(deps.config.webWorkerSecret !== undefined ? { workerSecret: deps.config.webWorkerSecret } : {}),
      },
      limits: { maxTokens: deps.config.runMaxTokens, runTimeoutMs: deps.config.runTimeoutMs },
      warn: (message) =>
        logger.warn('aviso al ensamblar el run', { jobId: job.id, step: stepNumber, message }),
    });

    let stepResult: { stopReason: string; usage: TokenUsage; text: string };
    try {
      stepResult = await runAgentWithDeadline(deps, input, executeTool, shutdownSignal);
    } catch (error) {
      // El apagado se PROPAGA tal cual (route a re-pending, no gasta el intento como permanente).
      // Cualquier otro fallo (timeout, error de proveedor, excepcion) hace fallar el JOB ENTERO, con el
      // numero de paso en el last_error para diagnostico (el reintento igual re-corre desde el paso 1).
      if (error instanceof ShutdownAbortError) throw error;
      throw new Error(`fallo en el paso ${stepNumber} de ${totalSteps}: ${describeError(error)}`, {
        cause: error,
      });
    }

    // Un stop 'error' del proveedor tambien es un fallo del paso: encadenar un output erroneo es peor.
    if (stepResult.stopReason === 'error') {
      throw new Error(`fallo en el paso ${stepNumber} de ${totalSteps}: el run termino con stop 'error'`);
    }

    // Acumular el usage del paso INCLUYENDO cache (antes solo se sumaba input/output; auditoria 08 H-04).
    addUsage(usage, stepResult.usage);
    lastStopReason = stepResult.stopReason;

    // Exito del paso: agregar al historial la instruccion (user) Y el OUTPUT (assistant) para que el
    // paso i+1 vea la conversacion previa (encadenamiento conversacional).
    history.push(textMessage('user', step.message));
    history.push(textMessage('assistant', stepResult.text));

    logger.info('paso de receta completado', {
      jobId: job.id,
      recipeId: parsed.data.recipeId,
      step: stepNumber,
      totalSteps,
      stopReason: stepResult.stopReason,
    });
  }

  await markCompletedWithRetry(deps, job.id);
  logger.info('receta completada', {
    jobId: job.id,
    agentId: job.agentId,
    recipeId: parsed.data.recipeId,
    steps: totalSteps,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
  return lastStopReason;
}

/**
 * Dispara la alerta de fallo DEFINITIVO (best-effort). Se llama SOLO tras markFailed. NUNCA lanza: un
 * fallo del envio (Resend caido, sin config, sin email del owner) se traga aca para no bloquear el
 * cierre del job ni el loop del worker. La deduplicacion/cooldown y el envio real viven en la
 * implementacion inyectada (alertas.ts). Si no se cablea notifyJobFailure, es un no-op.
 */
async function notifyDefinitiveFailure(deps: JobRunnerDeps, job: Job, reason: string): Promise<void> {
  if (!deps.notifyJobFailure) return;
  try {
    await deps.notifyJobFailure(job, reason);
  } catch (error) {
    deps.logger.error('fallo al notificar el fallo definitivo del job (se ignora, best-effort)', {
      jobId: job.id,
      err: error instanceof Error ? error.message : 'desconocido',
    });
  }
}

/** Decide el cierre de un job que fallo: permanente / apagado / transitorio (reintento o definitivo). */
async function handleFailure(deps: JobRunnerDeps, job: Job, error: unknown): Promise<void> {
  const { logger } = deps;
  const reason = describeError(error);

  // Apagado del worker: no es culpa del job. Vuelve a 'pending' para re-reclamar, sin gastar el intento
  // como fallo permanente (incluso si ya agoto attempts: el corte fue externo). NO se notifica (no es
  // un fallo definitivo: el job se re-reclama).
  if (error instanceof ShutdownAbortError) {
    await deps.jobs.markPendingRetry(job.id, reason, null);
    logger.info('job devuelto a pending por apagado del worker', { jobId: job.id, attempts: job.attempts });
    return;
  }

  // Fallo PERMANENTE (tier insuficiente): no se reintenta, va directo a 'failed'. Fallo DEFINITIVO -> se
  // notifica al owner tras markFailed.
  if (error instanceof PermanentExecutionError) {
    await deps.jobs.markFailed(job.id, reason);
    logger.warn('job fallido permanente (sin reintento)', {
      jobId: job.id,
      attempts: job.attempts,
      reason,
    });
    await notifyDefinitiveFailure(deps, job, reason);
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
    // Fallo DEFINITIVO (reintentos agotados) -> se notifica al owner tras markFailed.
    await notifyDefinitiveFailure(deps, job, reason);
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
