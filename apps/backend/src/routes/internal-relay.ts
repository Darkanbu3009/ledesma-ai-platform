import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { getSql } from '../db/client.js';
import { timingSafeEqualHex } from '../triggers/trigger-auth.js';
import { RelayCoordinacionRepository } from '../relay/relay-coordinacion-repository.js';

/**
 * ENDPOINT INTERNO de la AUTORIDAD DE COORDINACION del relay (B-1). Corre en un LISTENER SEPARADO del
 * publico (ver internal-server.ts): Railway NO lo mapea al dominio publico, asi que solo es alcanzable por
 * la RED PRIVADA (`backend.railway.internal:<puerto>`) desde el servicio relay. Un endpoint de consumo de
 * jti NO debe quedar expuesto a internet: es superficie nueva en el proceso mas expuesto.
 *
 * DEFENSA EN PROFUNDIDAD: aunque solo sea privado, cada peticion se AUTENTICA con una MAC. El relay firma
 * `"{ts}.{rawBody}"` con HMAC-SHA256 usando el RELAY_TOKEN_SECRET que YA comparte con el backend (no se
 * crea un secreto nuevo). Se verifica en TIEMPO CONSTANTE (timingSafeEqualHex) con ventana anti-replay.
 * Sin el secreto nadie consume un jti ni toma un lock, aun si el endpoint fuese alcanzable.
 *
 * MINIMO CONOCIMIENTO: el jti llega HASHEADO (SHA-256); aca solo se guarda el hash. Cero pulsaciones.
 */

/** Ventana anti-replay de la MAC (segundos): misma tolerancia que los webhooks entrantes. */
const TOLERANCIA_SEG = 300;

/** Cota del cuerpo: estas peticiones son diminutas (un hash + numeros). */
const MAX_BODY_BYTES = 4 * 1024;

const ConsumirJtiSchema = z.object({
  jtiHash: z.string().regex(/^[0-9a-f]{64}$/), // SHA-256 en hex
  exp: z.number().int().positive(),
});

const TomarConexionSchema = z.object({
  connectionId: z.string().min(1).max(200),
  lockNonce: z.string().min(1).max(200),
  exp: z.number().int().positive(),
});

const LiberarConexionSchema = z.object({
  connectionId: z.string().min(1).max(200),
  lockNonce: z.string().min(1).max(200),
});

/** Verifica la MAC de la peticion en tiempo constante, con ventana anti-replay. */
function macValida(
  rawBody: string,
  tsHeader: string | string[] | undefined,
  macHeader: string | string[] | undefined,
  secret: string,
  nowSec: number,
): boolean {
  if (typeof tsHeader !== 'string' || typeof macHeader !== 'string') return false;
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > TOLERANCIA_SEG) return false;
  const esperada = createHmac('sha256', secret).update(`${tsHeader}.${rawBody}`).digest('hex');
  return timingSafeEqualHex(esperada, macHeader);
}

/**
 * Rutas de la autoridad de coordinacion. `secret` es el RELAY_TOKEN_SECRET (obligatorio para que el
 * endpoint exista; el llamador solo monta este plugin cuando el relay esta configurado). `repo` y `clock`
 * son inyectables en tests.
 */
export function internalRelayRoutes(
  config: Env,
  secret: string,
  deps?: {
    repo?: RelayCoordinacionRepository;
    clock?: () => number;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const repo = deps?.repo ?? new RelayCoordinacionRepository(getSql(config));
    const clock = deps?.clock ?? (() => Math.floor(Date.now() / 1000));

    // RAW BODY: se firma sobre los bytes EXACTOS recibidos, sin re-serializar (independiente del orden de
    // claves). parseAs:'string' entrega el cuerpo crudo; se parsea el JSON a mano tras verificar la MAC.
    const rawBodyParser = (_req: FastifyRequest, body: string, done: (err: Error | null, body?: unknown) => void) => {
      done(null, body);
    };
    app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: MAX_BODY_BYTES }, rawBodyParser);
    app.addContentTypeParser('*', { parseAs: 'string', bodyLimit: MAX_BODY_BYTES }, rawBodyParser);

    /** Autentica y parsea el cuerpo JSON. 401 uniforme si la MAC no valida; 400 si el JSON es invalido. */
    function autenticarYLeer(request: FastifyRequest): unknown {
      const rawBody = typeof request.body === 'string' ? request.body : '';
      if (!macValida(rawBody, request.headers['x-relay-ts'], request.headers['x-relay-mac'], secret, clock())) {
        throw new AppError('UNAUTHORIZED', 401, 'Unauthorized');
      }
      try {
        return JSON.parse(rawBody);
      } catch {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid body');
      }
    }

    app.post('/internal/relay/consumir-jti', async (request: FastifyRequest, reply: FastifyReply) => {
      const cuerpo = ConsumirJtiSchema.safeParse(autenticarYLeer(request));
      if (!cuerpo.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid body');
      }
      const consumido = await repo.consumirJti(cuerpo.data.jtiHash, cuerpo.data.exp);
      return reply.send({ consumido });
    });

    app.post('/internal/relay/tomar-conexion', async (request: FastifyRequest, reply: FastifyReply) => {
      const cuerpo = TomarConexionSchema.safeParse(autenticarYLeer(request));
      if (!cuerpo.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid body');
      }
      const tomado = await repo.tomarConexion(cuerpo.data.connectionId, cuerpo.data.lockNonce, cuerpo.data.exp);
      return reply.send({ tomado });
    });

    app.post('/internal/relay/liberar-conexion', async (request: FastifyRequest, reply: FastifyReply) => {
      const cuerpo = LiberarConexionSchema.safeParse(autenticarYLeer(request));
      if (!cuerpo.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid body');
      }
      await repo.liberarConexion(cuerpo.data.connectionId, cuerpo.data.lockNonce);
      return reply.send({ liberado: true });
    });
  };
}
