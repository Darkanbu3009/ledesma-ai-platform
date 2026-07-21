import type { Logger } from './logger.js';

/**
 * Subida de SCREENSHOTS de checkpoints de aprobacion (7.1e) al bucket PRIVADO 'aprobaciones-web'
 * de Supabase Storage (creado en V027, RLS: primera carpeta del path = auth.uid()). El worker sube
 * con la SERVICE ROLE KEY (omite RLS) via la API HTTP de Storage con un fetch (sin SDK nuevo, mismo
 * criterio que alertas.ts con Resend); la consola LEE su propia carpeta con una signed URL de vida
 * corta creada con la sesion del usuario.
 *
 * TODO es best-effort: sin config, o si la subida falla, el checkpoint se crea IGUAL con
 * screenshot_path null (la descripcion en una linea basta para decidir); un screenshot jamas
 * bloquea el flujo de aprobacion. La cascada ARCO/erasure borra los objetos junto con las filas.
 */

const BUCKET = 'aprobaciones-web';

/** Timeout de pared de la subida (ms). Un PNG de viewport pesa cientos de KB; 10s es holgado. */
const UPLOAD_TIMEOUT_MS = 10_000;

export interface StorageScreenshotsConfig {
  /** Base del proyecto Supabase (https://<ref>.supabase.co). */
  supabaseUrl: string;
  /** Service role key (omite RLS). JAMAS se loguea. */
  serviceRoleKey: string;
}

export interface SubidorDeScreenshots {
  /**
   * Sube el PNG (base64) y devuelve el path dentro del bucket, o null si no se pudo (best-effort).
   * El path arranca con el ownerId (= auth.uid()): la RLS de lectura del bucket exige esa carpeta.
   */
  subir(ownerId: string, aprobacionId: string, pngBase64: string): Promise<string | null>;
}

export function crearSubidorDeScreenshots(
  config: StorageScreenshotsConfig,
  logger: Logger,
  fetchImpl: typeof fetch = fetch,
): SubidorDeScreenshots {
  const base = config.supabaseUrl.replace(/\/+$/, '');
  return {
    async subir(ownerId: string, aprobacionId: string, pngBase64: string): Promise<string | null> {
      const path = `${ownerId}/${aprobacionId}.png`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      try {
        const res = await fetchImpl(`${base}/storage/v1/object/${BUCKET}/${path}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.serviceRoleKey}`,
            'content-type': 'image/png',
            // Idempotente: un reintento del mismo checkpoint reescribe el mismo objeto.
            'x-upsert': 'true',
          },
          body: Buffer.from(pngBase64, 'base64'),
          signal: controller.signal,
        });
        if (!res.ok) {
          const detalle = await res.text().catch(() => '');
          logger.warn('no se pudo subir el screenshot del checkpoint (se sigue sin screenshot)', {
            aprobacionId,
            status: res.status,
            detalle: detalle.slice(0, 200),
          });
          return null;
        }
        await res.text().catch(() => undefined);
        return path;
      } catch (error) {
        logger.warn('fallo la subida del screenshot del checkpoint (se sigue sin screenshot)', {
          aprobacionId,
          err: error instanceof Error ? error.message : 'desconocido',
        });
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
