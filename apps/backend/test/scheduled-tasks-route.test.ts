import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { scheduledTaskRoutes } from '../src/routes/scheduled-tasks.js';
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
const TASK_ID = '99999999-9999-4999-8999-999999999999';

// Verifier falso (sin red): user-1 y user-2 validos; cualquier otro token invalido.
const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    if (token === 'valid-user-2') return { id: 'user-2', email: 'u2@test.com' };
    throw new Error('invalid');
  },
};

const createTask = vi.fn();
const listTasksByOwner = vi.fn();
const getTaskForOwner = vi.fn();
const updateTaskForOwner = vi.fn();
const deleteTaskForOwner = vi.fn();
const getByIdForOwner = vi.fn();
const existsForOwner = vi.fn();
const getProfileTier = vi.fn();

function makeTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    ownerId: 'user-1',
    agentId: AGENT_ID,
    credentialId: CRED_ID,
    cronExpression: '0 8 * * *',
    payload: { messages: [{ role: 'user', content: 'hola' }] },
    isActive: true,
    lastRunAt: null,
    nextRunAt: '2026-07-01T08:00:00.000Z',
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
    scheduledTaskRoutes(config, {
      verifier,
      taskRepo: { createTask, listTasksByOwner, getTaskForOwner, updateTaskForOwner, deleteTaskForOwner },
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
  cronExpression: '0 8 * * *',
  payload: { messages: [{ role: 'user', content: 'reporte diario' }] },
};

describe('auth: /v1/scheduled-tasks sin JWT', () => {
  it('POST sin Authorization -> 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/scheduled-tasks', payload: validBody });
    expect(res.statusCode).toBe(401);
    expect(createTask).not.toHaveBeenCalled();
  });
  it('GET sin Authorization -> 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/scheduled-tasks' });
    expect(res.statusCode).toBe(401);
  });
  it('DELETE sin Authorization -> 401', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/v1/scheduled-tasks/${TASK_ID}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/scheduled-tasks', () => {
  it('crea con tier autonomous: owner del token, next_run_at calculado, 201', async () => {
    createTask.mockResolvedValue(makeTaskRow());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...validBody, ownerId: 'OTRO-MALICIOSO' },
    });
    expect(res.statusCode).toBe(201);
    const passed = createTask.mock.calls[0]?.[0];
    expect(passed.ownerId).toBe('user-1'); // owner del token, jamas del body
    expect(passed.agentId).toBe(AGENT_ID);
    expect(passed.credentialId).toBe(CRED_ID);
    expect(passed.cronExpression).toBe('0 8 * * *');
    // next_run_at se calcula server-side desde el cron (no viene del cliente).
    expect(passed.nextRunAt).toBeInstanceOf(Date);
    expect(res.json().task.id).toBe(TASK_ID);
  });

  it('GATE POR PLAN: un tier sin autonomia (free) -> 403 (no crea nada)', async () => {
    getProfileTier.mockResolvedValue('free');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(createTask).not.toHaveBeenCalled();
  });

  it('tier pro (plan con autonomia) tambien crea: el gate deriva del modulo central, 201', async () => {
    getProfileTier.mockResolvedValue('pro');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(201);
    expect(createTask).toHaveBeenCalledTimes(1);
  });

  it('tier free (sin registro) -> 403', async () => {
    getProfileTier.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('cron invalido -> 400 (no toca repos de pertenencia ni crea)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...validBody, cronExpression: '99 * * * *' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(createTask).not.toHaveBeenCalled();
  });

  it('cron imposible (30 de febrero) -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...validBody, cronExpression: '0 0 30 2 *' },
    });
    expect(res.statusCode).toBe(400);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('payload sin messages -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { ...validBody, payload: { messages: [] } },
    });
    expect(res.statusCode).toBe(400);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('agente de otro owner -> 404 (no crea)', async () => {
    getByIdForOwner.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(404);
    expect(getByIdForOwner).toHaveBeenCalledWith(AGENT_ID, 'user-1');
    expect(createTask).not.toHaveBeenCalled();
  });

  it('credencial de otro owner -> 404 (no crea)', async () => {
    existsForOwner.mockResolvedValue(false);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(404);
    expect(existsForOwner).toHaveBeenCalledWith('user-1', CRED_ID);
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe('GET /v1/scheduled-tasks', () => {
  it('lista solo las del owner del token', async () => {
    listTasksByOwner.mockResolvedValue([makeTaskRow()]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/scheduled-tasks',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(listTasksByOwner).toHaveBeenCalledWith('user-1');
    expect(res.json().tasks).toHaveLength(1);
  });
});

describe('PATCH /v1/scheduled-tasks/:id', () => {
  it('desactiva (is_active=false) sin recalcular next_run_at (cron no cambia)', async () => {
    getTaskForOwner.mockResolvedValue(makeTaskRow());
    updateTaskForOwner.mockResolvedValue(makeTaskRow({ isActive: false }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/scheduled-tasks/${TASK_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(200);
    const fields = updateTaskForOwner.mock.calls[0]?.[2];
    expect(fields.isActive).toBe(false);
    expect(fields.cronExpression).toBe('0 8 * * *'); // preservado
    expect(fields.nextRunAt).toBe('2026-07-01T08:00:00.000Z'); // preservado, no recalculado
  });

  it('cambiar el cron recalcula next_run_at', async () => {
    getTaskForOwner.mockResolvedValue(makeTaskRow());
    updateTaskForOwner.mockResolvedValue(makeTaskRow({ cronExpression: '*/5 * * * *' }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/scheduled-tasks/${TASK_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { cronExpression: '*/5 * * * *' },
    });
    expect(res.statusCode).toBe(200);
    const fields = updateTaskForOwner.mock.calls[0]?.[2];
    expect(fields.cronExpression).toBe('*/5 * * * *');
    expect(fields.nextRunAt).toBeInstanceOf(Date); // recalculado
  });

  it('reactivar (false -> true) recalcula next_run_at', async () => {
    getTaskForOwner.mockResolvedValue(makeTaskRow({ isActive: false }));
    updateTaskForOwner.mockResolvedValue(makeTaskRow({ isActive: true }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/scheduled-tasks/${TASK_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { isActive: true },
    });
    expect(res.statusCode).toBe(200);
    const fields = updateTaskForOwner.mock.calls[0]?.[2];
    expect(fields.nextRunAt).toBeInstanceOf(Date);
  });

  it('cron invalido en PATCH -> 400', async () => {
    getTaskForOwner.mockResolvedValue(makeTaskRow());
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/scheduled-tasks/${TASK_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { cronExpression: 'no-es-cron' },
    });
    expect(res.statusCode).toBe(400);
    expect(updateTaskForOwner).not.toHaveBeenCalled();
  });

  it('body vacio -> 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/scheduled-tasks/${TASK_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('tarea de otro owner -> 404', async () => {
    getTaskForOwner.mockResolvedValue(null);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/scheduled-tasks/${TASK_ID}`,
      headers: { authorization: 'Bearer valid-user-2' },
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(404);
    expect(getTaskForOwner).toHaveBeenCalledWith(TASK_ID, 'user-2');
    expect(updateTaskForOwner).not.toHaveBeenCalled();
  });

  it('id no-uuid -> 400 (no toca el repo)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/scheduled-tasks/no-es-uuid',
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(400);
    expect(getTaskForOwner).not.toHaveBeenCalled();
  });
});

describe('DELETE /v1/scheduled-tasks/:id', () => {
  it('borra solo las propias (204)', async () => {
    deleteTaskForOwner.mockResolvedValue(true);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/scheduled-tasks/${TASK_ID}`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(204);
    expect(deleteTaskForOwner).toHaveBeenCalledWith(TASK_ID, 'user-1');
  });

  it('404 si la tarea no es del owner', async () => {
    deleteTaskForOwner.mockResolvedValue(false);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/scheduled-tasks/${TASK_ID}`,
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(res.statusCode).toBe(404);
    expect(deleteTaskForOwner).toHaveBeenCalledWith(TASK_ID, 'user-2');
  });

  it('id no-uuid -> 400', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/scheduled-tasks/no-es-uuid',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(deleteTaskForOwner).not.toHaveBeenCalled();
  });
});
