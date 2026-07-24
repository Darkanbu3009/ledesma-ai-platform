import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AgentEvent, Job, TokenUsage } from '@ledesma-platform/shared';
import type {
  AgentConfig,
  AgentRunInput,
  AgentRunRecord,
  DecryptedProviderCredential,
} from '@ledesma-platform/backend/execution';
import { processClaimedJob, type JobRunnerDeps } from '../src/execution.js';
import type { Logger } from '../src/logger.js';

// Tests de la PERSISTENCIA del usage de ejecuciones autonomas en agent_runs (feat/captura-usage-worker).
// Todo mockeado: CI nunca llama al modelo. Verifican que el worker escribe UNA fila por ejecucion (mismo
// metodo que la ruta sincrona), con los 4 cubos de tokens (cache incluido), y que la escritura es
// best-effort (un fallo no cambia el estado del job ni tumba el worker), sin regresion de la ejecucion.

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    agentId: 'agent-1',
    ownerId: 'user-1',
    credentialId: 'cred-1',
    status: 'running',
    payload: { messages: [{ role: 'user', content: 'hola' }] },
    scheduledFor: null,
    attempts: 1,
    lastError: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    startedAt: '2026-06-30T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

const FAKE_AGENT = { id: 'agent-1', providerId: 'anthropic', model: 'claude-x', tools: [] } as unknown as AgentConfig;
const FAKE_CRED: DecryptedProviderCredential = { apiKey: 'sk-secreta', providerId: 'anthropic', baseUrl: null };

/** runAgent mock que termina OK con un stop natural cargando el `usage` dado (por defecto sin cache). */
function successRun(usage: TokenUsage = { inputTokens: 10, outputTokens: 5 }): JobRunnerDeps['runAgent'] {
  return vi.fn(() =>
    (async function* (): AsyncIterable<AgentEvent> {
      yield { type: 'text_delta', text: 'ok' };
      yield { type: 'stop', reason: 'end_turn', usage };
    })(),
  );
}

/** runAgent mock que LANZA el error dado al iterarse (sin emitir stop): simula un fallo de proveedor. */
function throwingRun(err: unknown): JobRunnerDeps['runAgent'] {
  return vi.fn(() =>
    // eslint-disable-next-line require-yield
    (async function* (): AsyncGenerator<AgentEvent> {
      throw err;
    })(),
  );
}

/** runAgent mock con una corrida DISTINTA por paso (para recetas); cada una cierra con su `usage`. */
function runAgentSequence(specs: Array<{ usage?: TokenUsage; throws?: unknown }>): JobRunnerDeps['runAgent'] {
  let call = 0;
  return vi.fn(() => {
    const spec = specs[call] ?? {};
    call += 1;
    return (async function* (): AsyncGenerator<AgentEvent> {
      if (spec.throws !== undefined) throw spec.throws;
      yield { type: 'text_delta', text: `paso-${call}` };
      yield { type: 'stop', reason: 'end_turn', usage: spec.usage ?? { inputTokens: 2, outputTokens: 3 } };
    })();
  });
}

/** Payload de un job de RECETA (kind:'recipe') con un paso por instruccion. */
function recipePayload(messages: string[]): unknown {
  return { kind: 'recipe', recipeId: 'receta-1', steps: messages.map((message) => ({ message })) };
}

function makeDeps(overrides: Partial<JobRunnerDeps> = {}): JobRunnerDeps {
  return {
    jobs: {
      claimNextJob: vi.fn(async () => null),
      markCompleted: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
      markPendingRetry: vi.fn(async () => {}),
      reapOrphanedJobs: vi.fn(async () => []),
    },
    getProfileTier: vi.fn(async () => 'autonomous' as const),
    loadAgent: vi.fn(async () => FAKE_AGENT),
    resolveCredential: vi.fn(async () => FAKE_CRED),
    assembleAgentRun: vi.fn(() => ({
      input: { providerId: 'anthropic', credentials: { apiKey: 'sk-secreta' }, request: {} } as unknown as AgentRunInput,
      executeTool: vi.fn(),
    })),
    runAgent: successRun(),
    logger: makeLogger(),
    config: { runTimeoutMs: 600_000, tareaWebTimeoutMs: 1_500_000, runMaxTokens: 1_000_000 },
    notifyJobFailure: vi.fn(async () => {}),
    recordRun: vi.fn(async () => {}),
    ...overrides,
  };
}

/** Ultimo AgentRunRecord con el que se llamo a recordRun. */
function lastRun(recordRun: unknown): AgentRunRecord {
  const calls = (recordRun as { mock: { calls: AgentRunRecord[][] } }).mock.calls;
  const last = calls[calls.length - 1];
  const record = last?.[0];
  if (!record) throw new Error('recordRun no fue llamado');
  return record;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('persistencia del usage en agent_runs (ejecucion autonoma)', () => {
  it('job simple exitoso -> recordRun con owner/agente/modelo/proveedor/tokens/stop/status/duration', async () => {
    const recordRun = vi.fn(async () => {});
    const deps = makeDeps({ recordRun, runAgent: successRun({ inputTokens: 10, outputTokens: 5 }) });

    await processClaimedJob(deps, makeJob());

    expect(deps.jobs.markCompleted).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledTimes(1);
    const run = lastRun(recordRun);
    expect(run.agentId).toBe('agent-1');
    expect(run.ownerId).toBe('user-1');
    expect(run.providerId).toBe('anthropic');
    expect(run.model).toBe('claude-x');
    expect(run.inputTokens).toBe(10);
    expect(run.outputTokens).toBe(5);
    expect(run.status).toBe('completed');
    expect(run.stopReason).toBe('end_turn');
    expect(run.errorCode).toBeNull();
    expect(typeof run.durationMs).toBe('number');
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('incluye los 4 cubos de tokens: los de CACHE (no solo input/output)', async () => {
    const recordRun = vi.fn(async () => {});
    const deps = makeDeps({
      recordRun,
      runAgent: successRun({ inputTokens: 10, outputTokens: 5, cacheWriteTokens: 7, cacheReadTokens: 3 }),
    });

    await processClaimedJob(deps, makeJob());

    const run = lastRun(recordRun);
    expect(run.cacheReadTokens).toBe(3);
    expect(run.cacheWriteTokens).toBe(7);
    expect(run.inputTokens).toBe(10);
    expect(run.outputTokens).toBe(5);
  });

  it('job fallido -> recordRun con status error + error_code (la ejecucion consumio tokens igual)', async () => {
    const recordRun = vi.fn(async () => {});
    const err = Object.assign(new Error('rate limited'), { code: 'RATE_LIMIT' });
    const deps = makeDeps({ recordRun, runAgent: throwingRun(err) });

    await processClaimedJob(deps, makeJob({ attempts: 1 }));

    // El job conserva su estado real: fallo transitorio con reintentos -> markPendingRetry (no completed).
    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(deps.jobs.markCompleted).not.toHaveBeenCalled();
    // Y ademas se registro la corrida fallida.
    expect(recordRun).toHaveBeenCalledTimes(1);
    const run = lastRun(recordRun);
    expect(run.status).toBe('error');
    expect(run.errorCode).toBe('RATE_LIMIT');
    expect(run.providerId).toBe('anthropic');
    expect(run.model).toBe('claude-x');
  });

  it('fallo TEMPRANO (tier no autonomous, agente sin resolver) -> NO se registra corrida', async () => {
    const recordRun = vi.fn(async () => {});
    const deps = makeDeps({ recordRun, getProfileTier: vi.fn(async () => 'free' as const) });

    await processClaimedJob(deps, makeJob());

    expect(deps.jobs.markFailed).toHaveBeenCalledTimes(1);
    // Sin agente resuelto no hay provider/model ni agent_id valido: no se escribe fila (best-effort).
    expect(recordRun).not.toHaveBeenCalled();
  });

  it('receta -> UN agent_run con el usage AGREGADO de los N pasos (cache incluido)', async () => {
    const recordRun = vi.fn(async () => {});
    const perStep: TokenUsage = { inputTokens: 2, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 4 };
    const deps = makeDeps({
      recordRun,
      runAgent: runAgentSequence([{ usage: perStep }, { usage: perStep }, { usage: perStep }]),
    });

    await processClaimedJob(deps, makeJob({ payload: recipePayload(['a', 'b', 'c']) }));

    expect(deps.jobs.markCompleted).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledTimes(1);
    const run = lastRun(recordRun);
    expect(run.status).toBe('completed');
    expect(run.inputTokens).toBe(6); // 2 * 3 pasos
    expect(run.outputTokens).toBe(9); // 3 * 3 pasos
    expect(run.cacheReadTokens).toBe(3); // 1 * 3 pasos
    expect(run.cacheWriteTokens).toBe(12); // 4 * 3 pasos
  });

  it('receta que falla a mitad -> agent_run con status error y el usage PARCIAL ya consumido', async () => {
    const recordRun = vi.fn(async () => {});
    const deps = makeDeps({
      recordRun,
      runAgent: runAgentSequence([
        { usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 4 } }, // paso 1 OK
        { throws: new Error('boom en paso 2') }, // paso 2 falla
      ]),
    });

    await processClaimedJob(deps, makeJob({ payload: recipePayload(['a', 'b']), attempts: 1 }));

    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(deps.jobs.markCompleted).not.toHaveBeenCalled();
    expect(recordRun).toHaveBeenCalledTimes(1);
    const run = lastRun(recordRun);
    expect(run.status).toBe('error');
    expect(run.errorCode).not.toBeNull();
    // El usage del paso 1 (ya consumido) se conserva; el paso 2 no llego a acumular.
    expect(run.inputTokens).toBe(2);
    expect(run.outputTokens).toBe(3);
    expect(run.cacheReadTokens).toBe(1);
    expect(run.cacheWriteTokens).toBe(4);
  });

  it('best-effort: si recordRun LANZA, el job conserva su estado real y el worker NO se cae', async () => {
    const recordRun = vi.fn(async () => {
      throw new Error('db caida');
    });
    const deps = makeDeps({ recordRun });

    // No debe propagar: processClaimedJob traga el error de telemetria.
    await expect(processClaimedJob(deps, makeJob())).resolves.toBeUndefined();

    // El job se cerro con su estado real (completed) pese al fallo de la telemetria.
    expect(deps.jobs.markCompleted).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledTimes(1);
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it('no-regresion: sin recordRun cableado, el job se ejecuta y cierra igual (degrada sin telemetria)', async () => {
    const deps = makeDeps({ recordRun: undefined });

    await expect(processClaimedJob(deps, makeJob())).resolves.toBeUndefined();

    expect(deps.jobs.markCompleted).toHaveBeenCalledTimes(1);
  });
});
