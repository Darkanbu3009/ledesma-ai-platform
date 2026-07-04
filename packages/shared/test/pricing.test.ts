import { describe, it, expect } from 'vitest';
import type { TokenUsage } from '../src/provider/events.js';
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  PRECIOS_POR_MODELO,
  calcularCosto,
  modeloTarifado,
} from '../src/pricing/pricing.js';

/** Un millon de tokens: unidad de tarifa (el precio esta en USD por millon). */
const UN_MILLON = 1_000_000;

describe('calcularCosto', () => {
  it('input puro: 1M tokens de input = el precio de input del modelo', () => {
    // Opus 4.8: $5/millon input.
    expect(calcularCosto('claude-opus-4-8', { inputTokens: UN_MILLON, outputTokens: 0 })).toBeCloseTo(5, 10);
    // Sonnet 4.6: $3/millon input.
    expect(calcularCosto('claude-sonnet-4-6', { inputTokens: UN_MILLON, outputTokens: 0 })).toBeCloseTo(3, 10);
  });

  it('output puro: 1M tokens de output = el precio de output del modelo', () => {
    // Opus 4.8: $25/millon output.
    expect(calcularCosto('claude-opus-4-8', { inputTokens: 0, outputTokens: UN_MILLON })).toBeCloseTo(25, 10);
    // Sonnet 4.6: $15/millon output.
    expect(calcularCosto('claude-sonnet-4-6', { inputTokens: 0, outputTokens: UN_MILLON })).toBeCloseTo(15, 10);
  });

  it('cache_read se tarifa a ~0.1x el input; cache_write a ~1.25x el input', () => {
    // Opus 4.8 input = $5/millon -> read = 5*0.1 = 0.5 ; write = 5*1.25 = 6.25 por millon.
    expect(calcularCosto('claude-opus-4-8', { inputTokens: 0, outputTokens: 0, cacheReadTokens: UN_MILLON })).toBeCloseTo(
      5 * CACHE_READ_MULTIPLIER,
      10,
    );
    expect(
      calcularCosto('claude-opus-4-8', { inputTokens: 0, outputTokens: 0, cacheWriteTokens: UN_MILLON }),
    ).toBeCloseTo(5 * CACHE_WRITE_MULTIPLIER, 10);
  });

  it('suma los 4 cubos (input + output + cache_read + cache_write) con sus multiplicadores', () => {
    // 500k input, 200k output, 300k cache_read, 100k cache_write en Opus 4.8 ($5/$25).
    const tokens: TokenUsage = {
      inputTokens: 500_000,
      outputTokens: 200_000,
      cacheReadTokens: 300_000,
      cacheWriteTokens: 100_000,
    };
    const esperado =
      (500_000 / UN_MILLON) * 5 +
      (200_000 / UN_MILLON) * 25 +
      (300_000 / UN_MILLON) * (5 * CACHE_READ_MULTIPLIER) +
      (100_000 / UN_MILLON) * (5 * CACHE_WRITE_MULTIPLIER);
    expect(calcularCosto('claude-opus-4-8', tokens)).toBeCloseTo(esperado, 10);
  });

  it('los cubos de cache ausentes cuentan como 0 (proveedor sin caching)', () => {
    const conCacheCero = calcularCosto('claude-opus-4-8', { inputTokens: 100_000, outputTokens: 50_000 });
    const conCacheExplicitaCero = calcularCosto('claude-opus-4-8', {
      inputTokens: 100_000,
      outputTokens: 50_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(conCacheCero).toBe(conCacheExplicitaCero);
  });

  it('para CADA modelo del mapa, 1M de input equivale a su inputPorMillon y 1M de output a su outputPorMillon', () => {
    for (const [model, precio] of Object.entries(PRECIOS_POR_MODELO)) {
      expect(calcularCosto(model, { inputTokens: UN_MILLON, outputTokens: 0 })).toBeCloseTo(precio.inputPorMillon, 10);
      expect(calcularCosto(model, { inputTokens: 0, outputTokens: UN_MILLON })).toBeCloseTo(precio.outputPorMillon, 10);
    }
  });

  it('modelo SIN tarifar (desconocido o pendiente, p.ej. gpt-5.5) -> null, sin fabricar un monto', () => {
    expect(calcularCosto('gpt-5.5', { inputTokens: UN_MILLON, outputTokens: UN_MILLON })).toBeNull();
    expect(calcularCosto('modelo-inexistente', { inputTokens: 10, outputTokens: 10 })).toBeNull();
    expect(calcularCosto('', { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });

  it('sin tokens -> costo 0 para un modelo tarifado', () => {
    expect(calcularCosto('claude-opus-4-8', { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});

describe('modeloTarifado', () => {
  it('true para modelos del mapa, false para los que no', () => {
    expect(modeloTarifado('claude-opus-4-8')).toBe(true);
    expect(modeloTarifado('claude-sonnet-4-6')).toBe(true);
    expect(modeloTarifado('gpt-5.5')).toBe(false);
    expect(modeloTarifado('desconocido')).toBe(false);
  });
});

describe('PRECIOS_POR_MODELO (mapa de referencia)', () => {
  it('cubre los modelos Anthropic del catalogo con las tarifas de referencia', () => {
    expect(PRECIOS_POR_MODELO['claude-opus-4-8']).toEqual({ inputPorMillon: 5, outputPorMillon: 25 });
    expect(PRECIOS_POR_MODELO['claude-opus-4-7']).toEqual({ inputPorMillon: 5, outputPorMillon: 25 });
    expect(PRECIOS_POR_MODELO['claude-opus-4-6']).toEqual({ inputPorMillon: 5, outputPorMillon: 25 });
    expect(PRECIOS_POR_MODELO['claude-sonnet-4-6']).toEqual({ inputPorMillon: 3, outputPorMillon: 15 });
  });
});
