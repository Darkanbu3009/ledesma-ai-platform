import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { tareasEnsenadasRoutes } from '../src/routes/tareas-ensenadas.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';
import type { RecetaWeb } from '../src/recetas-web/index.js';

/**
 * TAREAS QUE EL SISTEMA YA SABE HACER (recetas_web), para la consola. Lo que estos tests fijan:
 *
 *  - pertenencia SIEMPRE por el token (sin token no se toca el repositorio);
 *  - el DTO expone lo que una persona necesita para reconocer la tarea y NUNCA los pasos (el
 *    procedimiento interno no significa nada para quien no programa, y es lo unico que podria
 *    arrastrar detalle tecnico a la pantalla);
 *  - borrar una tarea que no es del usuario responde 404, igual que una que no existe.
 *
 * NO es /v1/recipes (V013): esa ruta y esa tabla siguen intactas y son otra funcionalidad.
 */

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const RECETA_ID = '99999999-9999-4999-8999-999999999999';

const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    throw new Error('invalid');
  },
};

const listarActivas = vi.fn();
const borrar = vi.fn();
const buscarPorTrayectorias = vi.fn();
const getSummaryForOwner = vi.fn();
const createJob = vi.fn();
const listarPorJob = vi.fn();
const getProfileTier = vi.fn();

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const JOB_PROMOCION_ID = '22222222-2222-4222-8222-222222222222';
const TRAY_ID = '33333333-3333-4333-8333-333333333333';

function makeJobSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    agentId: null,
    status: 'completed',
    type: 'tarea_web',
    attempts: 1,
    lastError: null,
    scheduledFor: null,
    createdAt: '2026-07-26T18:00:00.000Z',
    startedAt: '2026-07-26T18:00:00.000Z',
    finishedAt: '2026-07-26T18:05:00.000Z',
    conLoAprendido: false,
    ajustadaSola: false,
    ...overrides,
  };
}

function makeTrayectoria(overrides: Record<string, unknown> = {}) {
  return {
    id: TRAY_ID,
    ownerId: 'user-1',
    jobId: JOB_ID,
    connectionId: 'conn-1',
    dominio: 'correo.ejemplo.com',
    objetivo: 'enviar el reporte',
    estado: 'exitosa',
    iniciadaEn: '2026-07-26T18:00:00.000Z',
    terminadaEn: '2026-07-26T18:05:00.000Z',
    duracionMs: 300_000,
    tokensIn: null,
    tokensOut: null,
    creadaEn: '2026-07-26T18:00:00.000Z',
    ...overrides,
  };
}

function makeReceta(overrides: Partial<RecetaWeb> = {}): RecetaWeb {
  return {
    id: RECETA_ID,
    ownerId: 'user-1',
    dominio: 'correo.ejemplo.com',
    firmaObjetivo: 'enviar un correo a <destinatario>',
    descripcion: 'enviar el reporte semanal a mi jefe',
    version: 1,
    estado: 'activa',
    origen: 'grabacion',
    pasos: [
      {
        idx: 0,
        accion: 'escribir',
        dominio: null,
        estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'to' }],
        valor: { tipo: 'parametro', parametro: 'destinatario' },
        teclas: null,
        ruta: null,
        esperaMs: null,
      },
      {
        idx: 1,
        accion: 'click',
        dominio: null,
        estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'enviar' }],
        valor: null,
        teclas: null,
        ruta: null,
        esperaMs: null,
      },
    ],
    creadaDesdeTrayectoria: null,
    ejecucionesExitosas: 3,
    ejecucionesFallidas: 0,
    ajustesAutomaticos: 0,
    ultimaEjecucionEn: '2026-07-25T10:00:00.000Z',
    creadaEn: '2026-07-20T00:00:00.000Z',
    actualizadaEn: '2026-07-25T10:00:00.000Z',
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    tareasEnsenadasRoutes(config, {
      verifier,
      recetasRepo: { listarActivas, borrar, buscarPorTrayectorias },
      jobsRepo: { getSummaryForOwner, createJob },
      trayectoriasRepo: { listarPorJob },
      registrationRepo: { getProfileTier },
    }),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  listarActivas.mockResolvedValue([]);
  borrar.mockResolvedValue(true);
  buscarPorTrayectorias.mockResolvedValue(null);
  getSummaryForOwner.mockResolvedValue(makeJobSummary());
  createJob.mockResolvedValue({ id: JOB_PROMOCION_ID });
  listarPorJob.mockResolvedValue([makeTrayectoria()]);
  getProfileTier.mockResolvedValue('pro');
  app = await makeApp();
});

describe('GET /v1/tareas-ensenadas', () => {
  it('sin token: 401 y el repositorio ni se toca', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tareas-ensenadas' });
    expect(res.statusCode).toBe(401);
    expect(listarActivas).not.toHaveBeenCalled();
  });

  it('lista las del usuario del token y nunca las de otro', async () => {
    listarActivas.mockResolvedValue([makeReceta()]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tareas-ensenadas',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(listarActivas).toHaveBeenCalledWith('user-1');
    expect(res.json()).toEqual({
      tareas: [
        {
          id: RECETA_ID,
          dominio: 'correo.ejemplo.com',
          descripcion: 'enviar el reporte semanal a mi jefe',
          ensenadaEn: '2026-07-20T00:00:00.000Z',
          usos: 3,
          ultimoUsoEn: '2026-07-25T10:00:00.000Z',
          ajustes: 0,
          datosQueNecesita: ['destinatario'],
        },
      ],
    });
  });

  it('NUNCA expone los pasos ni la firma: el procedimiento interno no sale de la base', async () => {
    listarActivas.mockResolvedValue([makeReceta()]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tareas-ensenadas',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    const cuerpo = res.body;
    expect(cuerpo).not.toContain('pasos');
    expect(cuerpo).not.toContain('estrategias');
    expect(cuerpo).not.toContain('firma');
    expect(cuerpo).not.toContain('ownerId');
  });

  it('una tarea aprendida sola (sin texto del usuario) viaja con descripcion null', async () => {
    listarActivas.mockResolvedValue([makeReceta({ descripcion: null })]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tareas-ensenadas',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.json().tareas[0].descripcion).toBeNull();
  });
});

describe('POST /v1/tareas-ensenadas/desde-job (guardar como tarea aprendida)', () => {
  function post(jobId: string = JOB_ID, token: string | null = 'valid-user-1') {
    return app.inject({
      method: 'POST',
      url: '/v1/tareas-ensenadas/desde-job',
      ...(token !== null ? { headers: { authorization: `Bearer ${token}` } } : {}),
      payload: { jobId },
    });
  }

  it('sin token: 401 y no se toca ningun repositorio', async () => {
    const res = await post(JOB_ID, null);
    expect(res.statusCode).toBe(401);
    expect(getSummaryForOwner).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('sin un plan con autonomia: 403 y no se encola nada', async () => {
    getProfileTier.mockResolvedValue('free');
    const res = await post();
    expect(res.statusCode).toBe(403);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('encola la promocion del job PROPIO y responde 202 con el job de conversion', async () => {
    const res = await post();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'accepted', jobId: JOB_PROMOCION_ID });
    // La pertenencia sale SIEMPRE del token, jamas del cliente.
    expect(getSummaryForOwner).toHaveBeenCalledWith(JOB_ID, 'user-1');
    expect(listarPorJob).toHaveBeenCalledWith(JOB_ID, 'user-1');
    expect(createJob).toHaveBeenCalledWith({
      agentId: null,
      ownerId: 'user-1',
      credentialId: null,
      payload: { kind: 'promover_trayectoria', jobId: JOB_ID },
    });
  });

  it('un job ajeno o inexistente responde 404 (no se distinguen) y no encola', async () => {
    getSummaryForOwner.mockResolvedValue(null);
    const res = await post();
    expect(res.statusCode).toBe(404);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('un job que no es una tarea web completada responde 400', async () => {
    getSummaryForOwner.mockResolvedValue(makeJobSummary({ status: 'failed' }));
    const res = await post();
    expect(res.statusCode).toBe(400);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('una tarea que corrio por receta no tiene nada nuevo que guardar: 400', async () => {
    getSummaryForOwner.mockResolvedValue(makeJobSummary({ conLoAprendido: true }));
    const res = await post();
    expect(res.statusCode).toBe(400);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('sin trayectoria exitosa registrada: 400', async () => {
    listarPorJob.mockResolvedValue([makeTrayectoria({ estado: 'fallida' })]);
    const res = await post();
    expect(res.statusCode).toBe(400);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('DOBLE GUARDADO: con una receta ya creada desde la trayectoria responde 409 sin encolar', async () => {
    buscarPorTrayectorias.mockResolvedValue(RECETA_ID);
    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(buscarPorTrayectorias).toHaveBeenCalledWith('user-1', [TRAY_ID]);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('un jobId que no es un uuid se rechaza antes de tocar la base', async () => {
    const res = await post('no-soy-un-uuid');
    expect(res.statusCode).toBe(400);
    expect(getSummaryForOwner).not.toHaveBeenCalled();
  });
});

describe('DELETE /v1/tareas-ensenadas/:id', () => {
  it('sin token: 401 y no se borra nada', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/v1/tareas-ensenadas/${RECETA_ID}` });
    expect(res.statusCode).toBe(401);
    expect(borrar).not.toHaveBeenCalled();
  });

  it('borra la del usuario del token y responde 204', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/tareas-ensenadas/${RECETA_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(204);
    expect(borrar).toHaveBeenCalledWith(RECETA_ID, 'user-1');
  });

  it('una tarea ajena o inexistente responde 404 (no se distinguen)', async () => {
    borrar.mockResolvedValue(false);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/tareas-ensenadas/${RECETA_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('un id que no es un uuid se rechaza antes de tocar la base', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/tareas-ensenadas/no-soy-un-uuid',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(borrar).not.toHaveBeenCalled();
  });
});
