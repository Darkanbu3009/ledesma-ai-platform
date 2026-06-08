import { createClient } from '@supabase/supabase-js';
import { readSupabaseEnv } from './env';

const env = readSupabaseEnv(import.meta.env as Record<string, string | undefined>);

export const supabase = createClient(env.url, env.anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
