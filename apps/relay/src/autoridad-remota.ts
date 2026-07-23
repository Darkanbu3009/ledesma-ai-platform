import { createHash, createHmac } from 'node:crypto';
import type { AutoridadRelay } from './autoridad.js';

/**
 * AUTORIDAD REMOTA (produccion): delega el uso unico del jti y el lock por conexion (B-1) a un endpoint
 * INTERNO del backend, atomico en su base. El relay sigue SIN DATABASE_URL: solo habla HTTP con ese
 * endpoint. La llamada va por la RED PRIVADA de Railway (`*.railway.internal`), no por internet.
 *
 * AUTENTICACION: cada peticion lleva `x-relay-ts` (epoch s) y `x-relay-mac` = HMAC-SHA256 en hex de
 * `"{ts}.{body}"` con el `RELAY_TOKEN_SECRET` que el relay YA comparte con el backend (no se crea un
 * secreto nuevo). El backend recomputa la MAC en tiempo constante; sin el secreto nadie puede consumir
 * un jti ni tomar un lock. El jti viaja HASHEADO (SHA-256): el backend guarda solo el hash.
 *
 * FAIL-CLOSED: si el endpoint no responde o responde mal, `consumirJti`/`tomarConexion` LANZAN y el
 * llamador rechaza el handshake. Nunca se degrada en silencio a estado por proceso.
 */

const TIMEOUT_MS = 5_000;

/** Fabrica de fetch inyectable (para tests). Default: el fetch global de Node. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class AutoridadRemota implements AutoridadRelay {
  private readonly base: string;
  private readonly fetchImpl: FetchLike;
  private readonly ahoraSec: () => number;

  constructor(
    baseUrl: string,
    private readonly secret: string,
    opciones: { fetchImpl?: FetchLike; ahoraSec?: () => number } = {},
  ) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opciones.fetchImpl ?? ((url, init) => fetch(url, init));
    this.ahoraSec = opciones.ahoraSec ?? (() => Math.floor(Date.now() / 1000));
  }

  async consumirJti(jti: string, expEpochSec: number): Promise<boolean> {
    const jtiHash = createHash('sha256').update(jti).digest('hex');
    const res = await this.pedir('/internal/relay/consumir-jti', { jtiHash, exp: expEpochSec });
    return res.consumido === true;
  }

  async tomarConexion(connectionId: string, lockNonce: string, expEpochSec: number): Promise<boolean> {
    const res = await this.pedir('/internal/relay/tomar-conexion', {
      connectionId,
      lockNonce,
      exp: expEpochSec,
    });
    return res.tomado === true;
  }

  async liberarConexion(connectionId: string, lockNonce: string): Promise<void> {
    // Best-effort: un fallo aqui no rompe el cierre (el lock caduca solo por exp). No propaga el error.
    try {
      await this.pedir('/internal/relay/liberar-conexion', { connectionId, lockNonce });
    } catch {
      // el lock vencera por si solo; no hay nada util que hacer aca
    }
  }

  private async pedir(ruta: string, cuerpo: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = JSON.stringify(cuerpo);
    const ts = String(this.ahoraSec());
    // La MAC liga la RUTA ademas del cuerpo: asi un cuerpo capturado para una operacion (p.ej.
    // tomar-conexion) no se puede reenviar como otra (liberar-conexion) aunque compartan campos.
    const mac = createHmac('sha256', this.secret).update(`${ts}.${ruta}.${body}`).digest('hex');
    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(`${this.base}${ruta}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-relay-ts': ts,
          'x-relay-mac': mac,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error('la autoridad de coordinacion no respondio');
    }
    if (!respuesta.ok) {
      throw new Error(`la autoridad de coordinacion respondio ${respuesta.status}`);
    }
    const json = (await respuesta.json().catch(() => null)) as Record<string, unknown> | null;
    if (json === null) {
      throw new Error('respuesta ilegible de la autoridad de coordinacion');
    }
    return json;
  }
}
