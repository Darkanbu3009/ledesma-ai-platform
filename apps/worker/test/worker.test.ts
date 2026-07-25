import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AgentEvent, Job } from '@ledesma-platform/shared';
import type { AgentConfig, AgentRunInput, DecryptedProviderCredential } from '@ledesma-platform/backend/execution';
import { drainQueue, startWorker } from '../src/worker.js';
import { REAP_STALE_MS } from '../src/execution.js';
import type { JobRunnerDeps } from '../src/execution.js';
import type { Logger } from '../src/logger.js';

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
const FAKE_CRED: DecryptedProviderCredential = { apiKey: 'sk', providerId: 'anthropic', baseUrl: null };

async function* successRun(): AsyncIterable<AgentEvent> {
  yield { type: 'stop', reason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };
}

function makeDeps(overrides: Partial<JobRunnerDeps> = {}): JobRunnerDeps {
  return {
    jobs: {
      claimNextJob: vi.fn(async () => null),
      markCompleted: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
      markPendingRetry: vi.fn(async () => {}),
      latirJob: vi.fn(async () => 'running' as const),
      reapOrphanedJobs: vi.fn(async () => []),
    },
    getProfileTier: vi.fn(async () => 'autonomous' as const),
    loadAgent: vi.fn(async () => FAKE_AGENT),
    resolveCredential: vi.fn(async () => FAKE_CRED),
    assembleAgentRun: vi.fn(() => ({
      input: {} as unknown as AgentRunInput,
      executeTool: vi.fn(),
    })),
    runAgent: vi.fn(() => successRun()),
    logger: makeLogger(),
    config: { runTimeoutMs: 600_000, tareaWebTimeoutMs: 1_500_000, runMaxTokens: 1_000_000 },
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('drainQueue', () => {
  it('drena la cola hasta vaciarla (procesa todos los jobs elegibles en una pasada)', async () => {
    const deps = makeDeps();
    (deps.jobs.claimNextJob as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeJob({ id: 'a' }))
      .mockResolvedValueOnce(makeJob({ id: 'b' }))
      .mockResolvedValueOnce(null);

    await drainQueue(deps, new AbortController().signal);

    expect(deps.jobs.claimNextJob).toHaveBeenCalledTimes(3);
    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('a');
    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('b');
  });

  it('un job roto NO tumba el loop: sigue con el siguiente job', async () => {
    let call = 0;
    const deps = makeDeps({
      runAgent: vi.fn(() => {
        call += 1;
        if (call === 1) throw new Error('job 1 explota');
        return successRun();
      }),
    });
    (deps.jobs.claimNextJob as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeJob({ id: 'roto', attempts: 1 }))
      .mockResolvedValueOnce(makeJob({ id: 'sano' }))
      .mockResolvedValueOnce(null);

    await drainQueue(deps, new AbortController().signal);

    // El job roto se reencolo y el loop continuo hasta procesar el sano y vaciar la cola.
    expect(deps.jobs.markPendingRetry).toHaveBeenCalledWith('roto', expect.any(String), expect.any(Date));
    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('sano');
    expect(deps.jobs.claimNextJob).toHaveBeenCalledTimes(3);
  });

  it('si el claim lanza (DB caida) corta la pasada y NO entra en bucle apretado', async () => {
    const deps = makeDeps();
    (deps.jobs.claimNextJob as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('conexion caida'));

    await drainQueue(deps, new AbortController().signal);

    expect(deps.jobs.claimNextJob).toHaveBeenCalledTimes(1);
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it('respeta el apagado: con el signal abortado no reclama nada', async () => {
    const deps = makeDeps();
    const controller = new AbortController();
    controller.abort();

    await drainQueue(deps, controller.signal);

    expect(deps.jobs.claimNextJob).not.toHaveBeenCalled();
  });
});

describe('startWorker', () => {
  it('arranca, drena en la primera pasada y stop() resuelve un cierre limpio', async () => {
    const deps = makeDeps();
    (deps.jobs.claimNextJob as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeJob({ id: 'x' }))
      .mockResolvedValue(null);

    const handle = startWorker({ deps, logger: deps.logger, intervalMs: 60_000 });
    // Deja correr la pasada inmediata.
    await new Promise((r) => setTimeout(r, 0));
    await handle.stop();

    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('x');
    expect(deps.logger.info).toHaveBeenCalledWith('worker detenido');
    // stop() es idempotente.
    await expect(handle.stop()).resolves.toBeUndefined();
  });
});

describe('reaper de jobs detenidos en el loop del worker', () => {
  it('corre el reaper en la PRIMERA pasada, con el umbral por latido (90s) y MAX_ATTEMPTS', async () => {
    const deps = makeDeps({ config: { runTimeoutMs: 600_000, tareaWebTimeoutMs: 1_500_000, runMaxTokens: 1_000_000 } });
    (deps.jobs.claimNextJob as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const handle = startWorker({ deps, logger: deps.logger, intervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 0));
    await handle.stop();

    expect(deps.jobs.reapOrphanedJobs).toHaveBeenCalled();
    const arg = (deps.jobs.reapOrphanedJobs as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    // Umbral por LATIDO: 3 x HEARTBEAT_INTERVAL_MS (90s), sin margenes por tipo; maxAttempts = 3.
    expect(arg).toMatchObject({ staleMs: REAP_STALE_MS, maxAttempts: 3 });
    expect(REAP_STALE_MS).toBe(90_000);
  });

  it('un fallo del reaper NO rompe la pasada: la cola igual se drena', async () => {
    const deps = makeDeps();
    (deps.jobs.reapOrphanedJobs as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('reaper boom'));
    (deps.jobs.claimNextJob as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeJob({ id: 'x' }))
      .mockResolvedValue(null);

    const handle = startWorker({ deps, logger: deps.logger, intervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 0));
    await handle.stop();

    // El fallo del reaper se registro pero el job igual se proceso (best-effort, no tumba la pasada).
    expect(deps.logger.error).toHaveBeenCalled();
    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('x');
  });

  it('registra los huerfanos recuperados y sigue drenando en la MISMA pasada (reaper antes del claim)', async () => {
    const deps = makeDeps();
    (deps.jobs.reapOrphanedJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'huerfano', status: 'pending', attempts: 1 },
    ]);
    (deps.jobs.claimNextJob as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeJob({ id: 'huerfano', attempts: 2 }))
      .mockResolvedValue(null);

    const handle = startWorker({ deps, logger: deps.logger, intervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 0));
    await handle.stop();

    expect(deps.logger.warn).toHaveBeenCalledWith(
      'reaper: jobs huerfanos recuperados',
      expect.objectContaining({ count: 1, toPending: 1, toFailed: 0 }),
    );
    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('huerfano');
  });
});
