import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { internalRelayRoutes } from '../src/routes/internal-relay.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv, type Env } from '../src/config/env.js';
import type { RelayCoordinacionRepository } from '../src/relay/relay-coordinacion-repository.js';

const SECRET = 'relay-secret-0123456789abcdef0123456789abcdef';
const TS = 1_700_000_000;

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const consumirJti = vi.fn();
const tomarConexion = vi.fn();
const liberarConexion = vi.fn();

const repoFake = { consumirJti, tomarConexion, liberarConexion } as unknown as RelayCoordinacionRepository;

function firmar(ruta: string, body: string, ts: number, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${ts}.${ruta}.${body}`).digest('hex');
}

async function makeApp(): Promise<FastifyInstance> {
  const config: Env = parseEnv(BASE);
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(internalRelayRoutes(config, SECRET, { repo: repoFake, clock: () => TS }));
  return app;
}

function pedir(app: FastifyInstance, url: string, cuerpo: unknown, mac: string, ts: number = TS) {
  const body = JSON.stringify(cuerpo);
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', 'x-relay-ts': String(ts), 'x-relay-mac': mac },
    payload: body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  consumirJti.mockResolvedValue(true);
  tomarConexion.mockResolvedValue(true);
  liberarConexion.mockResolvedValue(undefined);
});

const JTI_HASH = 'a'.repeat(64);

describe('POST /internal/relay/consumir-jti', () => {
  it('con MAC valida consume el jti y devuelve el resultado del repo', async () => {
    const app = await makeApp();
    const cuerpo = { jtiHash: JTI_HASH, exp: 2000 };
    const body = JSON.stringify(cuerpo);
    const res = await pedir(app, '/internal/relay/consumir-jti', cuerpo, firmar('/internal/relay/consumir-jti', body, TS));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ consumido: true });
    expect(consumirJti).toHaveBeenCalledWith(JTI_HASH, 2000);
  });

  it('reuso: el repo devuelve false y la ruta lo refleja', async () => {
    consumirJti.mockResolvedValue(false);
    const app = await makeApp();
    const cuerpo = { jtiHash: JTI_HASH, exp: 2000 };
    const res = await pedir(app, '/internal/relay/consumir-jti', cuerpo, firmar('/internal/relay/consumir-jti', JSON.stringify(cuerpo), TS));
    expect(res.json()).toEqual({ consumido: false });
  });

  it('MAC invalida -> 401 sin tocar el repo', async () => {
    const app = await makeApp();
    const cuerpo = { jtiHash: JTI_HASH, exp: 2000 };
    const res = await pedir(app, '/internal/relay/consumir-jti', cuerpo, 'deadbeef');
    expect(res.statusCode).toBe(401);
    expect(consumirJti).not.toHaveBeenCalled();
  });

  it('MAC con OTRO secreto -> 401', async () => {
    const app = await makeApp();
    const cuerpo = { jtiHash: JTI_HASH, exp: 2000 };
    const mac = firmar('/internal/relay/consumir-jti', JSON.stringify(cuerpo), TS, 'x'.repeat(48));
    const res = await pedir(app, '/internal/relay/consumir-jti', cuerpo, mac);
    expect(res.statusCode).toBe(401);
  });

  it('timestamp fuera de la ventana anti-replay -> 401', async () => {
    const app = await makeApp();
    const cuerpo = { jtiHash: JTI_HASH, exp: 2000 };
    const viejo = TS - 10_000; // > 300s
    const res = await pedir(app, '/internal/relay/consumir-jti', cuerpo, firmar('/internal/relay/consumir-jti', JSON.stringify(cuerpo), viejo), viejo);
    expect(res.statusCode).toBe(401);
    expect(consumirJti).not.toHaveBeenCalled();
  });

  it('cuerpo con jtiHash mal formado -> 400 (tras autenticar)', async () => {
    const app = await makeApp();
    const cuerpo = { jtiHash: 'no-es-hex', exp: 2000 };
    const res = await pedir(app, '/internal/relay/consumir-jti', cuerpo, firmar('/internal/relay/consumir-jti', JSON.stringify(cuerpo), TS));
    expect(res.statusCode).toBe(400);
    expect(consumirJti).not.toHaveBeenCalled();
  });
});

describe('POST /internal/relay/tomar-conexion y liberar-conexion', () => {
  it('tomar-conexion con MAC valida devuelve el resultado del repo', async () => {
    tomarConexion.mockResolvedValue(false);
    const app = await makeApp();
    const cuerpo = { connectionId: 'con-1', lockNonce: 'nonce-1', exp: 2000 };
    const res = await pedir(app, '/internal/relay/tomar-conexion', cuerpo, firmar('/internal/relay/tomar-conexion', JSON.stringify(cuerpo), TS));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tomado: false });
    expect(tomarConexion).toHaveBeenCalledWith('con-1', 'nonce-1', 2000);
  });

  it('liberar-conexion con MAC valida llama al repo', async () => {
    const app = await makeApp();
    const cuerpo = { connectionId: 'con-1', lockNonce: 'nonce-1' };
    const res = await pedir(app, '/internal/relay/liberar-conexion', cuerpo, firmar('/internal/relay/liberar-conexion', JSON.stringify(cuerpo), TS));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ liberado: true });
    expect(liberarConexion).toHaveBeenCalledWith('con-1', 'nonce-1');
  });

  it('la MAC liga la RUTA: una firma de tomar-conexion NO autentica liberar-conexion', async () => {
    const app = await makeApp();
    const cuerpo = { connectionId: 'con-1', lockNonce: 'nonce-1' };
    // MAC firmada para tomar-conexion, reenviada a liberar-conexion (cuerpos compatibles): 401.
    const macDeTomar = firmar('/internal/relay/tomar-conexion', JSON.stringify(cuerpo), TS);
    const res = await pedir(app, '/internal/relay/liberar-conexion', cuerpo, macDeTomar);
    expect(res.statusCode).toBe(401);
    expect(liberarConexion).not.toHaveBeenCalled();
  });

  it('liberar-conexion con MAC invalida -> 401', async () => {
    const app = await makeApp();
    const cuerpo = { connectionId: 'con-1', lockNonce: 'nonce-1' };
    const res = await pedir(app, '/internal/relay/liberar-conexion', cuerpo, 'nope');
    expect(res.statusCode).toBe(401);
    expect(liberarConexion).not.toHaveBeenCalled();
  });
});
