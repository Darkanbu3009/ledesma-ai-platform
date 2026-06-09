export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

interface EnvSource {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

/** Lee y valida las env publicas de Supabase. Funcion pura para testear. */
export function readSupabaseEnv(source: EnvSource): SupabaseEnv {
  const url = source.VITE_SUPABASE_URL;
  const anonKey = source.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing Supabase env: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required',
    );
  }
  return { url, anonKey };
}

export interface ApiEnv {
  apiUrl: string;
}

interface ApiEnvSource {
  VITE_API_URL?: string;
}

/** Lee y valida la URL del backend. Lanza en runtime si falta. */
export function readApiEnv(source: ApiEnvSource): ApiEnv {
  const apiUrl = source.VITE_API_URL;
  if (!apiUrl) {
    throw new Error('Missing API env: VITE_API_URL is required');
  }
  return { apiUrl: apiUrl.replace(/\/$/, '') };
}
