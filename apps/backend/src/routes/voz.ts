import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { createSupabaseJwtVerifier, type JwtVerifier } from '../auth/jwt-verifier.js';
import { requireUser } from '../auth/require-user.js';

/** Limite del audio por dictado: 10 MB (60 s de opus queda muy por debajo). */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** Timeout de la llamada a OpenAI. Si se excede, 504 VOZ_TIMEOUT y el cliente puede reintentar. */
const OPENAI_TIMEOUT_MS = 30_000;

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

/** Hint de idioma para whisper-1: los dos idiomas de la consola, nada mas. */
const IdiomaSchema = z.enum(['es', 'en']);

/**
 * ENTRADA POR VOZ del Playground: recibe el audio dictado, lo reenvia a la API de OpenAI
 * (whisper-1) y devuelve el texto para que el usuario lo REVISE en el input antes de enviar.
 *
 * Reglas innegociables de este endpoint:
 *  - La key de OpenAI es DE PLATAFORMA y vive SOLO en el backend: no viaja al cliente, ni a logs,
 *    ni a mensajes de error. Sin key configurada -> 501 VOZ_NO_DISPONIBLE (mismo contrato que el
 *    relay) y la consola oculta el boton.
 *  - El audio NO se persiste en ningun lado: ni disco, ni DB, ni logs. Transita en memoria y se
 *    descarta. Los logs registran solo bytes, duracion declarada y latencia de OpenAI.
 *  - El texto transcrito NUNCA dispara nada solo: el backend responde {texto} y el usuario decide.
 */
export function vozRoutes(
  config: Env,
  deps?: {
    verifier?: JwtVerifier;
    /** fetch hacia OpenAI, inyectable en tests para no tocar la red. */
    fetchImpl?: typeof fetch;
  },
) {
  return async function (app: FastifyInstance): Promise<void> {
    const verifier = deps?.verifier ?? createSupabaseJwtVerifier(config);
    const fetchImpl = deps?.fetchImpl ?? fetch;

    // El parser de multipart se registra en ESTE contexto encapsulado: ninguna otra ruta del
    // backend acepta multipart. Un archivo, con tope duro de 10 MB (al excederlo, 413).
    await app.register(multipart, {
      limits: { files: 1, fileSize: MAX_AUDIO_BYTES, fields: 4 },
    });

    app.post('/v1/voz/transcribir', async (request: FastifyRequest, reply: FastifyReply) => {
      await requireUser(request, verifier);

      // Feature opcional: sin la key de plataforma no hay transcripcion. Se corta ANTES de
      // consumir el upload, igual que el patron RELAY_NO_DISPONIBLE.
      if (config.OPENAI_API_KEY === undefined) {
        throw new AppError('VOZ_NO_DISPONIBLE', 501, 'Voice transcription is not configured');
      }

      const archivo = await request.file();
      if (archivo === undefined) {
        throw new AppError('VALIDATION_ERROR', 400, 'Audio file is required');
      }

      // Los fields llegan con las partes previas al archivo, por eso la consola manda `idioma`
      // (y la duracion declarada, solo para el log) ANTES del audio en el form.
      const idioma = IdiomaSchema.safeParse(valorDeCampo(archivo.fields.idioma));
      if (!idioma.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid dictation language', idioma.error.issues);
      }
      const duracionMs = Number(valorDeCampo(archivo.fields.duracionMs));

      // Si el stream supera el tope, toBuffer lanza el error 413 de @fastify/multipart y el
      // error handler global lo mapea a PAYLOAD_TOO_LARGE. El buffer vive solo en este scope.
      const audio = await archivo.toBuffer();

      const form = new FormData();
      form.append('model', 'whisper-1');
      form.append('language', idioma.data);
      form.append(
        'file',
        new Blob([new Uint8Array(audio)], { type: archivo.mimetype }),
        archivo.filename !== '' ? archivo.filename : 'dictado.webm',
      );

      const inicio = Date.now();
      let respuesta: Response;
      try {
        respuesta = await fetchImpl(OPENAI_TRANSCRIPTIONS_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}` },
          body: form,
          signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new AppError('VOZ_TIMEOUT', 504, 'Transcription timed out');
        }
        throw new AppError('VOZ_TRANSCRIPCION_FALLIDA', 502, 'Transcription failed');
      }

      if (!respuesta.ok) {
        // Solo el status upstream al log; el cuerpo de OpenAI jamas viaja al cliente.
        request.log.warn({ status: respuesta.status }, 'transcripcion de voz rechazada por openai');
        throw new AppError('VOZ_TRANSCRIPCION_FALLIDA', 502, 'Transcription failed');
      }

      const cuerpo = (await respuesta.json().catch(() => null)) as { text?: unknown } | null;
      if (cuerpo === null || typeof cuerpo.text !== 'string') {
        throw new AppError('VOZ_TRANSCRIPCION_FALLIDA', 502, 'Transcription failed');
      }

      // Observabilidad SIN contenido: ni el audio ni el texto transcrito se loguean.
      request.log.info(
        {
          bytes: audio.byteLength,
          duracionMs: Number.isFinite(duracionMs) ? duracionMs : null,
          latenciaOpenAiMs: Date.now() - inicio,
        },
        'dictado transcrito',
      );
      return reply.send({ texto: cuerpo.text });
    });
  };
}

/** Valor de un field de multipart, si la parte existe y es un field simple (no archivo ni lista). */
function valorDeCampo(parte: unknown): string | undefined {
  if (parte && typeof parte === 'object' && !Array.isArray(parte) && 'value' in parte) {
    const value = (parte as { value: unknown }).value;
    if (typeof value === 'string') return value;
  }
  return undefined;
}
