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

const createRecipe = vi.fn();
const listRecipesByOwner = vi.fn();
const getRecipeForOwner = vi.fn();
const updateRecipeForOwner = vi.fn();
const deleteRecipeForOwner = vi.fn();
const markRunNow = vi.fn();
const getByIdForOwner = vi.fn();
const existsForOwner = vi.fn();
const getProfileTier = vi.fn();

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
      recipeRepo: { createRecipe, listRecipesByOwner, getRecipeForOwner, updateRecipeForOwner, deleteRecipeForOwner, markRunNow },
      agentRepo: { getByIdForOwner },
      credentialRepo: { existsForOwner },
      registrationRepo: { getProfileTier },
    }),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  // Defaults felices: autonomous, agente y credencial del owner.
  getProfileTier.mockResolvedValue('autonomous');
  getByIdForOwner.mockResolvedValue({ id: AGENT_ID, ownerId: 'user-1' });
  existsForOwner.mockResolvedValue(true);
  app = await makeApp();
});

const validBody = {
  agentId: AGENT_ID,
  credentialId: CRED_ID,
  name: 'Reporte diario',
  description: 'genera el reporte',
  steps: [{ message: 'paso 1' }, { message: 'paso 2' }],
};

describe('auth: /v1/recipes sin JWT', () => {
  it('POST sin Authorization -> 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/recipes', payload: validBody });
    expect(res.statusCode).toBe(401);
    expect(createRecipe).not.toHaveBeenCalled();
  });
  it('GET sin Authorization -> 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/recipes' });
    expect(res.statusCode).toBe(401);
  });
  it('GET :id sin Authorization -> 401', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/recipes/${RECIPE_ID}` });
    expect(res.statusCode).toBe(401);
  });
  it('DELETE sin Authorization -> 401', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/v1/recipes/${RECIPE_ID}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/recipes', () => {
  it('crea con tier autonomous: owner del token, 201', async () => {
    createRecipe.mockResolvedValue(makeRecipe());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recipes',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...validBody, ownerId: 'OTRO-MALICIOSO' },
    });
    expect(res.statusCode).toBe(201);
    const passed = createRecipe.mock.calls[0]?.[0];
    expect(passed.ownerId).toBe('user-1'); // owner del token, jamas del body
    expect(passed.agentId).toBe(AGENT_ID);
    expect(passed.credentialId).toBe(CRED_ID);
    expect(passed.name).toBe('Reporte diario');
    expect(passed.steps).toEqual([{ message: 'paso 1' }, { message: 'paso 2' }]);
    expect(res.json().recipe.id).toBe(RECIPE_ID);
  });

  it('GATE POR PLAN: un tier sin autonomia (free) -> 403 (no crea nada)', async () => {
    getProfileTier.mockResolvedValue('free');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recipes',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(createRecipe).not.toHaveBeenCalled();
  });

  it('tier pro (plan con autonomia) tambien crea: el gate deriva del modulo central, 201', async () => {
    getProfileTier.mockResolvedValue('pro');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recipes',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(201);
    expect(createRecipe).toHaveBeenCalledTimes(1);
  });

  it('tier free (sin registro) -> 403', async () => {
    getProfileTier.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recipes',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
    expect(createRecipe).not.toHaveBeenCalled();
  });

  it('steps vacio -> 400 (no toca repos de pertenencia ni crea)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recipes',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...validBody, steps: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(createRecipe).not.toHaveBeenCalled();
    expect(getByIdForOwner).not.toHaveBeenCalled();
  });

  it('un paso con message vacio -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recipes',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...validBody, steps: [{ message: '' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(createRecipe).not.toHaveBeenCalled();
  });

  it('sin name -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recipes',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { agentId: AGENT_ID, credentialId: CRED_ID, steps: [{ message: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(createRecipe).not.toHaveBeenCalled();
  });

  it('sin description es valido (opcional) -> 201', async () => {
    createRecipe.mockResolvedValue(makeRecipe({ description: null }));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recipes',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { agentId: AGENT_ID, credentialId: CRED_ID, name: 'Sin desc', steps: [{ message: 'x' }] },
    });
    expect(res.statusCode).toBe(201);
    expect(createRecipe.mock.calls[0]?.[0].description).toBeNull();
  });

  it('agente de otro owner -> 404 (no crea)', async () => {
    getByIdForOwner.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recipes',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(404);
    expect(getByIdForOwner).toHaveBeenCalledWith(AGENT_ID, 'user-1');
    expect(createRecipe).not.toHaveBeenCalled();
  });

  it('credencial de otro owner -> 404 (no crea)', async () => {
    existsForOwner.mockResolvedValue(false);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recipes',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(404);
    expect(existsForOwner).toHaveBeenCalledWith('user-1', CRED_ID);
    expect(createRecipe).not.toHaveBeenCalled();
  });
});

describe('GET /v1/recipes', () => {
  it('lista solo las del owner del token, como resumen con stepCount', async () => {
    listRecipesByOwner.mockResolvedValue([makeRecipe()]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/recipes',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(listRecipesByOwner).toHaveBeenCalledWith('user-1');
    const recipes = res.json().recipes;
    expect(recipes).toHaveLength(1);
    // Resumen: no envia los pasos completos, solo su cantidad.
    expect(recipes[0].stepCount).toBe(2);
    expect(recipes[0].steps).toBeUndefined();
    expect(recipes[0].name).toBe('Reporte diario');
    expect(recipes[0].agentId).toBe(AGENT_ID);
  });
});

describe('GET /v1/recipes/:id', () => {
  it('devuelve la receta del owner CON sus pasos', async () => {
    getRecipeForOwner.mockResolvedValue(makeRecipe());
    const res = await app.inject({
      method: 'GET',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(getRecipeForOwner).toHaveBeenCalledWith(RECIPE_ID, 'user-1');
    expect(res.json().recipe.steps).toEqual([{ message: 'paso 1' }, { message: 'paso 2' }]);
  });

  it('receta de otro owner -> 404', async () => {
    getRecipeForOwner.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(res.statusCode).toBe(404);
    expect(getRecipeForOwner).toHaveBeenCalledWith(RECIPE_ID, 'user-2');
  });

  it('id no-uuid -> 400 (no toca el repo)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/recipes/no-es-uuid',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(getRecipeForOwner).not.toHaveBeenCalled();
  });
});

describe('PATCH /v1/recipes/:id', () => {
  it('desactiva (isActive=false) preservando el resto', async () => {
    getRecipeForOwner.mockResolvedValue(makeRecipe());
    updateRecipeForOwner.mockResolvedValue(makeRecipe({ isActive: false }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(200);
    const fields = updateRecipeForOwner.mock.calls[0]?.[2];
    expect(fields.isActive).toBe(false);
    expect(fields.name).toBe('Reporte diario'); // preservado
    expect(fields.steps).toEqual([{ message: 'paso 1' }, { message: 'paso 2' }]); // preservado
  });

  it('edita los pasos (re-valida) y los pasa al repo', async () => {
    getRecipeForOwner.mockResolvedValue(makeRecipe());
    updateRecipeForOwner.mockResolvedValue(makeRecipe({ steps: [{ message: 'nuevo' }] }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { steps: [{ message: 'nuevo unico paso' }] },
    });
    expect(res.statusCode).toBe(200);
    const fields = updateRecipeForOwner.mock.calls[0]?.[2];
    expect(fields.steps).toEqual([{ message: 'nuevo unico paso' }]);
  });

  it('editar steps a vacio -> 400 (re-valida, no actualiza)', async () => {
    getRecipeForOwner.mockResolvedValue(makeRecipe());
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { steps: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(updateRecipeForOwner).not.toHaveBeenCalled();
  });

  it('description = null limpia la descripcion (no se pierde por el merge)', async () => {
    getRecipeForOwner.mockResolvedValue(makeRecipe({ description: 'algo' }));
    updateRecipeForOwner.mockResolvedValue(makeRecipe({ description: null }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { description: null },
    });
    expect(res.statusCode).toBe(200);
    const fields = updateRecipeForOwner.mock.calls[0]?.[2];
    expect(fields.description).toBeNull();
  });

  it('body vacio -> 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('receta de otro owner -> 404', async () => {
    getRecipeForOwner.mockResolvedValue(null);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: 'Bearer valid-user-2' },
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(404);
    expect(getRecipeForOwner).toHaveBeenCalledWith(RECIPE_ID, 'user-2');
    expect(updateRecipeForOwner).not.toHaveBeenCalled();
  });

  it('id no-uuid -> 400 (no toca el repo)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/recipes/no-es-uuid',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(400);
    expect(getRecipeForOwner).not.toHaveBeenCalled();
  });
});

describe('DELETE /v1/recipes/:id', () => {
  it('borra solo las propias (204)', async () => {
    deleteRecipeForOwner.mockResolvedValue(true);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(204);
    expect(deleteRecipeForOwner).toHaveBeenCalledWith(RECIPE_ID, 'user-1');
  });

  it('404 si la receta no es del owner', async () => {
    deleteRecipeForOwner.mockResolvedValue(false);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/recipes/${RECIPE_ID}`,
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(res.statusCode).toBe(404);
    expect(deleteRecipeForOwner).toHaveBeenCalledWith(RECIPE_ID, 'user-2');
  });

  it('id no-uuid -> 400', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/recipes/no-es-uuid',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(deleteRecipeForOwner).not.toHaveBeenCalled();
  });
});
