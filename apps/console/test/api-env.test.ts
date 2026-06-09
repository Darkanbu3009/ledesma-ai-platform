import { describe, it, expect } from 'vitest';
import { readApiEnv } from '../src/lib/env';

describe('readApiEnv', () => {
  it('devuelve la url sin barra final', () => {
    expect(readApiEnv({ VITE_API_URL: 'https://api.example.com/' })).toEqual({ apiUrl: 'https://api.example.com' });
  });
  it('devuelve la url tal cual si no tiene barra final', () => {
    expect(readApiEnv({ VITE_API_URL: 'https://api.example.com' })).toEqual({ apiUrl: 'https://api.example.com' });
  });
  it('lanza si falta VITE_API_URL', () => {
    expect(() => readApiEnv({})).toThrow(/VITE_API_URL/);
  });
});
