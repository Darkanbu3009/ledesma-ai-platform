import { describe, it, expect } from 'vitest';
import { readSupabaseEnv } from '../src/lib/env';

describe('readSupabaseEnv', () => {
  it('devuelve url y anonKey cuando estan presentes', () => {
    expect(
      readSupabaseEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'eyJ-k' }),
    ).toEqual({ url: 'https://x.supabase.co', anonKey: 'eyJ-k' });
  });
  it('lanza si falta la url', () => {
    expect(() => readSupabaseEnv({ VITE_SUPABASE_ANON_KEY: 'k' })).toThrow(/VITE_SUPABASE_URL/);
  });
  it('lanza si falta la anon key', () => {
    expect(() => readSupabaseEnv({ VITE_SUPABASE_URL: 'u' })).toThrow(/VITE_SUPABASE_ANON_KEY/);
  });
});
