import { ApiError, getAccessToken } from './api';
import { readApiEnv } from './env';
import { nombreArchivoDictado, type IdiomaDictado } from './voz';

/**
 * Manda el audio dictado al endpoint proxy del backend (POST /v1/voz/transcribir) y devuelve el
 * texto. La key de OpenAI vive SOLO en el backend; aca viaja unicamente el audio y el idioma.
 * No usa apiFetch porque el body es multipart: el boundary del Content-Type lo pone el navegador.
 */
export async function transcribirDictado(
  audio: Blob,
  idioma: IdiomaDictado,
  duracionMs?: number,
): Promise<string> {
  const { apiUrl } = readApiEnv(import.meta.env as Record<string, string | undefined>);
  const token = await getAccessToken();

  const form = new FormData();
  // Los fields van ANTES del archivo: el backend lee los que llegan previos al stream del audio.
  form.append('idioma', idioma);
  if (duracionMs !== undefined) form.append('duracionMs', String(Math.round(duracionMs)));
  form.append('audio', audio, nombreArchivoDictado(audio.type));

  const response = await fetch(`${apiUrl}/v1/voz/transcribir`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      body && typeof body === 'object' && 'error' in body &&
      body.error && typeof body.error === 'object' && 'code' in body.error &&
      typeof (body.error as { code: unknown }).code === 'string'
        ? (body.error as { code: string }).code
        : 'UNKNOWN';
    throw new ApiError(response.status, code, `API ${response.status}: ${code}`);
  }

  const texto =
    body && typeof body === 'object' && 'texto' in body &&
    typeof (body as { texto: unknown }).texto === 'string'
      ? (body as { texto: string }).texto
      : null;
  if (texto === null) {
    throw new ApiError(500, 'UNKNOWN', 'Respuesta de transcripcion invalida');
  }
  return texto;
}
