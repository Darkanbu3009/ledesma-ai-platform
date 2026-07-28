import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { jobsRoutes } from '../src/routes/jobs.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '99999999-9999-4999-8999-999999999999';

// Verifier falso (sin red): user-1 y user-2 validos; cualquier otro token invalido.
const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    if (token === 'valid-user-2') return { id: 'user-2', email: 'u2@test.com' };
    throw new Error('invalid');
  },
};

const listByOwner = vi.fn();
const getSummaryForOwner = vi.fn();
const cancelarPorUsuario = vi.fn();
const borrarTerminalDeOwner = vi.fn();
const cerrarPendientePorCancelacion = vi.fn();
const registrarIntervencion = vi.fn();
const resumenDeGuardadoPorJobs = vi.fn();
const borrarPorJob = vi.fn();

/** Resumen de job tal como lo devuelve JobsRepository.listByOwner (camelCase, sin payload). */
function makeJobSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    agentId: AGENT_ID,
    status: 'completed',
    type: 'simple',
    attempts: 1,
    lastError: null,
    scheduledFor: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    startedAt: '2026-06-30T00:01:00.000Z',
    finishedAt: '2026-06-30T00:02:00.000Z',
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    jobsRoutes(config, {
      verifier,
      jobsRepo: { listByOwner, getSummaryForOwner, cancelarPorUsuario, borrarTerminalDeOwner },
      aprobacionesRepo: { cerrarPendientePorCancelacion, registrarIntervencion },
      trayectoriasRepo: { resumenDeGuardadoPorJobs, borrarPorJob },
    }),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  listByOwner.mockResolvedValue([]);
  getSummaryForOwner.mockResolvedValue(null);
  cancelarPorUsuario.mockResolvedValue({ resultado: 'no_encontrado' });
  borrarTerminalDeOwner.mockResolvedValue('no_encontrado');
  cerrarPendientePorCancelacion.mockResolvedValue(null);
  registrarIntervencion.mockResolvedValue(undefined);
  resumenDeGuardadoPorJobs.mockResolvedValue(new Map());
  borrarPorJob.mockResolvedValue(0);
  app = await makeApp();
});

describe('auth: GET /v1/jobs sin JWT', () => {
  it('sin Authorization -> 401 (no toca el repo)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/jobs' });
    expect(res.statusCode).toBe(401);
    expect(listByOwner).not.toHaveBeenCalled();
  });

  it('token invalido -> 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/jobs',
      headers: { authorization: 'Bearer no-sirve' },
    });
    expect(res.statusCode).toBe(401);
    expect(listByOwner).not.toHaveBeenCalled();
  });
});

describe('GET /v1/jobs: aislamiento por owner', () => {
  it('lista con el owner del token (user-1), defaults de paginacion', async () => {
    listByOwner.mockResolvedValue([makeJobSummary()]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/jobs',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(listByOwner).toHaveBeenCalledWith('user-1', { limit: 20, offset: 0, status: undefined });
    expect(res.json().jobs).toHaveLength(1);
  });

  it('otro usuario (user-2) solo lista lo suyo: el owner sale del token', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/jobs',
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(listByOwner).toHaveBeenCalledWith('user-2', { limit: 20, offset: 0, status: undefined });
  });
});

describe('GET /v1/jobs: paginacion', () => {
  it('respeta limit y offset del querystring', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/jobs?limit=10&offset=30',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(listByOwner).toHaveBeenCalledWith('user-1', { limit: 10, offset: 30, status: undefined });
  });

  it('limit > 50 (techo) -> 400 (no lista)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/jobs?limit=51',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(listByOwner).not.toHaveBeenCalled();
  });

  it('limit=50 (borde) es valido', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/jobs?limit=50',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(listByOwner).toHaveBeenCalledWith('user-1', { limit: 50, offset: 0, status: undefined });
  });

  it('limit=0 u offset negativo -> 400', async () => {
    const r1 = await app.inject({
      method: 'GET',
      url: '/v1/jobs?limit=0',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({
      method: 'GET',
      url: '/v1/jobs?offset=-1',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(r2.statusCode).toBe(400);
    expect(listByOwner).not.toHaveBeenCalled();
  });

  it('hasMore=true cuando la pagina viene LLENA (jobs.length === limit)', async () => {
    listByOwner.mockResolvedValue(Array.from({ length: 10 }, (_, i) => makeJobSummary({ id: `j-${i}` })));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/jobs?limit=10',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.json().pagination).toEqual({ limit: 10, offset: 0, hasMore: true });
  });

  it('hasMore=false cuando la pagina viene incompleta', async () => {
    listByOwner.mockResolvedValue([makeJobSummary(), makeJobSummary({ id: 'otro' })]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/jobs?limit=10',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.json().pagination).toEqual({ limit: 10, offset: 0, hasMore: false });
  });
});

describe('GET /v1/jobs: filtro por status', () => {
  it('status valido se pasa al repo', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/jobs?status=failed',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(listByOwner).toHaveBeenCalledWith('user-1', { limit: 20, offset: 0, status: 'failed' });
  });

  it('status invalido -> 400 (no lista)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/jobs?status=bogus',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(listByOwner).not.toHaveBeenCalled();
  });
});

describe('GET /v1/jobs: last_error truncado y sin payload', () => {
  it('trunca last_error largo a 500 chars + marcador', async () => {
    const largo = 'x'.repeat(600);
    listByOwner.mockResolvedValue([makeJobSummary({ status: 'failed', lastError: largo })]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/jobs',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    const job = res.json().jobs[0];
    expect(job.lastError).toBe(`${'x'.repeat(500)}...`);
    expect(job.lastError.length).toBe(503);
  });

  it('last_error corto pasa sin recortar; null se conserva', async () => {
    listByOwner.mockResolvedValue([
      makeJobSummary({ id: 'a', status: 'failed', lastError: 'boom' }),
      makeJobSummary({ id: 'b', status: 'completed', lastError: null }),
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/jobs',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    const [a, b] = res.json().jobs;
    expect(a.lastError).toBe('boom');
    expect(b.lastError).toBeNull();
  });

  it('la respuesta NO incluye el payload y devuelve el tipo inferido', async () => {
    listByOwner.mockResolvedValue([makeJobSummary({ type: 'recipe' })]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/jobs',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    const job = res.json().jobs[0];
    expect(job).not.toHaveProperty('payload');
    expect(job).not.toHaveProperty('ownerId');
    expect(job.type).toBe('recipe');
    // Campos que si expone el historial.
    expect(job).toMatchObject({
      id: JOB_ID,
      agentId: AGENT_ID,
      status: 'completed',
      attempts: 1,
      createdAt: '2026-06-30T00:00:00.000Z',
    });
  });
});

describe('GET /v1/jobs/:id: detalle para polling', () => {
  it('sin JWT -> 401 (no toca el repo)', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/jobs/${JOB_ID}` });
    expect(res.statusCode).toBe(401);
    expect(getSummaryForOwner).not.toHaveBeenCalled();
  });

  it('devuelve el job del owner con el mismo DTO seguro del listado (sin payload)', async () => {
    getSummaryForOwner.mockResolvedValue(makeJobSummary({ type: 'sitio', agentId: null }));
    const res = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${JOB_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(getSummaryForOwner).toHaveBeenCalledWith(JOB_ID, 'user-1');
    const { job } = res.json();
    expect(job).not.toHaveProperty('payload');
    expect(job).not.toHaveProperty('ownerId');
    expect(job).toMatchObject({ id: JOB_ID, type: 'sitio', agentId: null, status: 'completed' });
  });

  it('job ajeno o inexistente -> 404 (el repo devuelve null)', async () => {
    getSummaryForOwner.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${JOB_ID}`,
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(res.statusCode).toBe(404);
    expect(getSummaryForOwner).toHaveBeenCalledWith(JOB_ID, 'user-2');
  });

  it('id no-uuid -> 400 (no consulta)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/jobs/no-es-uuid',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(getSummaryForOwner).not.toHaveBeenCalled();
  });

  it('trunca last_error largo tambien en el detalle', async () => {
    getSummaryForOwner.mockResolvedValue(makeJobSummary({ lastError: 'x'.repeat(600), status: 'failed' }));
    const res = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${JOB_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.json().job.lastError).toBe(`${'x'.repeat(500)}...`);
  });
});

describe('POST /v1/jobs/:id/cancelar (terminar desde la consola)', () => {
  it('sin JWT -> 401 (no toca el repo)', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/jobs/${JOB_ID}/cancelar` });
    expect(res.statusCode).toBe(401);
    expect(cancelarPorUsuario).not.toHaveBeenCalled();
  });

  it('id no-uuid -> 400 (no consulta)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/no-es-uuid/cancelar',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(cancelarPorUsuario).not.toHaveBeenCalled();
  });

  it('cancela un job running propio: 200 con el DTO seguro y sin tocar aprobaciones', async () => {
    cancelarPorUsuario.mockResolvedValue({ resultado: 'cancelado', estadoPrevio: 'running' });
    getSummaryForOwner.mockResolvedValue(
      makeJobSummary({ status: 'failed', lastError: 'CANCELADO_POR_USUARIO: terminada por el usuario' }),
    );
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${JOB_ID}/cancelar`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    // El owner SIEMPRE sale del token, jamas del cliente.
    expect(cancelarPorUsuario).toHaveBeenCalledWith(JOB_ID, 'user-1');
    expect(res.json().job).toMatchObject({
      id: JOB_ID,
      status: 'failed',
      lastError: 'CANCELADO_POR_USUARIO: terminada por el usuario',
    });
    expect(res.json().job.payload).toBeUndefined();
    expect(cerrarPendientePorCancelacion).not.toHaveBeenCalled();
  });

  it('cancelar un job pausado ademas cierra su aprobacion pendiente con constancia Art.22', async () => {
    cancelarPorUsuario.mockResolvedValue({ resultado: 'cancelado', estadoPrevio: 'pausado' });
    cerrarPendientePorCancelacion.mockResolvedValue({
      id: 'apr-1',
      ownerId: 'user-1',
      jobId: JOB_ID,
      connectionId: 'conn-1',
      sesionExternaId: 'ses-1',
      accionTipo: 'financiera',
      descripcion: 'Enviar el pago',
      screenshotPath: 'user-1/apr-1.png',
      estado: 'rechazada',
      instruccionRechazo: 'cancelada por el usuario: la tarea se termino desde la consola',
      decididaPor: 'user-1',
      decididaEn: '2026-07-24T00:00:00.000Z',
      creadaEn: '2026-07-24T00:00:00.000Z',
      expiraEn: '2026-07-24T00:15:00.000Z',
    });
    getSummaryForOwner.mockResolvedValue(makeJobSummary({ status: 'failed' }));
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${JOB_ID}/cancelar`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(cerrarPendientePorCancelacion).toHaveBeenCalledWith(JOB_ID, 'user-1', 'user-1');
    expect(registrarIntervencion).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'rechazada', decididaPor: 'user-1', aprobacionId: 'apr-1' }),
    );
  });

  it('cancelar un job ya terminado -> 409 CONFLICT, sin efectos', async () => {
    cancelarPorUsuario.mockResolvedValue({ resultado: 'conflicto' });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${JOB_ID}/cancelar`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(409);
    expect(cerrarPendientePorCancelacion).not.toHaveBeenCalled();
    expect(getSummaryForOwner).not.toHaveBeenCalled();
  });

  it('un usuario NO puede cancelar un job de otro owner: 404 sin revelar nada', async () => {
    // El repo, acotado por owner_id, responde no_encontrado para el job ajeno.
    cancelarPorUsuario.mockResolvedValue({ resultado: 'no_encontrado' });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${JOB_ID}/cancelar`,
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(res.statusCode).toBe(404);
    // La cancelacion viajo con el owner del token (user-2), no con el dueno real del job.
    expect(cancelarPorUsuario).toHaveBeenCalledWith(JOB_ID, 'user-2');
    expect(cerrarPendientePorCancelacion).not.toHaveBeenCalled();
  });
});

describe('DELETE /v1/jobs/:id (eliminar una actividad terminada)', () => {
  function del(id: string = JOB_ID, token: string | null = 'valid-user-1') {
    return app.inject({
      method: 'DELETE',
      url: `/v1/jobs/${id}`,
      ...(token !== null ? { headers: { authorization: `Bearer ${token}` } } : {}),
    });
  }

  it('sin token: 401 y no se toca ningun repositorio', async () => {
    const res = await del(JOB_ID, null);
    expect(res.statusCode).toBe(401);
    expect(borrarTerminalDeOwner).not.toHaveBeenCalled();
    expect(borrarPorJob).not.toHaveBeenCalled();
  });

  it('borra un job terminal PROPIO junto con su registro de trayectorias y responde 204', async () => {
    borrarTerminalDeOwner.mockResolvedValue('borrado');
    borrarPorJob.mockResolvedValue(1);
    const res = await del();
    expect(res.statusCode).toBe(204);
    // Ownership por owner_id a nivel de query: el owner sale SIEMPRE del token.
    expect(borrarTerminalDeOwner).toHaveBeenCalledWith(JOB_ID, 'user-1');
    expect(borrarPorJob).toHaveBeenCalledWith(JOB_ID, 'user-1');
  });

  it('un job ajeno responde 404 sin revelar nada y sin borrar trayectorias', async () => {
    // El repo, acotado por owner_id, responde no_encontrado para el job ajeno.
    borrarTerminalDeOwner.mockResolvedValue('no_encontrado');
    const res = await del(JOB_ID, 'valid-user-2');
    expect(res.statusCode).toBe(404);
    expect(borrarTerminalDeOwner).toHaveBeenCalledWith(JOB_ID, 'user-2');
    expect(borrarPorJob).not.toHaveBeenCalled();
  });

  it('un job en estado NO terminal (en vuelo) responde 409 y no borra nada', async () => {
    borrarTerminalDeOwner.mockResolvedValue('no_terminal');
    const res = await del();
    expect(res.statusCode).toBe(409);
    expect(borrarPorJob).not.toHaveBeenCalled();
  });

  it('DOBLE BORRADO: el segundo DELETE del mismo id responde 404 (idempotencia)', async () => {
    borrarTerminalDeOwner.mockResolvedValueOnce('borrado').mockResolvedValueOnce('no_encontrado');
    const primero = await del();
    const segundo = await del();
    expect(primero.statusCode).toBe(204);
    expect(segundo.statusCode).toBe(404);
    // El borrado de trayectorias corrio solo la primera vez.
    expect(borrarPorJob).toHaveBeenCalledTimes(1);
  });

  it('LA RECETA DERIVADA SOBREVIVE: la ruta no recibe ni toca ningun repositorio de recetas', async () => {
    // Garantia estructural: jobsRoutes no tiene acceso a recetas_web; el borrado solo alcanza el job
    // (borrarTerminalDeOwner) y sus trayectorias (borrarPorJob, cuya query no toca recetas_web y
    // cuyo vinculo creada_desde_trayectoria es una referencia de auditoria SIN FK, V035).
    borrarTerminalDeOwner.mockResolvedValue('borrado');
    const res = await del();
    expect(res.statusCode).toBe(204);
    expect(borrarPorJob).toHaveBeenCalledWith(JOB_ID, 'user-1');
  });

  it('un id que no es un uuid se rechaza antes de tocar la base', async () => {
    const res = await del('no-soy-un-uuid');
    expect(res.statusCode).toBe(400);
    expect(borrarTerminalDeOwner).not.toHaveBeenCalled();
  });
});
