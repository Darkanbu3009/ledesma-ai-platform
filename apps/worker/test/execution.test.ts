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

// --- Helpers de RECETA -------------------------------------------------------------------------

/** Mensaje normalizado de un solo bloque de texto (para armar los historiales esperados). */
function u(text: string): { role: 'user'; content: { type: 'text'; text: string }[] } {
  return { role: 'user', content: [{ type: 'text', text }] };
}
function a(text: string): { role: 'assistant'; content: { type: 'text'; text: string }[] } {
  return { role: 'assistant', content: [{ type: 'text', text }] };
}

/** Payload de un job de RECETA (kind:'recipe') con un paso por cada instruccion de texto. */
function recipePayload(messages: string[]): unknown {
  return { kind: 'recipe', recipeId: 'receta-1', steps: messages.map((message) => ({ message })) };
}

/**
 * runAgent mock que devuelve un OUTPUT de texto DISTINTO por corrida (una por paso). Cada entrada puede
 * ser un string (un solo text_delta) o un array de strings (varios text_delta, para probar que
 * runAgentWithDeadline ACUMULA el texto). Cierra siempre con un stop natural (exito).
 */
function runAgentSequence(outputsPerCall: Array<string | string[]>): JobRunnerDeps['runAgent'] {
  let call = 0;
  return vi.fn(() => {
    const spec = outputsPerCall[call] ?? '';
    call += 1;
    const chunks = Array.isArray(spec) ? spec : [spec];
    return (async function* (): AsyncIterable<AgentEvent> {
      for (const chunk of chunks) yield { type: 'text_delta', text: chunk };
      yield { type: 'stop', reason: 'end_turn', usage: { inputTokens: 2, outputTokens: 3 } };
    })();
  });
}

/** Lee los messages con los que se llamo a assembleAgentRun en la corrida `callIndex`. */
function assembledMessages(fn: unknown, callIndex: number): unknown {
  return (callArgs(fn, callIndex)[0] as AssembleAgentRunParams).messages;
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
    notifyJobFailure: vi.fn(async () => {}),
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

describe('notificacion de fallo definitivo (hook en handleFailure)', () => {
  it('fallo permanente (tier no autonomous) -> notifica al owner con job + reason', async () => {
    const deps = makeDeps({ getProfileTier: vi.fn(async () => 'free' as const) });
    const job = makeJob({ attempts: 1 });

    await processClaimedJob(deps, job);

    expect(deps.jobs.markFailed).toHaveBeenCalledTimes(1);
    expect(deps.notifyJobFailure).toHaveBeenCalledTimes(1);
    const [notifiedJob, reason] = callArgs(deps.notifyJobFailure);
    expect((notifiedJob as Job).id).toBe('job-1');
    expect(String(reason)).toContain('autonomous');
  });

  it('fallo transitorio con attempts agotados -> notifica al owner con el error como reason', async () => {
    const deps = makeDeps({
      runAgent: vi.fn(() => {
        throw new Error('proveedor 500');
      }),
    });
    const job = makeJob({ attempts: MAX_ATTEMPTS });

    await processClaimedJob(deps, job);

    expect(deps.jobs.markFailed).toHaveBeenCalledTimes(1);
    expect(deps.notifyJobFailure).toHaveBeenCalledTimes(1);
    expect(String(callArgs(deps.notifyJobFailure)[1])).toContain('proveedor 500');
  });

  it('reintento transitorio (attempts < 3) -> NO notifica', async () => {
    const deps = makeDeps({
      runAgent: vi.fn(() => {
        throw new Error('proveedor 500');
      }),
    });
    const job = makeJob({ attempts: 1 });

    await processClaimedJob(deps, job);

    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(deps.notifyJobFailure).not.toHaveBeenCalled();
  });

  it('apagado del worker -> vuelve a pending y NO notifica (no es fallo definitivo)', async () => {
    const controller = new AbortController();
    const deps = makeDeps({ runAgent: vi.fn((input: AgentRunInput) => hangingRun(input)) });
    const job = makeJob({ attempts: MAX_ATTEMPTS });

    const p = processClaimedJob(deps, job, controller.signal);
    await Promise.resolve();
    controller.abort();
    await p;

    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(deps.jobs.markFailed).not.toHaveBeenCalled();
    expect(deps.notifyJobFailure).not.toHaveBeenCalled();
  });

  it('si notifyJobFailure lanza, el job igual queda failed y processClaimedJob no propaga', async () => {
    const deps = makeDeps({
      getProfileTier: vi.fn(async () => 'free' as const),
      notifyJobFailure: vi.fn(async () => {
        throw new Error('resend caido');
      }),
    });
    const job = makeJob({ attempts: 1 });

    // No debe rechazar: el fallo de la alerta se traga (best-effort).
    await expect(processClaimedJob(deps, job)).resolves.toBeUndefined();
    expect(deps.jobs.markFailed).toHaveBeenCalledTimes(1);
    // Se intento notificar y se registro el fallo del envio, sin romper el cierre del job.
    expect(deps.notifyJobFailure).toHaveBeenCalledTimes(1);
    expect(deps.logger.error).toHaveBeenCalled();
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

describe('processClaimedJob - recetas (kind:recipe)', () => {
  it('ejecuta los N pasos EN ORDEN, encadenando el output previo como historial, y markCompleted', async () => {
    const deps = makeDeps({ runAgent: runAgentSequence(['salida-1', 'salida-2', 'salida-3']) });
    const job = makeJob({ payload: recipePayload(['paso 1', 'paso 2', 'paso 3']) });

    await processClaimedJob(deps, job);

    // Una corrida (assembleAgentRun + runAgent) POR PASO, en orden.
    expect(deps.assembleAgentRun).toHaveBeenCalledTimes(3);
    expect(deps.runAgent).toHaveBeenCalledTimes(3);

    // Paso 1: solo su user. Paso 2: user1 + assistant(output1) + user2. Paso 3: toda la conversacion.
    expect(assembledMessages(deps.assembleAgentRun, 0)).toEqual([u('paso 1')]);
    expect(assembledMessages(deps.assembleAgentRun, 1)).toEqual([u('paso 1'), a('salida-1'), u('paso 2')]);
    expect(assembledMessages(deps.assembleAgentRun, 2)).toEqual([
      u('paso 1'),
      a('salida-1'),
      u('paso 2'),
      a('salida-2'),
      u('paso 3'),
    ]);

    // Mismo agente/credencial en todos los pasos.
    const p0 = callArgs(deps.assembleAgentRun, 0)[0] as AssembleAgentRunParams;
    const p2 = callArgs(deps.assembleAgentRun, 2)[0] as AssembleAgentRunParams;
    expect(p0.agent).toBe(FAKE_AGENT);
    expect(p2.agent).toBe(FAKE_AGENT);
    expect(p0.credential).toEqual({ apiKey: 'sk-secreta', baseUrl: null });

    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('job-1');
    expect(deps.jobs.markFailed).not.toHaveBeenCalled();
    expect(deps.jobs.markPendingRetry).not.toHaveBeenCalled();
  });

  it('captura de output: runAgentWithDeadline ACUMULA los text_delta y los inyecta como assistant', async () => {
    // El paso 1 emite el output en DOS text_delta: el assistant del paso 2 debe traer la concatenacion.
    const deps = makeDeps({ runAgent: runAgentSequence([['Hola, ', 'mundo'], 'ok']) });
    const job = makeJob({ payload: recipePayload(['p1', 'p2']) });

    await processClaimedJob(deps, job);

    expect(assembledMessages(deps.assembleAgentRun, 1)).toEqual([u('p1'), a('Hola, mundo'), u('p2')]);
    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('job-1');
  });

  it('encadenamiento: el assistant inyectado en el paso i+1 CONTIENE el output del paso i', async () => {
    const deps = makeDeps({ runAgent: runAgentSequence(['RESULTADO-DEL-PASO-1', 'ok']) });
    const job = makeJob({ payload: recipePayload(['p1', 'p2']) });

    await processClaimedJob(deps, job);

    const m2 = assembledMessages(deps.assembleAgentRun, 1) as ReturnType<typeof a>[];
    const assistant = m2.find((m) => m.role === 'assistant');
    expect(assistant?.content[0]?.text).toBe('RESULTADO-DEL-PASO-1');
  });

  it('fallo en un paso INTERMEDIO (paso 2 de 3 lanza): el job entero falla, sin correr el paso 3', async () => {
    let call = 0;
    const runAgent = vi.fn(() => {
      call += 1;
      if (call === 2) throw new Error('boom en el paso 2');
      return successRun();
    });
    const deps = makeDeps({ runAgent });
    const job = makeJob({ payload: recipePayload(['p1', 'p2', 'p3']), attempts: 1 });

    await processClaimedJob(deps, job);

    // El paso 3 nunca se ensambla (la receta se corta en el fallo del paso 2).
    expect(deps.assembleAgentRun).toHaveBeenCalledTimes(2);
    // attempts < 3 -> reintento, con el last_error mencionando EN QUE paso fallo.
    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(String(callArgs(deps.jobs.markPendingRetry)[1])).toContain('paso 2 de 3');
    expect(deps.jobs.markCompleted).not.toHaveBeenCalled();
    expect(deps.jobs.markFailed).not.toHaveBeenCalled();
  });

  it('fallo en un paso con attempts agotados -> failed definitivo, con el paso en el last_error', async () => {
    let call = 0;
    const runAgent = vi.fn(() => {
      call += 1;
      if (call === 2) throw new Error('boom en el paso 2');
      return successRun();
    });
    const deps = makeDeps({ runAgent });
    const job = makeJob({ payload: recipePayload(['p1', 'p2', 'p3']), attempts: MAX_ATTEMPTS });

    await processClaimedJob(deps, job);

    expect(deps.jobs.markFailed).toHaveBeenCalledTimes(1);
    expect(String(callArgs(deps.jobs.markFailed)[1])).toContain('paso 2 de 3');
    expect(deps.jobs.markPendingRetry).not.toHaveBeenCalled();
  });

  it('un stop "error" en un paso INTERMEDIO falla el job y corta la receta (no encadena el output erroneo)', async () => {
    // El paso 1 completa ok; el paso 2 emite texto parcial y cierra con stop 'error'.
    let call = 0;
    const deps = makeDeps({
      runAgent: vi.fn(() => {
        call += 1;
        if (call === 2) {
          return (async function* (): AsyncIterable<AgentEvent> {
            yield { type: 'text_delta', text: 'parcial-erroneo' };
            yield { type: 'stop', reason: 'error', usage: { inputTokens: 1, outputTokens: 1 } };
          })();
        }
        return successRun();
      }),
    });
    const job = makeJob({ payload: recipePayload(['p1', 'p2', 'p3']), attempts: 1 });

    await processClaimedJob(deps, job);

    // El paso 2 fallo por stop 'error'; el paso 3 NUNCA se ensambla, asi que el output erroneo del
    // paso 2 no se encadena hacia adelante como historial.
    expect(deps.assembleAgentRun).toHaveBeenCalledTimes(2);
    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(String(callArgs(deps.jobs.markPendingRetry)[1])).toContain('paso 2 de 3');
    expect(deps.jobs.markCompleted).not.toHaveBeenCalled();
  });

  it('deadline POR PASO: un paso intermedio que se cuelga expira con su propio timer y falla en ese paso', async () => {
    vi.useFakeTimers();
    // El paso 1 completa al instante; el paso 2 se cuelga hasta el abort del deadline (su propio timer).
    let call = 0;
    const deps = makeDeps({
      runAgent: vi.fn((input: AgentRunInput) => {
        call += 1;
        return call === 1 ? successRun() : hangingRun(input);
      }),
      config: { runTimeoutMs: 1_000, runMaxTokens: 1_000_000 },
    });
    const job = makeJob({ payload: recipePayload(['p1', 'p2', 'p3']), attempts: 1 });

    const p = processClaimedJob(deps, job);
    await vi.runAllTimersAsync();
    await p;

    // El paso 2 se ensamblo y se colgo; el paso 3 nunca (la receta se corta en el timeout del paso 2).
    expect(deps.assembleAgentRun).toHaveBeenCalledTimes(2);
    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    const reason = String(callArgs(deps.jobs.markPendingRetry)[1]);
    expect(reason).toContain('paso 2 de 3'); // el last_error indica el paso donde vencio el deadline
    expect(reason).toContain('timeout');
    // Cada paso arma y limpia SU PROPIO timer (clearTimeout en finally): sin timers colgados al final.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('acumula el uso de tokens de TODOS los pasos y lo registra al completar la receta', async () => {
    // runAgentSequence reporta { inputTokens: 2, outputTokens: 3 } por corrida; 3 pasos -> 6 / 9.
    const deps = makeDeps({ runAgent: runAgentSequence(['a', 'b', 'c']) });
    const job = makeJob({ payload: recipePayload(['p1', 'p2', 'p3']) });

    await processClaimedJob(deps, job);

    const infoCalls = (deps.logger.info as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, Record<string, unknown>]
    >;
    const completed = infoCalls.find((c) => c[0] === 'receta completada');
    expect(completed?.[1]).toMatchObject({ steps: 3, inputTokens: 6, outputTokens: 9 });
    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('job-1');
  });

  it('limite de contexto acumulado: un historial que supera el tope corta con fallo claro', async () => {
    // Cada paso genera ~120k chars; el historial acumulado supera 200k al armar el paso 3.
    const big = 'x'.repeat(120_000);
    const deps = makeDeps({ runAgent: runAgentSequence([big, big, big]) });
    const job = makeJob({ payload: recipePayload(['p1', 'p2', 'p3']), attempts: 1 });

    await processClaimedJob(deps, job);

    // Pasos 1 y 2 se ensamblan; el 3 se corta ANTES de llamar al modelo.
    expect(deps.assembleAgentRun).toHaveBeenCalledTimes(2);
    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    const reason = String(callArgs(deps.jobs.markPendingRetry)[1]);
    expect(reason).toContain('limite de contexto acumulado');
    expect(reason).toContain('paso 3');
    expect(deps.jobs.markCompleted).not.toHaveBeenCalled();
  });

  it('payload de receta malformado (kind:recipe pero sin pasos) -> fallo del intento, sin ensamblar', async () => {
    const deps = makeDeps();
    const job = makeJob({ payload: { kind: 'recipe', recipeId: 'r1', steps: [] }, attempts: 1 });

    await processClaimedJob(deps, job);

    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(String(callArgs(deps.jobs.markPendingRetry)[1])).toContain('payload de receta invalido');
    expect(deps.assembleAgentRun).not.toHaveBeenCalled();
  });

  it('el gate por tier aplica al job de receta UNA vez, antes del bucle: owner no autonomous -> failed', async () => {
    const deps = makeDeps({ getProfileTier: vi.fn(async () => 'free' as const) });
    const job = makeJob({ payload: recipePayload(['p1', 'p2']), attempts: 1 });

    await processClaimedJob(deps, job);

    expect(deps.jobs.markFailed).toHaveBeenCalledTimes(1);
    expect(String(callArgs(deps.jobs.markFailed)[1])).toContain('autonomous');
    // Fallo permanente antes de ramificar: ni siquiera se ensambla ni se corre un paso.
    expect(deps.jobs.markPendingRetry).not.toHaveBeenCalled();
    expect(deps.assembleAgentRun).not.toHaveBeenCalled();
    expect(deps.runAgent).not.toHaveBeenCalled();
  });

  it('apagado ENTRE pasos: el paso en curso termina y el siguiente no arranca; job vuelve a pending', async () => {
    const controller = new AbortController();
    // El paso 1 completa (emite su stop); recien despues del ultimo yield llega el apagado, asi el
    // guard del paso 2 lo detecta y corta sin dejar el job running huerfano.
    const runAgent = vi.fn(
      () =>
        (async function* (): AsyncIterable<AgentEvent> {
          yield { type: 'text_delta', text: 'salida-1' };
          yield { type: 'stop', reason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };
          controller.abort();
        })(),
    );
    const deps = makeDeps({ runAgent });
    // attempts agotados: aun asi el apagado NO debe marcar failed.
    const job = makeJob({ payload: recipePayload(['p1', 'p2', 'p3']), attempts: MAX_ATTEMPTS });

    await processClaimedJob(deps, job, controller.signal);

    expect(deps.assembleAgentRun).toHaveBeenCalledTimes(1); // solo el paso 1
    expect(deps.jobs.markPendingRetry).toHaveBeenCalledTimes(1);
    expect(deps.jobs.markFailed).not.toHaveBeenCalled();
    expect(deps.jobs.markCompleted).not.toHaveBeenCalled();
  });

  it('no-regresion: un job SIMPLE (sin kind:recipe) no entra al bucle -> ejecuta una sola vez', async () => {
    const deps = makeDeps();
    const job = makeJob(); // payload simple { messages: [...] }

    await processClaimedJob(deps, job);

    expect(deps.assembleAgentRun).toHaveBeenCalledTimes(1);
    expect(deps.runAgent).toHaveBeenCalledTimes(1);
    expect(assembledMessages(deps.assembleAgentRun, 0)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hola' }] },
    ]);
    expect(deps.jobs.markCompleted).toHaveBeenCalledWith('job-1');
    expect(deps.jobs.markFailed).not.toHaveBeenCalled();
    expect(deps.jobs.markPendingRetry).not.toHaveBeenCalled();
  });
});
