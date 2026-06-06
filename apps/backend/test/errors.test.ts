import { describe, it, expect } from 'vitest';
import { toProviderError, ProviderError } from '../src/providers/errors.js';

describe('toProviderError', () => {
  it('mapea 401 y 403 a AUTHENTICATION (no retryable)', () => {
    const e401 = toProviderError({ status: 401, message: '401 invalid x-api-key' }, 'anthropic');
    expect(e401).toBeInstanceOf(ProviderError);
    expect(e401.code).toBe('AUTHENTICATION');
    expect(e401.providerId).toBe('anthropic');
    expect(e401.status).toBe(401);
    expect(e401.retryable).toBe(false);
    expect(toProviderError({ status: 403 }, 'openai').code).toBe('AUTHENTICATION');
  });

  it('mapea 404 a MODEL_NOT_FOUND', () => {
    expect(toProviderError({ status: 404 }, 'openai').code).toBe('MODEL_NOT_FOUND');
  });

  it('mapea 429 a RATE_LIMIT (retryable)', () => {
    const e = toProviderError({ status: 429 }, 'openai');
    expect(e.code).toBe('RATE_LIMIT');
    expect(e.retryable).toBe(true);
  });

  it('mapea 400 y 422 a INVALID_REQUEST', () => {
    expect(toProviderError({ status: 400 }, 'openai').code).toBe('INVALID_REQUEST');
    expect(toProviderError({ status: 422 }, 'openai').code).toBe('INVALID_REQUEST');
  });

  it('mapea 500 y 503 a PROVIDER_UNAVAILABLE (retryable)', () => {
    expect(toProviderError({ status: 500 }, 'openai').code).toBe('PROVIDER_UNAVAILABLE');
    const e503 = toProviderError({ status: 503 }, 'openai');
    expect(e503.code).toBe('PROVIDER_UNAVAILABLE');
    expect(e503.retryable).toBe(true);
  });

  it('mapea timeouts por nombre a TIMEOUT (retryable)', () => {
    expect(toProviderError({ name: 'APIConnectionTimeoutError', message: 'timeout' }, 'openai').code).toBe('TIMEOUT');
    expect(toProviderError({ name: 'APITimeoutError' }, 'openai').code).toBe('TIMEOUT');
  });

  it('mapea abort por nombre a CANCELLED (no retryable)', () => {
    const e = toProviderError({ name: 'APIUserAbortError' }, 'anthropic');
    expect(e.code).toBe('CANCELLED');
    expect(e.retryable).toBe(false);
    expect(toProviderError({ name: 'AbortError' }, 'anthropic').code).toBe('CANCELLED');
  });

  it('mapea APIConnectionError (sin status) a PROVIDER_UNAVAILABLE', () => {
    expect(toProviderError({ name: 'APIConnectionError', message: 'connection error' }, 'openai').code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('usa UNKNOWN para errores sin status ni nombre conocido', () => {
    expect(toProviderError(new Error('algo raro'), 'openai').code).toBe('UNKNOWN');
  });

  it('preserva el mensaje del proveedor cuando existe', () => {
    expect(toProviderError({ status: 404, message: 'model gpt-zzz not found' }, 'openai').message).toBe(
      'model gpt-zzz not found',
    );
  });

  it('usa el mensaje por defecto cuando el error no trae mensaje', () => {
    expect(toProviderError({ status: 429 }, 'openai').message).toContain('Rate limit');
  });

  it('es idempotente con un ProviderError existente', () => {
    const original = new ProviderError({ code: 'RATE_LIMIT', providerId: 'openai', message: 'x', status: 429 });
    expect(toProviderError(original, 'anthropic')).toBe(original);
  });
});
