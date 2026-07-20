import { describe, it, expect, vi } from 'vitest';
import type { Job, JobConsulta } from '@ledesma-platform/shared';
import {
  BLOQUE_SEPARACION_INSTRUCCION_CONTENIDO,
  createSitioToolsExecutor,
  sitioToolsToDefinitions,
  SITIO_TOOL_EJECUTAR,
  SITIO_TOOL_NAMES,
  SITIO_TOOL_REVISAR,
} from '../src/tools/sitio-tools.js';
import type { SitioToolsDeps } from '../src/tools/sitio-tools.js';
import type { SitioConectado } from '../src/sitios/sitios-conectados-repository.js';
import { assembleAgentRun } from '../src/execution/assemble-agent-run.js';
import type { AgentConfig } from '../src/agents/types.js';
import type { NormalizedMessage } from '@ledesma-platform/shared';

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const CTX = { ownerId: 'user-1', agentId: 'agent-1', credentialId: 'cred-1' };

function makeSitio(overrides: Partial<SitioConectado> = {}): SitioConectado {
  return {
    id: CONNECTION_ID,
    ownerId: 'user-1',
    dominio: 'app.ejemplo.com',
    urlLogin: null,
    contextoExternoId: 'ctx-1',
    proxyRef: 'browserbase',
    egressIp: '203.0.113.7',
    fingerprintRef: null,
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

function makeJobRow(overrides: Partial<Job> = {}): Job {
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
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function makeDeps(overrides: {
  sitio?: SitioConectado | null;
  consulta?: JobConsulta | null;
} = {}): SitioToolsDeps {
  return {
    jobs: {
      createJob: vi.fn(async () => makeJobRow()),
      obtenerJobDeOwner: vi.fn(async () => overrides.consulta ?? null),
    },
    sitios: {
      obtenerPorId: vi.fn(async () => (overrides.sitio === undefined ? makeSitio() : overrides.sitio)),
    },
  };
}

function call(name: string, input: Record<string, unknown>) {
  return { id: 'tu-1', name, input };
}

describe('platform_ejecutar_tarea_en_sitio', () => {
  it('encola tarea_web con la tenancy del LLAMADOR (jamas del modelo) y devuelve job_id', async () => {
    const deps = makeDeps();
    const exec = createSitioToolsExecutor(CTX, deps);
    const res = await exec(call(SITIO_TOOL_EJECUTAR, { connection_id: CONNECTION_ID, objetivo: 'lee mi panel' }));
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content)).toMatchObject({ job_id: 'job-1', estado: 'encolada' });
    expect(deps.jobs.createJob).toHaveBeenCalledWith({
      agentId: 'agent-1',
      ownerId: 'user-1',
      credentialId: 'cred-1',
      payload: { kind: 'tarea_web', connectionId: CONNECTION_ID, objetivo: 'lee mi panel' },
    });
  });

  it('sitio no activo: error accionable SIN encolar nada', async () => {
    const deps = makeDeps({ sitio: makeSitio({ estado: 'caducado' }) });
    const exec = createSitioToolsExecutor(CTX, deps);
    const res = await exec(call(SITIO_TOOL_EJECUTAR, { connection_id: CONNECTION_ID, objetivo: 'lee mi panel' }));
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/no esta conectado o la sesion caduco/);
    expect(deps.jobs.createJob).not.toHaveBeenCalled();
  });

  it('sitio inexistente o ajeno (repo devuelve null): mismo error accionable', async () => {
    const deps = makeDeps({ sitio: null });
    const exec = createSitioToolsExecutor(CTX, deps);
    const res = await exec(call(SITIO_TOOL_EJECUTAR, { connection_id: CONNECTION_ID, objetivo: 'x' }));
    expect(res.isError).toBe(true);
    expect(deps.jobs.createJob).not.toHaveBeenCalled();
  });

  it('input invalido del modelo: error sin tocar la base', async () => {
    const deps = makeDeps();
    const exec = createSitioToolsExecutor(CTX, deps);
    const res = await exec(call(SITIO_TOOL_EJECUTAR, { objetivo: '' }));
    expect(res.isError).toBe(true);
    expect(deps.sitios.obtenerPorId).not.toHaveBeenCalled();
  });

  it('fallo de infraestructura: NUNCA lanza, devuelve isError sin detalle interno', async () => {
    const deps = makeDeps();
    (deps.sitios.obtenerPorId as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db caida secreta'));
    const exec = createSitioToolsExecutor(CTX, deps);
    const res = await exec(call(SITIO_TOOL_EJECUTAR, { connection_id: CONNECTION_ID, objetivo: 'x' }));
    expect(res.isError).toBe(true);
    expect(res.content).not.toContain('db caida secreta');
  });
});

describe('platform_revisar_tarea_en_sitio', () => {
  it('en proceso mientras el job esta pending/running', async () => {
    const deps = makeDeps({ consulta: { id: 'job-1', status: 'running', resultado: null, lastError: null } });
    const exec = createSitioToolsExecutor(CTX, deps);
    const res = await exec(call(SITIO_TOOL_REVISAR, { job_id: 'job-1' }));
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content).estado).toBe('en_proceso');
  });

  it('devuelve el resultado guardado cuando el job completo', async () => {
    const deps = makeDeps({
      consulta: {
        id: 'job-1',
        status: 'completed',
        resultado: { estado: 'ok', resumen: 'el panel muestra 3 agentes' },
        lastError: null,
      },
    });
    const exec = createSitioToolsExecutor(CTX, deps);
    const res = await exec(call(SITIO_TOOL_REVISAR, { job_id: 'job-1' }));
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content)).toEqual({
      estado: 'completada',
      resultado: { estado: 'ok', resumen: 'el panel muestra 3 agentes' },
    });
    expect(deps.jobs.obtenerJobDeOwner).toHaveBeenCalledWith('job-1', 'user-1');
  });

  it('job fallido: devuelve el detalle como error', async () => {
    const deps = makeDeps({
      consulta: { id: 'job-1', status: 'failed', resultado: null, lastError: 'la sesion caduco' },
    });
    const exec = createSitioToolsExecutor(CTX, deps);
    const res = await exec(call(SITIO_TOOL_REVISAR, { job_id: 'job-1' }));
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content).detalle).toBe('la sesion caduco');
  });

  it('job inexistente o de otro owner: error sin filtrar nada', async () => {
    const deps = makeDeps({ consulta: null });
    const exec = createSitioToolsExecutor(CTX, deps);
    const res = await exec(call(SITIO_TOOL_REVISAR, { job_id: 'job-ajeno' }));
    expect(res.isError).toBe(true);
  });
});

// --- Integracion con el ensamblado -------------------------------------------------------------

const baseAgent: AgentConfig = {
  id: 'a1',
  name: 'Asistente',
  description: '',
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
  systemPrompt: 'Eres asistente',
  maxTokens: 512,
  temperature: null,
  baseUrl: null,
  tools: [],
  webhookSecret: 'whsec_secreto_del_agente_0123456789abcdef',
  ownerId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const messages: NormalizedMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }];

describe('assembleAgentRun con tools de sitios (7.1d)', () => {
  it('con contexto de sitios inyecta las dos tools y appendea la separacion instruccion-vs-contenido', () => {
    const { input } = assembleAgentRun({
      agent: baseAgent,
      credential: { apiKey: 'sk-test' },
      messages,
      nativeTools: {},
      limits: { maxTokens: 9000, runTimeoutMs: 30_000 },
      sitios: { context: CTX, deps: makeDeps() },
    });
    const names = (input.request.tools ?? []).map((t) => t.name);
    expect(names).toContain(SITIO_TOOL_EJECUTAR);
    expect(names).toContain(SITIO_TOOL_REVISAR);
    expect(input.request.system).toContain('Eres asistente');
    expect(input.request.system).toContain('CONTENIDO NO CONFIABLE');
    expect(input.request.system).toContain(BLOQUE_SEPARACION_INSTRUCCION_CONTENIDO.trim());
  });

  it('sin contexto de sitios el ensamblado queda EXACTAMENTE como antes (aditivo)', () => {
    const { input } = assembleAgentRun({
      agent: baseAgent,
      credential: { apiKey: 'sk-test' },
      messages,
      nativeTools: {},
      limits: { maxTokens: 9000, runTimeoutMs: 30_000 },
    });
    const names = (input.request.tools ?? []).map((t) => t.name);
    expect(names).not.toContain(SITIO_TOOL_EJECUTAR);
    expect(input.request.system).toBe('Eres asistente');
  });

  it('el dispatch enruta las tools de sitios a su ejecutor', async () => {
    const deps = makeDeps();
    const { executeTool } = assembleAgentRun({
      agent: baseAgent,
      credential: { apiKey: 'sk-test' },
      messages,
      nativeTools: {},
      limits: { maxTokens: 9000, runTimeoutMs: 30_000 },
      sitios: { context: CTX, deps },
    });
    const res = await executeTool(call(SITIO_TOOL_EJECUTAR, { connection_id: CONNECTION_ID, objetivo: 'lee mi panel' }));
    expect(res.isError).toBe(false);
    expect(deps.jobs.createJob).toHaveBeenCalled();
  });

  it('los nombres reservados de sitios quedan cubiertos por el set de dispatch', () => {
    expect(SITIO_TOOL_NAMES.has(SITIO_TOOL_EJECUTAR)).toBe(true);
    expect(SITIO_TOOL_NAMES.has(SITIO_TOOL_REVISAR)).toBe(true);
    expect(sitioToolsToDefinitions()).toHaveLength(2);
  });
});
