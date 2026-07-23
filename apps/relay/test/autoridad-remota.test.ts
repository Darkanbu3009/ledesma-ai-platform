// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { AutoridadRemota, type FetchLike } from '../src/autoridad-remota.js';

const SECRET = 'r'.repeat(48);
const BASE = 'http://backend.railway.internal:3001';
const TS = 1_700_000_000;

interface Capturada {
  url: string;
  init: RequestInit;
}

/** fetch falso que captura la peticion y responde el JSON dado con status 200. */
function fetchOk(json: unknown, capturas: Capturada[]): FetchLike {
  return async (url, init) => {
    capturas.push({ url, init });
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

function bodyDe(init: RequestInit): string {
  return typeof init.body === 'string' ? init.body : '';
}

function header(init: RequestInit, nombre: string): string {
  const h = init.headers as Record<string, string>;
  return h[nombre] ?? '';
}

describe('AutoridadRemota: firma MAC compatible con el backend', () => {
  it('consumirJti manda el hash del jti y una MAC HMAC(secret, "{ts}.{body}") verificable', async () => {
    const capturas: Capturada[] = [];
    const autoridad = new AutoridadRemota(BASE, SECRET, {
      fetchImpl: fetchOk({ consumido: true }, capturas),
      ahoraSec: () => TS,
    });

    const ok = await autoridad.consumirJti('jti-abc', 2_000);
    expect(ok).toBe(true);

    const [cap] = capturas;
    expect(cap?.url).toBe(`${BASE}/internal/relay/consumir-jti`);
    // El jti viaja HASHEADO (nunca en claro).
    const body = bodyDe(cap!.init);
    const parsed = JSON.parse(body) as { jtiHash: string; exp: number };
    expect(parsed.jtiHash).toBe(createHash('sha256').update('jti-abc').digest('hex'));
    expect(body).not.toContain('jti-abc');
    // La MAC es exactamente la que el backend recomputa: HMAC-SHA256(secret, "{ts}.{ruta}.{body}").
    const ruta = '/internal/relay/consumir-jti';
    const macEsperada = createHmac('sha256', SECRET).update(`${TS}.${ruta}.${body}`).digest('hex');
    expect(header(cap!.init, 'x-relay-mac')).toBe(macEsperada);
    expect(header(cap!.init, 'x-relay-ts')).toBe(String(TS));
  });

  it('tomarConexion devuelve el resultado del backend', async () => {
    const autoridad = new AutoridadRemota(BASE, SECRET, {
      fetchImpl: fetchOk({ tomado: false }, []),
      ahoraSec: () => TS,
    });
    expect(await autoridad.tomarConexion('con-1', 'nonce', 2_000)).toBe(false);
  });
});

describe('AutoridadRemota: fail-closed', () => {
  it('consumirJti LANZA si el fetch falla (autoridad inalcanzable)', async () => {
    const autoridad = new AutoridadRemota(BASE, SECRET, {
      fetchImpl: async () => {
        throw new Error('sin red');
      },
      ahoraSec: () => TS,
    });
    await expect(autoridad.consumirJti('jti', 2_000)).rejects.toThrow();
  });

  it('consumirJti LANZA ante una respuesta no-2xx', async () => {
    const autoridad = new AutoridadRemota(BASE, SECRET, {
      fetchImpl: async () => new Response('no', { status: 500 }),
      ahoraSec: () => TS,
    });
    await expect(autoridad.consumirJti('jti', 2_000)).rejects.toThrow();
  });

  it('liberarConexion NO lanza aunque el fetch falle (best-effort)', async () => {
    const autoridad = new AutoridadRemota(BASE, SECRET, {
      fetchImpl: async () => {
        throw new Error('sin red');
      },
      ahoraSec: () => TS,
    });
    await expect(autoridad.liberarConexion('con-1', 'nonce')).resolves.toBeUndefined();
  });
});
