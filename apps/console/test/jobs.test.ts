import { describe, expect, it } from 'vitest';
import {
  buildJobsQuery,
  hasInFlightJobs,
  isJobInFlight,
  jobStatusLabel,
  jobTypeLabel,
  type JobActivity,
  type JobStatus,
} from '../src/lib/jobs';

function makeJob(overrides: Partial<JobActivity> = {}): JobActivity {
  return {
    id: 'j1',
    type: 'simple',
    agentId: 'a1',
    status: 'completed',
    attempts: 1,
    lastError: null,
    scheduledFor: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe('jobStatusLabel', () => {
  it('traduce los cuatro estados', () => {
    const labels: Record<JobStatus, string> = {
      pending: 'Pendiente',
      running: 'En curso',
      completed: 'Completada',
      failed: 'Fallida',
    };
    (Object.keys(labels) as JobStatus[]).forEach((status) => {
      expect(jobStatusLabel(status)).toBe(labels[status]);
    });
  });
});

describe('jobTypeLabel', () => {
  it('recipe -> Receta, simple -> Mensaje, sitio -> Sitio', () => {
    expect(jobTypeLabel('recipe')).toBe('Receta');
    expect(jobTypeLabel('simple')).toBe('Mensaje');
    expect(jobTypeLabel('sitio')).toBe('Sitio');
  });
});

describe('isJobInFlight', () => {
  it('pending y running estan en vuelo; completed y failed no', () => {
    expect(isJobInFlight('pending')).toBe(true);
    expect(isJobInFlight('running')).toBe(true);
    expect(isJobInFlight('completed')).toBe(false);
    expect(isJobInFlight('failed')).toBe(false);
  });
});

describe('hasInFlightJobs', () => {
  it('true si algun job esta pending/running', () => {
    expect(hasInFlightJobs([makeJob({ status: 'completed' }), makeJob({ status: 'running' })])).toBe(true);
    expect(hasInFlightJobs([makeJob({ status: 'pending' })])).toBe(true);
  });

  it('false si todos estan en estado terminal o la lista esta vacia', () => {
    expect(hasInFlightJobs([makeJob({ status: 'completed' }), makeJob({ status: 'failed' })])).toBe(false);
    expect(hasInFlightJobs([])).toBe(false);
  });
});

describe('buildJobsQuery', () => {
  it('incluye limit y offset siempre', () => {
    expect(buildJobsQuery({ limit: 20, offset: 0 })).toBe('?limit=20&offset=0');
    expect(buildJobsQuery({ limit: 10, offset: 40 })).toBe('?limit=10&offset=40');
  });

  it("con status 'all' o ausente NO agrega el filtro", () => {
    expect(buildJobsQuery({ limit: 20, offset: 0, status: 'all' })).toBe('?limit=20&offset=0');
    expect(buildJobsQuery({ limit: 20, offset: 0 })).toBe('?limit=20&offset=0');
  });

  it('con un status concreto agrega el filtro', () => {
    expect(buildJobsQuery({ limit: 20, offset: 0, status: 'failed' })).toBe('?limit=20&offset=0&status=failed');
    expect(buildJobsQuery({ limit: 5, offset: 5, status: 'running' })).toBe('?limit=5&offset=5&status=running');
  });
});
