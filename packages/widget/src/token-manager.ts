/**
 * Cache de tokens de sesion del widget. El endpoint (token-url) es DEL CLIENTE: el widget le
 * hace POST sin headers especiales (el cliente decide su propia auth) y espera el JSON
 * { token, expiresAt } que su backend obtuvo de POST /v1/session-tokens. Modulo puro/testeable:
 * fetch y reloj inyectables.
 */

export interface TokenManagerOptions {
  tokenUrl: string;
  fetchImpl?: typeof fetch;
  /** Reloj en epoch ms, inyectable para tests. */
  nowFn?: () => number;
  /** Margen antes de expiresAt en el que el token ya se considera por expirar. */
  refreshMarginMs?: number;
}

export interface TokenManager {
  /** Devuelve un token valido; pide uno nuevo si falta o esta por expirar. */
  get(): Promise<string>;
  /** Borra el cache (p.ej. tras un 401) para que el proximo get() pida token nuevo. */
  invalidate(): void;
}

export function createTokenManager(options: TokenManagerOptions): TokenManager {
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowFn = options.nowFn ?? Date.now;
  const refreshMarginMs = options.refreshMarginMs ?? 30_000;

  let cached: { token: string; expiresAtMs: number } | null = null;
  let inFlight: Promise<string> | null = null;

  async function fetchToken(): Promise<string> {
    const response = await fetchImpl(options.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    let body: { token?: unknown; expiresAt?: unknown } | null = null;
    try {
      body = (await response.json()) as { token?: unknown; expiresAt?: unknown };
    } catch {
      /* sin JSON: cae en la validacion de abajo */
    }
    if (!response.ok || body === null || typeof body.token !== 'string' || body.token === '') {
      throw new Error('No se pudo obtener el token de sesion');
    }
    // Un expiresAt ausente o invalido no invalida el token: se cachea como ya-por-expirar y el
    // proximo get() pide uno nuevo en vez de confiar en una expiracion desconocida.
    const expiresAtMs = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : Number.NaN;
    cached = { token: body.token, expiresAtMs: Number.isNaN(expiresAtMs) ? 0 : expiresAtMs };
    return body.token;
  }

  return {
    get(): Promise<string> {
      if (cached !== null && nowFn() < cached.expiresAtMs - refreshMarginMs) {
        return Promise.resolve(cached.token);
      }
      // Evita carreras: si ya hay un fetch en vuelo, todos los get() comparten esa promesa.
      if (inFlight === null) {
        inFlight = fetchToken().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
    invalidate(): void {
      cached = null;
    },
  };
}
