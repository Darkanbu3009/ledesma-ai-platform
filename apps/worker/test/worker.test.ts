import { describe, it, expect, vi } from 'vitest';
import type { JobsRepository, Job } from '@ledesma-platform/shared';
import { pollQueueOnce } from '../src/worker.js';
import type { Logger } from '../src/logger.js';

type Entry = [string, Record<string, unknown> | undefined];

function makeLogger(): { logger: Logger; calls: Record<'debug' | 'info' | 'warn' | 'error', Entry[]> } {
  const calls = { debug: [] as Entry[], info: [] as Entry[], warn: [] as Entry[], error: [] as Entry[] };
  const logger: Logger = {
    debug: (msg, meta) => void calls.debug.push([msg, meta]),
    info: (msg, meta) => void calls.info.push([msg, meta]),
    warn: (msg, meta) => void calls.warn.push([msg, meta]),
    error: (msg, meta) => void calls.error.push([msg, meta]),
  };
  return { logger, calls };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    agentId: 'agent-1',
    ownerId: 'user-1',
    credentialId: 'cred-1',
    status: 'pending',
    payload: {},
    scheduledFor: null,
    attempts: 0,
    lastError: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe('pollQueueOnce (esqueleto: solo lectura)', () => {
  it('cola vacia: loguea debug y NO consulta el proximo job', async () => {
    const countPending = vi.fn(async () => 0);
    const getNextPendingJob = vi.fn(async () => null);
    const claimNextJob = vi.fn();
    const repo = { countPending, getNextPendingJob, claimNextJob } as unknown as JobsRepository;
    const { logger, calls } = makeLogger();

    await pollQueueOnce(repo, logger);

    expect(countPending).toHaveBeenCalledTimes(1);
    expect(getNextPendingJob).not.toHaveBeenCalled();
    expect(calls.debug).toHaveLength(1);
    expect(calls.info).toHaveLength(0);
  });

  it('con pending: loguea el conteo y el proximo job, sin TOMARLO (no claim)', async () => {
    const countPending = vi.fn(async () => 3);
    const getNextPendingJob = vi.fn(async () => makeJob({ id: 'job-7', agentId: 'agent-9' }));
    const claimNextJob = vi.fn();
    const markCompleted = vi.fn();
    const repo = {
      countPending,
      getNextPendingJob,
      claimNextJob,
      markCompleted,
    } as unknown as JobsRepository;
    const { logger, calls } = makeLogger();

    await pollQueueOnce(repo, logger);

    expect(getNextPendingJob).toHaveBeenCalledTimes(1);
    // El esqueleto NO debe tomar ni cerrar jobs (eso es PR 5.2).
    expect(claimNextJob).not.toHaveBeenCalled();
    expect(markCompleted).not.toHaveBeenCalled();
    expect(calls.info).toHaveLength(1);
    const meta = calls.info[0]?.[1] as { pending: number; nextJobId: string | null };
    expect(meta.pending).toBe(3);
    expect(meta.nextJobId).toBe('job-7');
  });
});
