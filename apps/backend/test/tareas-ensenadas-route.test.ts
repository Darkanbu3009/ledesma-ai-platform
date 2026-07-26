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
    tareasEnsenadasRoutes(config, { verifier, recetasRepo: { listarActivas, borrar } }),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  listarActivas.mockResolvedValue([]);
  borrar.mockResolvedValue(true);
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
