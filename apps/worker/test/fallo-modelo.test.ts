import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import { MODELO_SIN_ACCESO_PREFIX } from '@ledesma-platform/shared/verificacion';
import { processClaimedJob, MAX_ATTEMPTS, type JobRunnerDeps } from '../src/execution.js';
import { PermanentExecutionError } from '../src/errores.js';
import {
  FalloDeAccesoAlModeloError,
  PREFIJO_MODELO_SIN_ACCESO,
  clasificarFalloDeAccesoAlModelo,
  marcaDeFalloDeModelo,
} from '../src/fallo-modelo.js';
import { crearMiddlewareDeModelo } from '../src/normalizador-elementid.js';
import { crearActBlindado } from '../src/stagehand.js';
import type { Logger } from '../src/logger.js';

/**
 * FALLO DE ACCESO AL MODELO (saldo agotado, cuota consumida, credencial invalida).
 *
 * Evidencia de produccion del 31 jul 2026: un job se reencolo tres veces por un fallo de credito
 * agotado, y CADA reintento abrio su propia sesion de navegador con su proxy antes de terminar en
 * "job fallido definitivo tras agotar reintentos". Estos tests fijan el comportamiento nuevo:
 *  - saldo agotado y credencial invalida NO reencolan y marcan el job permanente;
 *  - un fallo de red o un 429 de limite de tasa SIGUEN reintentandose como hoy;
 *  - el last_error empieza con el prefijo estable que la consola traduce.
 */

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
    createdAt: '2026-07-31T07:11:00.000Z',
    updatedAt: '2026-07-31T07:11:00.000Z',
    startedAt: '2026-07-31T07:11:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

/** Error tal como lo entrega el SDK de Anthropic cuando el saldo se agota (400 + texto del proveedor). */
function errorDeSaldoAgotado(): Error {
  const error = new Error(
    'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to ' +
      'upgrade or purchase credits.',
  );
  Object.assign(error, { status: 400, error: { type: 'invalid_request_error' } });
  return error;
}

/** Error de autenticacion: llave revocada o mal copiada (401). */
function errorDeAutenticacion(): Error {
  const error = new Error('invalid x-api-key');
  Object.assign(error, { status: 401, error: { type: 'authentication_error' } });
  return error;
}

/** Fallo de red transitorio: el caso que NO debe cambiar de comportamiento. */
function errorDeRedTransitorio(): Error {
  const error = new Error('fetch failed');
  error.name = 'APIConnectionError';
  return error;
}

/** 429 de LIMITE DE TASA (no de cuota agotada): tambien se sigue reintentando. */
function errorDeLimiteDeTasa(): Error {
  const error = new Error('Number of requests has exceeded your rate limit');
  Object.assign(error, { status: 429, error: { type: 'rate_limit_error' } });
  return error;
}

/** Deps minimas del runner: el job falla en `loadAgent` con el error que se le pase. */
function makeDeps(error: unknown, overrides: Partial<JobRunnerDeps> = {}): JobRunnerDeps {
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
    loadAgent: vi.fn(async () => {
      throw error;
    }),
    resolveCredential: vi.fn(),
    assembleAgentRun: vi.fn(),
    runAgent: vi.fn(),
    logger: makeLogger(),
    config: { runTimeoutMs: 60_000, tareaWebTimeoutMs: 60_000, runMaxTokens: 1000 },
    notifyJobFailure: vi.fn(async () => {}),
    ...overrides,
  } as unknown as JobRunnerDeps;
}

describe('clasificarFalloDeAccesoAlModelo', () => {
  it('reconoce el saldo agotado por el texto del proveedor', () => {
    expect(clasificarFalloDeAccesoAlModelo(errorDeSaldoAgotado())).toBe('saldo');
  });

  it('reconoce la credencial invalida por el status 401', () => {
    expect(clasificarFalloDeAccesoAlModelo(errorDeAutenticacion())).toBe('credenciales');
  });

  it('reconoce la cuota agotada de un proveedor compatible (insufficient_quota en un 429)', () => {
    const error = new Error('You exceeded your current quota, please check your plan and billing details');
    Object.assign(error, { status: 429, code: 'insufficient_quota' });
    expect(clasificarFalloDeAccesoAlModelo(error)).toBe('saldo');
  });

  it('lee la clase a traves de la cadena de cause (el AI SDK envuelve el error del proveedor)', () => {
    const envuelto = new Error('Failed after 3 attempts', { cause: errorDeSaldoAgotado() });
    expect(clasificarFalloDeAccesoAlModelo(envuelto)).toBe('saldo');
  });

  it('reconoce el ProviderError del backend (code AUTHENTICATION) por su status', () => {
    const error = new Error('Authentication failed with the model provider');
    Object.assign(error, { name: 'ProviderError', code: 'AUTHENTICATION', status: 403 });
    expect(clasificarFalloDeAccesoAlModelo(error)).toBe('credenciales');
  });

  it('NO clasifica un fallo de red transitorio', () => {
    expect(clasificarFalloDeAccesoAlModelo(errorDeRedTransitorio())).toBeNull();
  });

  it('NO clasifica un 429 de limite de tasa: reintentar SI lo resuelve', () => {
    expect(clasificarFalloDeAccesoAlModelo(errorDeLimiteDeTasa())).toBeNull();
  });

  it('NO clasifica un 5xx del proveedor ni un timeout', () => {
    const quinientos = new Error('Overloaded');
    Object.assign(quinientos, { status: 529 });
    expect(clasificarFalloDeAccesoAlModelo(quinientos)).toBeNull();
    const timeout = new Error('Request timed out');
    timeout.name = 'APITimeoutError';
    expect(clasificarFalloDeAccesoAlModelo(timeout)).toBeNull();
  });

  it('un TEXTO suelto solo se clasifica por la marca del middleware, nunca por frases sueltas', () => {
    // El mensaje final del agente puede arrastrar contenido de la pagina: una pagina cualquiera
    // JAMAS debe poder cortar una corrida.
    expect(
      clasificarFalloDeAccesoAlModelo('el sitio dice: your credit balance is too low, recarga aqui'),
    ).toBeNull();
    expect(
      clasificarFalloDeAccesoAlModelo(
        `Failed to execute task: ${marcaDeFalloDeModelo('saldo')} Error: sin saldo`,
      ),
    ).toBe('saldo');
  });
});

describe('handleFailure: un fallo de acceso al modelo NO reencola el job', () => {
  it('saldo agotado: markFailed permanente, sin markPendingRetry, aunque queden intentos', async () => {
    const deps = makeDeps(errorDeSaldoAgotado());
    // attempts=1 de 3: hoy esto era exactamente el caso que reencolaba y abria otra sesion.
    await processClaimedJob(deps, makeJob({ attempts: 1 }));
    expect(deps.jobs.markPendingRetry).not.toHaveBeenCalled();
    expect(deps.jobs.markFailed).toHaveBeenCalledTimes(1);
    const [, motivo] = (deps.jobs.markFailed as unknown as { mock: { calls: string[][] } }).mock
      .calls[0] as string[];
    expect(motivo?.startsWith(MODELO_SIN_ACCESO_PREFIX)).toBe(true);
    // El diagnostico tecnico original NO se pierde: viaja detras del prefijo estable.
    expect(motivo).toContain('credit balance is too low');
    // Fallo DEFINITIVO: se notifica al dueno igual que cualquier otro cierre permanente.
    expect(deps.notifyJobFailure).toHaveBeenCalledTimes(1);
  });

  it('credencial invalida: mismo cierre permanente, sin reencolar', async () => {
    const deps = makeDeps(errorDeAutenticacion());
    await processClaimedJob(deps, makeJob({ attempts: 1 }));
    expect(deps.jobs.markPendingRetry).not.toHaveBeenCalled();
    expect(deps.jobs.markFailed).toHaveBeenCalledTimes(1);
  });

  it('un fallo de red transitorio SIGUE reintentando como hoy (no se rompe lo util)', async () => {
    const deps = makeDeps(errorDeRedTransitorio());
    await processClaimedJob(deps, makeJob({ attempts: 1 }));
    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(deps.jobs.markFailed).not.toHaveBeenCalled();
  });

  it('un 429 de limite de tasa TAMBIEN sigue reintentando', async () => {
    const deps = makeDeps(errorDeLimiteDeTasa());
    await processClaimedJob(deps, makeJob({ attempts: 1 }));
    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(deps.jobs.markFailed).not.toHaveBeenCalled();
  });

  it('un fallo transitorio con los intentos agotados cierra definitivo, como siempre', async () => {
    const deps = makeDeps(errorDeRedTransitorio());
    await processClaimedJob(deps, makeJob({ attempts: MAX_ATTEMPTS }));
    expect(deps.jobs.markPendingRetry).not.toHaveBeenCalled();
    expect(deps.jobs.markFailed).toHaveBeenCalledTimes(1);
  });
});

describe('FalloDeAccesoAlModeloError', () => {
  it('es permanente y su last_error empieza con el prefijo estable que la consola detecta', () => {
    const error = new FalloDeAccesoAlModeloError('saldo');
    expect(error).toBeInstanceOf(PermanentExecutionError);
    expect(`${error.name}: ${error.message}`.startsWith(MODELO_SIN_ACCESO_PREFIX)).toBe(true);
    expect(error.name).toBe(PREFIJO_MODELO_SIN_ACCESO);
  });

  it('el mensaje nombra la causa y dice que reintentar no cambia nada', () => {
    expect(new FalloDeAccesoAlModeloError('saldo').message).toContain('no tiene saldo');
    expect(new FalloDeAccesoAlModeloError('credenciales').message).toContain('no es valida');
    expect(new FalloDeAccesoAlModeloError('saldo').message).toContain('NO se reintenta');
  });
});

describe('middleware de modelo (FIX B): corta el reintento interno del motor', () => {
  it('relanza el fallo de saldo MARCADO y sin ser APICallError, para que el AI SDK no lo reintente', async () => {
    const logger = makeLogger();
    const middleware = crearMiddlewareDeModelo(logger);
    const doGenerate = vi.fn(async () => {
      throw errorDeSaldoAgotado();
    });
    await expect(middleware.wrapGenerate({ doGenerate, params: {} })).rejects.toThrow(
      marcaDeFalloDeModelo('saldo'),
    );
    // Una sola llamada: el corte es inmediato, sin consumir el backoff del reintento del motor.
    expect(doGenerate).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('un fallo que NO se puede clasificar se relanza TAL CUAL (el reintento del motor sigue igual)', async () => {
    const middleware = crearMiddlewareDeModelo(makeLogger());
    const original = errorDeLimiteDeTasa();
    const doGenerate = vi.fn(async () => {
      throw original;
    });
    await expect(middleware.wrapGenerate({ doGenerate, params: {} })).rejects.toBe(original);
  });
});

describe('act blindado: el fallo de acceso al modelo es un desenlace TERMINAL', () => {
  it('aborta el bucle en el acto en vez de devolverle el fallo al modelo', async () => {
    const alTerminar = vi.fn();
    const blindado = crearActBlindado({
      actuar: async () => {
        throw errorDeSaldoAgotado();
      },
      logger: makeLogger(),
      alTerminar,
    });
    await expect(blindado.ejecutar('click en enviar')).rejects.toBeInstanceOf(
      FalloDeAccesoAlModeloError,
    );
    expect(alTerminar).toHaveBeenCalledTimes(1);
    expect(blindado.sinAccesoAlModelo()).toBe('saldo');
  });

  it('un fallo cualquiera de la accion sigue volviendo al modelo como fallo de tool', async () => {
    const alTerminar = vi.fn();
    const blindado = crearActBlindado({
      actuar: async () => {
        throw new Error('no se encontro el elemento');
      },
      logger: makeLogger(),
      alTerminar,
    });
    await expect(blindado.ejecutar('click en enviar')).resolves.toMatchObject({ success: false });
    expect(alTerminar).not.toHaveBeenCalled();
    expect(blindado.sinAccesoAlModelo()).toBeNull();
  });
});
