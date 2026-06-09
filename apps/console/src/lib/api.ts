import { supabase } from './supabase';
import { readApiEnv } from './env';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Devuelve el access token de la sesion actual o lanza si no hay sesion. */
async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new ApiError(401, 'NO_SESSION', 'No hay sesion activa');
  }
  return token;
}

/** Fetch autenticado contra el backend de la plataforma. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiUrl } = readApiEnv(import.meta.env as Record<string, string | undefined>);
  const token = await getAccessToken();

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

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

  return body as T;
}
