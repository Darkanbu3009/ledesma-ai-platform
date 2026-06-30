import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AgentEvent, Job } from '@ledesma-platform/shared';
import type {
  AgentConfig,
  AgentRunInput,
  AssembleAgentRunParams,
  DecryptedProviderCredential,
} from '@ledesma-platform/backend/execution';
import {
  processClaimedJob,
  claimAndProcessOne,
  MAX_ATTEMPTS,
  type JobRunnerDeps,
} from '../src/execution.js';
import type { Logger } from '../src/logger.js';

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Args de una llamada al mock (tolerante a indices: noUncheckedIndexedAccess). */
function callArgs(fn: unknown, callIndex = 0): unknown[] {
  const calls = (fn as { mock: { calls: unknown[][] } }).mock.calls;
  return calls[callIndex] ?? [];
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

/** Generador que termina OK con un stop natural (exito). */
async function* successRun(): AsyncIterable<AgentEvent> {
  yield { type: 'text_delta', text: 'hola' };
  yield { type: 'stop', reason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } };
}

/** Generador que cuelga hasta que se aborta el signal (para probar el timeout de pared). */
function hangingRun(input: AgentRunInput): AsyncIterable<AgentEvent> {
  // Cuelga hasta el abort y termina SIN emitir eventos: por eso no tiene yield.
  // eslint-disable-next-line require-yield
  async function* gen(): AsyncGenerator<AgentEvent> {
    await new Promise<void>((resolve) => {
      const sig = input.signal;
      if (!sig || sig.aborted) return resolve();
      sig.addEventListener('abort', () => resolve(), { once: true });
    });
  }
  return gen();
}

function makeDeps(overrides: Partial<JobRunnerDeps> = {}): JobRunnerDeps {
  return {
    jobs: {
      claimNextJob: vi.fn(async () => null),
      markCompleted: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
      markPendingRetry: vi.fn(async () => {}),
    },
    getProfileTier: vi.fn(async () => 'autonomous' as const),
    loadAgent: vi.fn(async () => FAKE_AGENT),
    resolveCredential: vi.fn(async () => FAKE_CRED),
    assembleAgentRun: vi.fn(() => ({
      input: { providerId: 'anthropic', credentials: { apiKey: 'sk-secreta' }, request: {} } as unknown as AgentRunInput,
      executeTool: vi.fn(),
    })),
    runAgent: vi.fn(() => successRun()),
    logger: makeLogger(),
    config: { runTimeoutMs: 600_000, runMaxTokens: 1_000_000 },
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('processClaimedJob', () => {
  it('owner autonomous + credencial valida -> ejecuta y markCompleted con el input ensamblado', async () => {
    const deps = makeDeps();
    const job = makeJob();

    await processClaimedJob(deps, job);

    // Se ensamblo con el agente, la credencial resuelta y los mensajes normalizados del payload.
    expect(deps.assembleAgentRun).toHaveBeenCalledTimes(1);
    const params = callArgs(deps.assembleAgentRun)[0] as AssembleAgentRunParams;
    expect(params.agent).toBe(FAKE_AGENT);
    expect(params.credential).toEqual({ apiKey: 'sk-secreta', baseUrl: null });
    expect(params.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hola' }] }]);
    expect(params.limits).toEqual({ maxTokens: 1_000_000, runTimeoutMs: 600_000 });

    expect(deps.runAgent).toHaveBeenCalledTimes(1);
    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('job-1');
    expect(deps.jobs.markFailed).not.toHaveBeenCalled();
    expect(deps.jobs.markPendingRetry).not.toHaveBeenCalled();
  });

  it('fallo transitorio con attempts < 3 -> vuelve a pending (markPendingRetry) con last_error y backoff', async () => {
    const deps = makeDeps({
      runAgent: vi.fn(() => {
        throw new Error('proveedor 500');
      }),
    });
    const job = makeJob({ attempts: 1 });

    await processClaimedJob(deps, job);

    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    const [id, reason, scheduledFor] = callArgs(deps.jobs.markPendingRetry);
    expect(id).toBe('job-1');
    expect(String(reason)).toContain('proveedor 500');
    expect(scheduledFor).toBeInstanceOf(Date);
    expect(deps.jobs.markFailed).not.toHaveBeenCalled();
    expect(deps.jobs.markCompleted).not.toHaveBeenCalled();
  });

  it('fallo transitorio con attempts >= 3 -> failed definitivo con last_error', async () => {
    const deps = makeDeps({
      runAgent: vi.fn(() => {
        throw new Error('proveedor 500');
      }),
    });
    const job = makeJob({ attempts: MAX_ATTEMPTS });

    await processClaimedJob(deps, job);

    expect(deps.jobs.markFailed).toHaveBeenCalledTimes(1);
    const [id, reason] = callArgs(deps.jobs.markFailed);
    expect(id).toBe('job-1');
    expect(String(reason)).toContain('proveedor 500');
    expect(deps.jobs.markPendingRetry).not.toHaveBeenCalled();
  });

  it('owner sin tier autonomous -> failed directo SIN consumir reintentos ni ejecutar', async () => {
    const deps = makeDeps({ getProfileTier: vi.fn(async () => 'free' as const) });
    const job = makeJob({ attempts: 1 });

    await processClaimedJob(deps, job);

    expect(deps.jobs.markFailed).toHaveBeenCalledTimes(1);
    const [id, reason] = callArgs(deps.jobs.markFailed);
    expect(id).toBe('job-1');
    expect(String(reason)).toContain('autonomous');
    // Fallo permanente: no se reintenta y ni siquiera se carga el agente / credencial / motor.
    expect(deps.jobs.markPendingRetry).not.toHaveBeenCalled();
    expect(deps.loadAgent).not.toHaveBeenCalled();
    expect(deps.resolveCredential).not.toHaveBeenCalled();
    expect(deps.assembleAgentRun).not.toHaveBeenCalled();
    expect(deps.runAgent).not.toHaveBeenCalled();
  });

  it('agente inexistente -> fallo transitorio (reintento si quedan intentos)', async () => {
    const deps = makeDeps({ loadAgent: vi.fn(async () => null) });
    const job = makeJob({ attempts: 1 });

    await processClaimedJob(deps, job);

    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(String(callArgs(deps.jobs.markPendingRetry)[1])).toContain('agente agent-1');
    expect(deps.runAgent).not.toHaveBeenCalled();
  });

  it('credencial de otro proveedor que el agente -> fallo (no manda la key al endpoint equivocado)', async () => {
    const otherProviderCred: DecryptedProviderCredential = { apiKey: 'sk', providerId: 'openai', baseUrl: null };
    const deps = makeDeps({ resolveCredential: vi.fn(async () => otherProviderCred) });
    const job = makeJob({ attempts: 1 });

    await processClaimedJob(deps, job);

    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(String(callArgs(deps.jobs.markPendingRetry)[1])).toContain('openai');
    expect(deps.assembleAgentRun).not.toHaveBeenCalled();
  });

  it('timeout de pared: runAgent que no termina -> abortado, tratado como fallo del intento, timer limpiado', async () => {
    vi.useFakeTimers();
    const deps = makeDeps({
      runAgent: vi.fn((input: AgentRunInput) => hangingRun(input)),
      config: { runTimeoutMs: 1_000, runMaxTokens: 1_000_000 },
    });
    const job = makeJob({ attempts: 1 });

    const p = processClaimedJob(deps, job);
    // Corre los pasos previos (gate/agente/credencial/ensamblado), dispara el setTimeout del deadline y
    // deja que el abort resuelva el run colgado.
    await vi.runAllTimersAsync();
    await p;

    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(String(callArgs(deps.jobs.markPendingRetry)[1])).toContain('timeout');
    // El timer del deadline se limpio (clearTimeout en finally): no quedan timers colgados.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('apagado del worker a media ejecucion -> vuelve a pending (re-reclamable), nunca failed', async () => {
    const controller = new AbortController();
    const deps = makeDeps({ runAgent: vi.fn((input: AgentRunInput) => hangingRun(input)) });
    // attempts ya agotados: aun asi un apagado NO debe marcar failed.
    const job = makeJob({ attempts: MAX_ATTEMPTS });

    const p = processClaimedJob(deps, job, controller.signal);
    await Promise.resolve();
    controller.abort();
    await p;

    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(deps.jobs.markFailed).not.toHaveBeenCalled();
  });
});

describe('claimAndProcessOne', () => {
  it('cola vacia -> "empty" sin ejecutar nada', async () => {
    const deps = makeDeps();
    const result = await claimAndProcessOne(deps);
    expect(result).toBe('empty');
    expect(deps.assembleAgentRun).not.toHaveBeenCalled();
  });

  it('claim ATOMICO: usa claimNextJob (no peek) y procesa el job tomado', async () => {
    const deps = makeDeps();
    (deps.jobs.claimNextJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeJob());

    const result = await claimAndProcessOne(deps);

    expect(result).toBe('processed');
    expect(deps.jobs.claimNextJob).toHaveBeenCalledTimes(1);
    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('job-1');
  });

  it('un job que falla NO propaga: claimAndProcessOne resuelve "processed"', async () => {
    const deps = makeDeps({
      runAgent: vi.fn(() => {
        throw new Error('boom');
      }),
    });
    (deps.jobs.claimNextJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeJob({ attempts: 1 }));

    await expect(claimAndProcessOne(deps)).resolves.toBe('processed');
    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
  });
});
