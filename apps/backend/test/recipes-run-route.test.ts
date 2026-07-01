import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { recipeRoutes } from '../src/routes/recipes.js';
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
const CRED_ID = '22222222-2222-4222-8222-222222222222';
const RECIPE_ID = '99999999-9999-4999-8999-999999999999';

// Verifier falso (sin red): user-1 y user-2 validos; cualquier otro token invalido.
const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    if (token === 'valid-user-2') return { id: 'user-2', email: 'u2@test.com' };
    throw new Error('invalid');
  },
};

const getRecipeForOwner = vi.fn();
const markRunNow = vi.fn();
const getProfileTier = vi.fn();
const createJob = vi.fn();

function makeRecipe(overrides: Record<string, unknown> = {}) {
  return {
    id: RECIPE_ID,
    ownerId: 'user-1',
    agentId: AGENT_ID,
    credentialId: CRED_ID,
    name: 'Reporte diario',
    description: 'genera el reporte',
    steps: [{ message: 'paso 1' }, { message: 'paso 2' }],
    isActive: true,
    lastRunAt: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    recipeRoutes(config, {
      verifier,
      // Solo se usan los repos que toca /run; el resto del CRUD se prueba en recipes-route.test.ts.
      recipeRepo: {
        createRecipe: vi.fn(),
        listRecipesByOwner: vi.fn(),
        getRecipeForOwner,
        updateRecipeForOwner: vi.fn(),
        deleteRecipeForOwner: vi.fn(),
        markRunNow,
      },
      agentRepo: { getByIdForOwner: vi.fn() },
      credentialRepo: { existsForOwner: vi.fn() },
      registrationRepo: { getProfileTier },
      jobsRepo: { createJob },
    }),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  // Defaults felices: tier autonomous, receta activa del owner, job encolado con id.
  getProfileTier.mockResolvedValue('autonomous');
  getRecipeForOwner.mockResolvedValue(makeRecipe());
  markRunNow.mockResolvedValue(undefined);
  createJob.mockResolvedValue({ id: 'job-1' });
  app = await makeApp();
});

describe('POST /v1/recipes/:id/run — auth', () => {
  it('sin Authorization -> 401 (no encola)', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/recipes/${RECIPE_ID}/run` });
    expect(res.statusCode).toBe(401);
    expect(createJob).not.toHaveBeenCalled();
  });
});

describe('POST /v1/recipes/:id/run — encolado', () => {
  it('tier autonomous + receta activa -> 202 y encola el job de receta correcto', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/recipes/${RECIPE_ID}/run`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'accepted', jobId: 'job-1' });

    expect(createJob).toHaveBeenCalledTimes(1);
    const job = createJob.mock.calls[0]?.[0];
    // Datos de la receta para que el worker la ejecute (mismo patron que scheduler/triggers).
    expect(job.agentId).toBe(AGENT_ID);
    expect(job.ownerId).toBe('user-1'); // owner del token, jamas del body
    expect(job.credentialId).toBe(CRED_ID);
    expect(job.scheduledFor).toBeUndefined(); // ASAP
    // payload = shape de receta (buildRecipeJobPayload): kind 'recipe', recipeId, steps ordenados.
    expect(job.payload).toEqual({
      kind: 'recipe',
      recipeId: RECIPE_ID,
      steps: [{ message: 'paso 1' }, { message: 'paso 2' }],
    });
    // Marca last_run_at acotado al owner, DESPUES de encolar.
    expect(markRunNow).toHaveBeenCalledWith(RECIPE_ID, 'user-1');
    expect(getRecipeForOwner).toHaveBeenCalledWith(RECIPE_ID, 'user-1');
  });

  it('preserva el ORDEN de los pasos en el payload', async () => {
    getRecipeForOwner.mockResolvedValue(
      makeRecipe({ steps: [{ message: 'a' }, { message: 'b' }, { message: 'c' }] }),
    );
    const res = await app.inject({
      method: 'POST',
      url: `/v1/recipes/${RECIPE_ID}/run`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(202);
    const job = createJob.mock.calls[0]?.[0];
    expect(job.payload.steps.map((s: { message: string }) => s.message)).toEqual(['a', 'b', 'c']);
  });
});

describe('POST /v1/recipes/:id/run — gate por tier', () => {
  it('sin tier autonomous (pro) -> 403 (no resuelve la receta ni encola)', async () => {
    getProfileTier.mockResolvedValue('pro');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/recipes/${RECIPE_ID}/run`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(getRecipeForOwner).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
    expect(markRunNow).not.toHaveBeenCalled();
  });

  it('tier free (sin registro / null) -> 403', async () => {
    getProfileTier.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/recipes/${RECIPE_ID}/run`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(403);
    expect(createJob).not.toHaveBeenCalled();
  });
});

describe('POST /v1/recipes/:id/run — pertenencia y estado', () => {
  it('receta ajena/inexistente -> 404 (no encola)', async () => {
    getRecipeForOwner.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/recipes/${RECIPE_ID}/run`,
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(getRecipeForOwner).toHaveBeenCalledWith(RECIPE_ID, 'user-2');
    expect(createJob).not.toHaveBeenCalled();
    expect(markRunNow).not.toHaveBeenCalled();
  });

  it('receta pausada (is_active=false) -> 400 claro (no encola)', async () => {
    getRecipeForOwner.mockResolvedValue(makeRecipe({ isActive: false }));
    const res = await app.inject({
      method: 'POST',
      url: `/v1/recipes/${RECIPE_ID}/run`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(createJob).not.toHaveBeenCalled();
    expect(markRunNow).not.toHaveBeenCalled();
  });

  it('receta con datos corruptos (0 pasos validos) -> 500 y NO encola (fail-fast defensivo)', async () => {
    // Escenario solo alcanzable por corrupcion de datos: la API y el CHECK de la base exigen >= 1 paso.
    getRecipeForOwner.mockResolvedValue(makeRecipe({ steps: [] }));
    const res = await app.inject({
      method: 'POST',
      url: `/v1/recipes/${RECIPE_ID}/run`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(500);
    expect(createJob).not.toHaveBeenCalled();
    expect(markRunNow).not.toHaveBeenCalled();
  });

  it('id no-uuid -> 400 (no toca repos)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recipes/no-es-uuid/run',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(getProfileTier).not.toHaveBeenCalled();
    expect(getRecipeForOwner).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });
});
