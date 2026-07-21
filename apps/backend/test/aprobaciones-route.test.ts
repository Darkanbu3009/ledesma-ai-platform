import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { aprobacionesRoutes } from '../src/routes/aprobaciones.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';
import type { AprobacionWeb } from '../src/aprobaciones/aprobaciones-repository.js';

/**
 * Rutas de CHECKPOINTS DE APROBACION HUMANA (7.1e). Lo critico: el owner SIEMPRE sale del token; la
 * decision es CAS (ya decidida/expirada/ajena -> 409, jamas doble decision); TODA decision registra
 * su intervencion Art.22 ANTES de reanudar el job; y este backend NUNCA ejecuta la accion (solo
 * registra la decision y devuelve el job a la cola).
 */

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const APROBACION_ID = '99999999-9999-4999-8999-999999999999';
const JOB_ID = '88888888-8888-4888-8888-888888888888';

const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    if (token === 'valid-user-2') return { id: 'user-2', email: 'u2@test.com' };
    throw new Error('invalid');
  },
};

const listarPorOwner = vi.fn();
const decidir = vi.fn();
const registrarIntervencion = vi.fn();
const reanudarDePausado = vi.fn();

function makeAprobacion(overrides: Partial<AprobacionWeb> = {}): AprobacionWeb {
  return {
    id: APROBACION_ID,
    ownerId: 'user-1',
    jobId: JOB_ID,
    connectionId: '77777777-7777-4777-8777-777777777777',
    sesionExternaId: 'ses-1',
    accionTipo: 'financiera',
    descripcion: 'Enviar el formulario de pago por 2,400 MXN a Aeromexico',
    screenshotPath: 'user-1/apr-1.png',
    estado: 'pendiente',
    instruccionRechazo: null,
    decididaPor: null,
    decididaEn: null,
    creadaEn: '2026-07-20T00:00:00.000Z',
    expiraEn: '2026-07-20T00:15:00.000Z',
    ...overrides,
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const config = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(
    aprobacionesRoutes(config, {
      verifier,
      aprobacionesRepo: { listarPorOwner, decidir, registrarIntervencion },
      jobsRepo: { reanudarDePausado },
    }),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  listarPorOwner.mockResolvedValue([]);
  decidir.mockResolvedValue(null);
  registrarIntervencion.mockResolvedValue(undefined);
  reanudarDePausado.mockResolvedValue(true);
  app = await makeApp();
});

describe('auth', () => {
  it('sin Authorization -> 401 en las tres rutas (no toca los repos)', async () => {
    for (const [method, url] of [
      ['GET', '/v1/aprobaciones'],
      ['POST', `/v1/aprobaciones/${APROBACION_ID}/aprobar`],
      ['POST', `/v1/aprobaciones/${APROBACION_ID}/rechazar`],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
    }
    expect(listarPorOwner).not.toHaveBeenCalled();
    expect(decidir).not.toHaveBeenCalled();
  });
});

describe('GET /v1/aprobaciones', () => {
  it('lista SOLO las del owner del token, con filtro por estado', async () => {
    listarPorOwner.mockResolvedValue([makeAprobacion()]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/aprobaciones?estado=pendiente',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(listarPorOwner).toHaveBeenCalledWith('user-1', 'pendiente');
    const body = res.json() as { aprobaciones: Array<Record<string, unknown>> };
    expect(body.aprobaciones).toHaveLength(1);
    expect(body.aprobaciones[0]?.id).toBe(APROBACION_ID);
    // El DTO no filtra el owner del querystring: sale del token. Y no expone ownerId.
    expect(body.aprobaciones[0]?.ownerId).toBeUndefined();
  });

  it('estado invalido -> 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/aprobaciones?estado=lo-que-sea',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /v1/aprobaciones/:id/aprobar', () => {
  it('aprueba con CAS, registra la intervencion Art.22 (quien, que vio) y reanuda el job', async () => {
    decidir.mockResolvedValue(makeAprobacion({ estado: 'aprobada', decididaPor: 'user-1' }));
    const res = await app.inject({
      method: 'POST',
      url: `/v1/aprobaciones/${APROBACION_ID}/aprobar`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(decidir).toHaveBeenCalledWith(APROBACION_ID, 'user-1', {
      estado: 'aprobada',
      decididaPor: 'user-1',
      instruccion: null,
    });
    // Encadenado Art.22: quien decidio y QUE VIO (descripcion + screenshot).
    expect(registrarIntervencion).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'user-1',
        aprobacionId: APROBACION_ID,
        decision: 'aprobada',
        decididaPor: 'user-1',
        descripcion: 'Enviar el formulario de pago por 2,400 MXN a Aeromexico',
        screenshotPath: 'user-1/apr-1.png',
      }),
    );
    expect(reanudarDePausado).toHaveBeenCalledWith(JOB_ID, 'user-1');
    expect((res.json() as { jobReanudado: boolean }).jobReanudado).toBe(true);
  });

  it('ya decidida, expirada o ajena (CAS sin filas) -> 409 y NO reanuda ni registra', async () => {
    decidir.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/aprobaciones/${APROBACION_ID}/aprobar`,
      headers: { authorization: 'Bearer valid-user-2' },
    });
    expect(res.statusCode).toBe(409);
    expect(decidir).toHaveBeenCalledWith(APROBACION_ID, 'user-2', expect.anything());
    expect(registrarIntervencion).not.toHaveBeenCalled();
    expect(reanudarDePausado).not.toHaveBeenCalled();
  });

  it('id no uuid -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/aprobaciones/no-es-uuid/aprobar',
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /v1/aprobaciones/:id/rechazar', () => {
  it('rechaza sin instruccion (un tap) y registra la intervencion', async () => {
    decidir.mockResolvedValue(makeAprobacion({ estado: 'rechazada', decididaPor: 'user-1' }));
    const res = await app.inject({
      method: 'POST',
      url: `/v1/aprobaciones/${APROBACION_ID}/rechazar`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(decidir).toHaveBeenCalledWith(APROBACION_ID, 'user-1', {
      estado: 'rechazada',
      decididaPor: 'user-1',
      instruccion: null,
    });
    expect(registrarIntervencion).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'rechazada', instruccion: null }),
    );
    expect(reanudarDePausado).toHaveBeenCalledWith(JOB_ID, 'user-1');
  });

  it('rechaza CON instruccion: viaja al repo y a la intervencion', async () => {
    decidir.mockResolvedValue(
      makeAprobacion({ estado: 'rechazada', instruccionRechazo: 'busca uno mas barato' }),
    );
    const res = await app.inject({
      method: 'POST',
      url: `/v1/aprobaciones/${APROBACION_ID}/rechazar`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { instruccion: 'busca uno mas barato' },
    });
    expect(res.statusCode).toBe(200);
    expect(decidir).toHaveBeenCalledWith(APROBACION_ID, 'user-1', {
      estado: 'rechazada',
      decididaPor: 'user-1',
      instruccion: 'busca uno mas barato',
    });
    expect(registrarIntervencion).toHaveBeenCalledWith(
      expect.objectContaining({ instruccion: 'busca uno mas barato' }),
    );
  });

  it('instruccion demasiado larga -> 400 (no toca los repos)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/aprobaciones/${APROBACION_ID}/rechazar`,
      headers: { authorization: 'Bearer valid-user-1' },
      payload: { instruccion: 'x'.repeat(2001) },
    });
    expect(res.statusCode).toBe(400);
    expect(decidir).not.toHaveBeenCalled();
  });
});

describe('restriccion dura (lado backend)', () => {
  it('NO existe endpoint que ejecute la accion: aprobar solo decide y reanuda; nada mas', async () => {
    decidir.mockResolvedValue(makeAprobacion({ estado: 'aprobada' }));
    await app.inject({
      method: 'POST',
      url: `/v1/aprobaciones/${APROBACION_ID}/aprobar`,
      headers: { authorization: 'Bearer valid-user-1' },
    });
    // El unico efecto colateral posible desde HTTP es la transicion del job a 'pending' (acotada por
    // owner): la EJECUCION vive exclusivamente en el worker, detras de construirReanudacionAprobada.
    expect(reanudarDePausado).toHaveBeenCalledTimes(1);
  });
});
