import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import type { AgentRunInput } from '@ledesma-platform/backend/execution';
import { processClaimedJob } from '../src/execution.js';
import type { JobRunnerDeps } from '../src/execution.js';
import type { SitiosJobDeps } from '../src/sitios.js';
import type { Logger } from '../src/logger.js';

/**
 * Integracion de los jobs de SITIOS CONECTADOS con el runner (processClaimedJob): la rama por
 * payload.kind, la propiedad estructural de que NUNCA se toca agente/credencial/modelo en esa ruta,
 * y el cierre en la cola. El comportamiento interno de cada handler se cubre en sitios.test.ts.
 */

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(payload: unknown): Job {
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
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    startedAt: '2026-07-16T00:00:00.000Z',
    finishedAt: null,
  };
}

function makeSitiosDeps(): SitiosJobDeps {
  return {
    repo: {
      obtenerPorDominio: vi.fn(async () => null),
      obtenerPorId: vi.fn(async () => null),
      registrarSesionDeLogin: vi.fn(async () => ({}) as never),
      pinearPais: vi.fn(async () => null),
      reabrirParaLogin: vi.fn(async () => null),
      guardarContexto: vi.fn(async () => null),
      cerrarLogin: vi.fn(async () => null),
      listarEsperandoLoginVencidas: vi.fn(async () => []),
      borrar: vi.fn(async () => null),
    },
    navegador: {
      abrirSesionParaLogin: vi.fn(async () => ({
        sesionExternaId: 'ses-1',
        contextoExternoId: 'ctx-1',
        vistaEnVivoUrl: 'https://live.browserbase.com/ses-1',
        proxyRef: 'browserbase',
        egressIp: null,
        egressCountry: 'AR',
        fingerprintRef: null,
        expiraEn: null,
      })),
      estadoDeSesion: vi.fn(async () => 'viva' as const),
      extraerContexto: vi.fn(async () => '{}'),
      cerrarSesion: vi.fn(async () => {}),
      borrarContexto: vi.fn(async () => {}),
    },
    vaultSecret: '0123456789abcdef0123456789abcdef',
    registrarDesconexionArco: vi.fn(async () => {}),
    logger: makeLogger(),
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
      throw new Error('no debe resolverse credencial en un job de sitio');
    }),
    assembleAgentRun: vi.fn(() => ({ input: {} as unknown as AgentRunInput, executeTool: vi.fn() })),
    runAgent: vi.fn(() => {
      throw new Error('no debe correrse el motor en un job de sitio');
    }),
    logger: makeLogger(),
    config: { runTimeoutMs: 600_000, tareaWebTimeoutMs: 1_500_000, runMaxTokens: 1_000_000 },
    ...overrides,
  };
}

describe('processClaimedJob con jobs de sitios conectados', () => {
  it('ramifica por kind ANTES del motor: no carga agente, ni credencial, ni corre el modelo', async () => {
    const sitios = makeSitiosDeps();
    const deps = makeDeps({ sitios });
    const job = makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' });

    await processClaimedJob(deps, job);

    expect(sitios.navegador.abrirSesionParaLogin).toHaveBeenCalledTimes(1);
    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('job-1');
    // La propiedad central: la ruta de sitios JAMAS toca el motor ni la boveda de credenciales.
    expect(deps.loadAgent).not.toHaveBeenCalled();
    expect(deps.resolveCredential).not.toHaveBeenCalled();
    expect(deps.assembleAgentRun).not.toHaveBeenCalled();
    expect(deps.runAgent).not.toHaveBeenCalled();
  });

  it('termina en tiempo acotado: conectar_sitio no espera, no poll-ea, no duerme', async () => {
    const deps = makeDeps({ sitios: makeSitiosDeps() });
    const inicio = Date.now();
    await processClaimedJob(deps, makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' }));
    expect(Date.now() - inicio).toBeLessThan(500);
    expect(deps.jobs.markCompleted).toHaveBeenCalled();
  });

  it('sin deps.sitios cableado (falta env), el job falla DEFINITIVO con mensaje accionable', async () => {
    const deps = makeDeps();
    await processClaimedJob(deps, makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' }));
    expect(deps.jobs.markFailed).toHaveBeenCalledWith('job-1', expect.stringContaining('BROWSERBASE_API_KEY'));
    expect(deps.jobs.markPendingRetry).not.toHaveBeenCalled();
  });

  it('el gate por tier aplica tambien a los jobs de sitios (parte de la suite autonoma)', async () => {
    const sitios = makeSitiosDeps();
    const deps = makeDeps({ sitios, getProfileTier: vi.fn(async () => 'free' as never) });
    await processClaimedJob(deps, makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' }));
    expect(deps.jobs.markFailed).toHaveBeenCalled();
    expect(sitios.navegador.abrirSesionParaLogin).not.toHaveBeenCalled();
  });

  it('un job simple sigue el camino de siempre (la rama de sitios no lo toca)', async () => {
    const sitios = makeSitiosDeps();
    const deps = makeDeps({ sitios });
    await processClaimedJob(deps, makeJob({ messages: [{ role: 'user', content: 'hola' }] }));
    // Sin agente cargado -> fallo transitorio del camino simple: la rama de sitios nunca se activo.
    expect(sitios.navegador.abrirSesionParaLogin).not.toHaveBeenCalled();
    expect(deps.loadAgent).toHaveBeenCalledTimes(1);
  });
});
