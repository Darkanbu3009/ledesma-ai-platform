/**
 * MAPA DE PRECIOS por modelo + calculo de costo en dinero de una ejecucion.
 *
 * CONTEXTO DE NEGOCIO (importante): la plataforma es BYOK -- el cliente ejecuta con SU key y el
 * proveedor le factura a EL, no a Ledesma. Este costo NO es el COGS de Ledesma: es TRANSPARENCIA para el
 * cliente ("cuanto consumiste, y cuanto equivale en dinero"). El mapa permite traducir el conteo de
 * tokens que ya persiste agent_runs a un monto en USD para mostrarselo al cliente.
 *
 * ALCANCE de este modulo: SOLO el mapa + la funcion pura calcularCosto() + sus tests. El endpoint de
 * gasto y la UI del dashboard son sub-fases siguientes y NO viven aca.
 *
 * PRECIOS DE REFERENCIA -- REVISAR: los valores salen de la auditoria interna
 * (docs/auditorias/11-rendimiento-eficiencia.md:40) y coinciden con el tarifario vigente del proveedor
 * al momento (Opus $5/$25, Sonnet $3/$15 por millon de tokens de input/output). Estan pensados para ser
 * FACILES DE ACTUALIZAR: si un precio cambia, se edita una linea de PRECIOS_POR_MODELO. La lista de
 * modelos ESPEJA apps/console/src/lib/model-catalog.ts; al agregar un modelo al catalogo, agregar aca su
 * precio (o quedara "sin tarifar" -> calcularCosto devuelve null).
 */

import type { TokenUsage } from '../provider/events.js';

/**
 * Multiplicadores de los cubos de cache respecto del precio de INPUT pleno (modelo de prompt caching del
 * proveedor): una LECTURA de cache cuesta ~0.1x el input y una ESCRITURA ~1.25x. Se aplican sobre el
 * precio de input de cada modelo para no duplicar tarifas. Referencia: la misma auditoria (11) y la nota
 * de V019__agent_runs_cache_tokens.sql. Ajustables en un solo lugar si el proveedor cambia el esquema.
 */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

/** Tarifa de un modelo, en USD por MILLON de tokens (input y output plenos). */
export interface PrecioModelo {
  /** USD por millon de tokens de input pleno (1x). Los cubos de cache derivan de este via los multiplicadores. */
  inputPorMillon: number;
  /** USD por millon de tokens de output. */
  outputPorMillon: number;
}

/**
 * PRECIOS DE REFERENCIA por modelo (USD por millon de tokens). Cubre los modelos Anthropic que sugiere el
 * catalogo de la consola, con las tarifas confirmadas del proveedor.
 *
 * SIN TARIFAR (a proposito, para NO inventar numeros): los modelos de OpenAI / openai-compatible del
 * catalogo (p.ej. 'gpt-5.5') NO estan aca porque el repo no tiene un precio de referencia confiable para
 * ellos. calcularCosto() devuelve null para un modelo sin tarifar (el llamador muestra "sin dato" en vez
 * de un monto fabricado). Al confirmar sus precios, agregar la entrada aca -- es todo lo que hace falta.
 */
export const PRECIOS_POR_MODELO: Readonly<Record<string, PrecioModelo>> = {
  // Anthropic Opus (4.6/4.7/4.8): $5 input / $25 output por millon.
  'claude-opus-4-8': { inputPorMillon: 5, outputPorMillon: 25 },
  'claude-opus-4-7': { inputPorMillon: 5, outputPorMillon: 25 },
  'claude-opus-4-6': { inputPorMillon: 5, outputPorMillon: 25 },
  // Anthropic Sonnet: $3 input / $15 output por millon.
  'claude-sonnet-4-6': { inputPorMillon: 3, outputPorMillon: 15 },
};

/** true si el modelo tiene tarifa conocida (esta en PRECIOS_POR_MODELO); false si esta "sin tarifar". */
export function modeloTarifado(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRECIOS_POR_MODELO, model);
}

/**
 * Costo en USD de una ejecucion, dado su modelo y los tokens consumidos (los 4 cubos: input, output,
 * cache_read, cache_write). Funcion PURA (sin I/O): la usara el endpoint de gasto de la sub-fase
 * siguiente. Los cubos de cache se tarifan a partir del precio de input via los multiplicadores; los
 * cubos ausentes cuentan como 0.
 *
 * Devuelve null si el modelo NO esta tarifado (desconocido o pendiente de precio): asi el llamador
 * distingue "no tengo precio" de "costo $0" y muestra el estado sin fabricar un monto.
 */
export function calcularCosto(model: string, tokens: TokenUsage): number | null {
  const precio = PRECIOS_POR_MODELO[model];
  if (precio === undefined) return null;

  const porMillon = (cantidad: number, precioPorMillon: number): number =>
    (cantidad / 1_000_000) * precioPorMillon;

  const inputUsd = porMillon(tokens.inputTokens, precio.inputPorMillon);
  const outputUsd = porMillon(tokens.outputTokens, precio.outputPorMillon);
  const cacheReadUsd = porMillon(tokens.cacheReadTokens ?? 0, precio.inputPorMillon * CACHE_READ_MULTIPLIER);
  const cacheWriteUsd = porMillon(tokens.cacheWriteTokens ?? 0, precio.inputPorMillon * CACHE_WRITE_MULTIPLIER);

  return inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd;
}
