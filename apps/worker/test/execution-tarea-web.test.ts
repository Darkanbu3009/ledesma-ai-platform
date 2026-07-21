import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import type { AgentRunInput } from '@ledesma-platform/backend/execution';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import { processClaimedJob } from '../src/execution.js';
import type { JobRunnerDeps } from '../src/execution.js';
import type { TareaWebDeps } from '../src/tarea-web.js';
import { makeAprobacionesRepo } from './aprobaciones-fakes.js';
import { MARCADOR_SESION_CADUCADA } from '../src/prompt-tarea-web.js';
import type { Logger } from '../src/logger.js';

/**
 * Integracion del job de TAREA WEB (7.1d) con el runner (processClaimedJob): la rama por kind, el
 * cierre en la cola y -- lo critico -- que una pantalla de login/verificacion produce un fallo
 * DEFINITIVO (markFailed directo, CERO reintentos) con UNA sola alerta al owner. El comportamiento
 * interno del handler se cubre en tarea-web.test.ts.
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(payload: unknown, overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    agentId: 'agent-1',
    ownerId: 'user-1',
    credentialId: 'cred-1',
    status: 'running',
    payload,
    scheduledFor: null,
    attempts: 1,
    lastError: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    startedAt: '2026-07-20T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

function makeSitio(overrides: Partial<SitioConectado> = {}): SitioConectado {
  return {
    id: CONNECTION_ID,
    ownerId: 'user-1',
    dominio: 'app.ejemplo.com',
    urlLogin: 'https://app.ejemplo.com/login',
    contextoExternoId: 'ctx-1',
    proxyRef: 'browserbase',
    proxyCountry: 'AR',
    proxyState: null,
    egressIp: '203.0.113.7',
    fingerprintRef: 'contexto:ctx-1',
    sesionExternaId: null,
    vistaEnVivoUrl: null,
    estado: 'activo',
    tieneContexto: true,
    creadoEn: '2026-07-16T00:00:00.000Z',
    ultimoUsoEn: null,
    expiraEn: null,
    ...overrides,
  };
}

function makeTareaWebDeps(overrides: Partial<TareaWebDeps> = {}): TareaWebDeps {
  return {
    repo: {
      obtenerPorId: vi.fn(async () => makeSitio()),
      obtenerContextoDescifrado: vi.fn(async () => JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] })),
      guardarContexto: vi.fn(async () => makeSitio()),
      actualizarEstado: vi.fn(async () => makeSitio()),
    },
    navegador: {
      abrirSesionParaTarea: vi.fn(async () => ({
        sesionExternaId: 'ses-1',
        egressIp: '203.0.113.7',
        egressCountry: 'AR',
      })),
      inyectarContexto: vi.fn(async () => {}),
      detectarPantallaDeLogin: vi.fn(async () => false),
      extraerContexto: vi.fn(async () => JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] })),
      estadoDeSesion: vi.fn(async () => 'viva' as const),
      capturarPantalla: vi.fn(async () => 'cGxhY2Vob2xkZXI='),
      observarSalida: vi.fn(async () => ({ egressIp: '203.0.113.7', egressCountry: 'AR' })),
      cerrarSesion: vi.fn(async () => {}),
    },
    motor: { ejecutar: vi.fn(async () => ({ exito: true, mensaje: 'listo' })) },
    vaultSecret: '0123456789abcdef0123456789abcdef',
    model: 'anthropic/claude-sonnet-4-6',
    runTimeoutMs: 600_000,
    resolveCredential: vi.fn(async () => ({
      id: 'cred-1',
      providerId: 'anthropic' as const,
      apiKey: 'sk-ant-secreta',
      baseUrl: null,
    })),
    guardarResultado: vi.fn(async () => {}),
    aprobaciones: makeAprobacionesRepo(),
    aprobacionTtlMs: 15 * 60 * 1000,
    marcarJobPausado: vi.fn(async () => {}),
    logger: makeLogger(),
    ...overrides,
  };
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
    loadAgent: vi.fn(async () => null),
    resolveCredential: vi.fn(async () => {
      throw new Error('la tarea web resuelve su credencial por sus propias deps, no por las del motor');
    }),
    assembleAgentRun: vi.fn(() => ({ input: {} as unknown as AgentRunInput, executeTool: vi.fn() })),
    runAgent: vi.fn(() => {
      throw new Error('no debe correrse el motor de agentes en un job de tarea web');
    }),
    notifyJobFailure: vi.fn(async () => {}),
    logger: makeLogger(),
    config: { runTimeoutMs: 600_000, runMaxTokens: 1_000_000 },
    ...overrides,
  };
}

const PAYLOAD = { kind: 'tarea_web', connectionId: CONNECTION_ID, objetivo: 'dime que dice mi panel' };

describe('processClaimedJob con jobs de tarea web', () => {
  it('ramifica por kind SIN tocar el motor de agentes y cierra completed en exito', async () => {
    const tareaWeb = makeTareaWebDeps();
    const deps = makeDeps({ tareaWeb });
    await processClaimedJob(deps, makeJob(PAYLOAD));
    expect(tareaWeb.motor.ejecutar).toHaveBeenCalledTimes(1);
    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('job-1');
    expect(deps.loadAgent).not.toHaveBeenCalled();
    expect(deps.assembleAgentRun).not.toHaveBeenCalled();
    expect(deps.runAgent).not.toHaveBeenCalled();
  });

  it('pantalla de login a mitad de tarea: markFailed DIRECTO (cero reintentos) y UNA alerta', async () => {
    const tareaWeb = makeTareaWebDeps({
      motor: {
        ejecutar: vi.fn(async () => ({ exito: false, mensaje: `${MARCADOR_SESION_CADUCADA}: login` })),
      },
    });
    // attempts=1: a un fallo transitorio le quedarian reintentos; el permanente NO los usa.
    const deps = makeDeps({ tareaWeb });
    await processClaimedJob(deps, makeJob(PAYLOAD, { attempts: 1 }));
    expect(deps.jobs.markFailed).toHaveBeenCalledTimes(1);
    expect(deps.jobs.markFailed).toHaveBeenCalledWith('job-1', expect.stringContaining('caduco'));
    expect(deps.jobs.markPendingRetry).not.toHaveBeenCalled();
    expect(deps.notifyJobFailure).toHaveBeenCalledTimes(1);
    // Cero reintentos de la tarea: el motor corrio exactamente una vez.
    expect(tareaWeb.motor.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('sin deps.tareaWeb cableado (falta env), el job falla DEFINITIVO con mensaje accionable', async () => {
    const deps = makeDeps();
    await processClaimedJob(deps, makeJob(PAYLOAD));
    expect(deps.jobs.markFailed).toHaveBeenCalledWith('job-1', expect.stringContaining('BROWSERBASE_API_KEY'));
    expect(deps.jobs.markPendingRetry).not.toHaveBeenCalled();
  });

  it('el gate por tier aplica tambien a la tarea web (suite autonoma)', async () => {
    const tareaWeb = makeTareaWebDeps();
    const deps = makeDeps({ tareaWeb, getProfileTier: vi.fn(async () => 'free' as never) });
    await processClaimedJob(deps, makeJob(PAYLOAD));
    expect(deps.jobs.markFailed).toHaveBeenCalled();
    expect(tareaWeb.motor.ejecutar).not.toHaveBeenCalled();
  });
});
