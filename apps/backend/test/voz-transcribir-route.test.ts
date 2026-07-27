import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JwtVerifier } from '../src/auth/jwt-verifier.js';
import { vozRoutes } from '../src/routes/voz.js';
import { registerErrorHandler } from '../src/errors/error-handler.js';
import { parseEnv } from '../src/config/env.js';

/**
 * POST /v1/voz/transcribir (entrada por voz del Playground). Lo que protegen estos tests:
 *
 *  1. Sin usuario autenticado no se transcribe nada: 401 antes de tocar el upload.
 *  2. Sin OPENAI_API_KEY el endpoint responde 501 VOZ_NO_DISPONIBLE (mismo contrato que el relay)
 *     sin llamar a OpenAI: la consola oculta el boton.
 *  3. Con la feature encendida, el audio se reenvia a whisper-1 con el idioma como hint y la
 *     respuesta es {texto}. La key viaja SOLO hacia OpenAI; jamas en la respuesta al cliente.
 *  4. Un audio sobre el limite de 10 MB se rechaza con 413 sin llamar a OpenAI.
 *  5. Si la llamada a OpenAI excede su timeout, el error es estable (504 VOZ_TIMEOUT) y sin
 *     filtrar nada del upstream; un error del upstream es 502 VOZ_TRANSCRIPCION_FALLIDA.
 */

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  ADMIN_API_TOKEN: 'admin-token-1234567890',
  SUPABASE_URL: 'https://x.supabase.co',
  SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAULT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const OPENAI_KEY = 'sk-plataforma-super-secreta';

const verifier: JwtVerifier = {
  verify: async (token: string) => {
    if (token === 'valid-user-1') return { id: 'user-1', email: 'u1@test.com' };
    throw new Error('invalid');
  },
};

const fetchMock = vi.fn();

async function makeApp(extra: Record<string, string> = { OPENAI_API_KEY: OPENAI_KEY }): Promise<FastifyInstance> {
  const config = parseEnv({ ...BASE, ...extra });
  const app = Fastify();
  registerErrorHandler(app, config);
  await app.register(vozRoutes(config, { verifier, fetchImpl: fetchMock as unknown as typeof fetch }));
  return app;
}

/** Arma a mano un body multipart/form-data con los fields ANTES del archivo, como manda la consola. */
function multipartAudio(opts: { idioma?: string; audio?: Buffer } = {}) {
  const boundary = 'frontera-test-dictado';
  const audio = opts.audio ?? Buffer.from('audio-opus-de-mentira');
  const partes: Buffer[] = [];
  if (opts.idioma !== undefined) {
    partes.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="idioma"\r\n\r\n${opts.idioma}\r\n`,
      ),
    );
  }
  partes.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="duracionMs"\r\n\r\n2500\r\n`,
    ),
  );
  partes.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="dictado.webm"\r\n` +
        'Content-Type: audio/webm\r\n\r\n',
    ),
  );
  partes.push(audio);
  partes.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(partes),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

function okOpenAi(texto: string): Response {
  return new Response(JSON.stringify({ text: texto }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('POST /v1/voz/transcribir', () => {
  it('sin usuario autenticado -> 401 y OpenAI ni se entera', async () => {
    const app = await makeApp();
    const { payload, headers } = multipartAudio({ idioma: 'es' });
    const res = await app.inject({ method: 'POST', url: '/v1/voz/transcribir', payload, headers });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin OPENAI_API_KEY -> 501 VOZ_NO_DISPONIBLE sin llamar a OpenAI', async () => {
    const app = await makeApp({});
    const { payload, headers } = multipartAudio({ idioma: 'es' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/voz/transcribir',
      payload,
      headers: { ...headers, authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe('VOZ_NO_DISPONIBLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('feliz: reenvia a whisper-1 con el idioma como hint y responde {texto} sin filtrar la key', async () => {
    fetchMock.mockResolvedValue(okOpenAi('hola desde el dictado'));
    const app = await makeApp();
    const { payload, headers } = multipartAudio({ idioma: 'es' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/voz/transcribir',
      payload,
      headers: { ...headers, authorization: 'Bearer valid-user-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ texto: 'hola desde el dictado' });
    // La key JAMAS aparece en la respuesta al cliente.
    expect(res.body).not.toContain(OPENAI_KEY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${OPENAI_KEY}`);
    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('es');
    const archivo = form.get('file') as File;
    expect(archivo.name).toBe('dictado.webm');
    expect(await archivo.text()).toBe('audio-opus-de-mentira');
  });

  it('idioma invalido -> 400 VALIDATION_ERROR sin llamar a OpenAI', async () => {
    const app = await makeApp();
    const { payload, headers } = multipartAudio({ idioma: 'fr' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/voz/transcribir',
      payload,
      headers: { ...headers, authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('audio sobre los 10 MB -> 413 sin llamar a OpenAI', async () => {
    const app = await makeApp();
    const { payload, headers } = multipartAudio({
      idioma: 'es',
      audio: Buffer.alloc(10 * 1024 * 1024 + 16, 1),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/voz/transcribir',
      payload,
      headers: { ...headers, authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('timeout de OpenAI -> 504 VOZ_TIMEOUT con mensaje estable', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('operation timed out'), { name: 'TimeoutError' }));
    const app = await makeApp();
    const { payload, headers } = multipartAudio({ idioma: 'en' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/voz/transcribir',
      payload,
      headers: { ...headers, authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(504);
    expect(res.json().error.code).toBe('VOZ_TIMEOUT');
    expect(res.json().error.message).toBe('Transcription timed out');
  });

  it('error del upstream -> 502 VOZ_TRANSCRIPCION_FALLIDA sin filtrar el cuerpo de OpenAI', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'detalle interno de openai' } }), { status: 500 }),
    );
    const app = await makeApp();
    const { payload, headers } = multipartAudio({ idioma: 'es' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/voz/transcribir',
      payload,
      headers: { ...headers, authorization: 'Bearer valid-user-1' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('VOZ_TRANSCRIPCION_FALLIDA');
    expect(res.body).not.toContain('detalle interno de openai');
  });
});
