import type { NormalizedRequest } from '@ledesma-platform/shared';

/**
 * Limites defensivos del cuerpo (plataforma). Protegen contra payloads abusivos y loops runaway.
 * Punto unico para ajustarlos; en P4 pueden volverse configurables por tenant.
 */
export const AGENT_LIMITS = {
  /** Maximo de mensajes en el history de una sola peticion. */
  maxMessages: 100,
  /** Maximo de caracteres sumando system + todos los content (~50k tokens). */
  maxTotalContentChars: 200_000,
  /** Maximo de bytes del body de la peticion (proteccion a nivel de parseo). */
  maxBodyBytes: 1_048_576,
  /** Cota dura de iteraciones del loop agentico. */
  maxIterationsCap: 20,
  /** Maximo de adjuntos (imagenes + documentos) por peticion. */
  maxAttachments: 5,
} as const;

/**
 * Cortes de seguridad del MOTOR DE EJECUCION, con sus defaults. Se aplican SOBRE el run completo
 * (todas las iteraciones), no por tool ni por turno. Son configurables por entorno
 * (RUN_TIMEOUT_SECONDS / RUN_MAX_TOKENS, ver config/env.ts); estos numeros son el fallback cuando
 * la env no esta seteada, y son la unica fuente de verdad de esos defaults.
 */

/**
 * Default del TIMEOUT GLOBAL de pared del run, en segundos. Deadline sobre la peticion de ejecucion
 * completa: al vencer, el run se aborta limpio (stop reason 'timeout'). Override: RUN_TIMEOUT_SECONDS.
 */
export const DEFAULT_RUN_TIMEOUT_SECONDS = 600;

/**
 * Default del CAP de tokens ACUMULADOS (input + output) a traves de las iteraciones de un run. Al
 * superarlo, el loop corta limpio (stop reason 'token_cap'). Override: RUN_MAX_TOKENS.
 */
export const DEFAULT_RUN_MAX_TOKENS = 1_000_000;

/** Error de validacion de entrada del cuerpo. Distinto de los errores de proveedor (P1.6). */
export class AgentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentInputError';
  }
}

export interface ValidateAgentRunParams {
  request: NormalizedRequest;
  maxIterations?: number;
  maxTokens?: number;
}

/**
 * Validacion defensiva de invariantes del loop. El endpoint publico (P2.3) ya valida el body con
 * Zod; esto protege llamadas directas a runAgent desde cualquier otro consumidor interno.
 */
export function validateAgentRun(params: ValidateAgentRunParams): void {
  if (params.request.messages.length === 0) {
    throw new AgentInputError('agent requires at least one message');
  }
  if (params.maxIterations !== undefined) {
    if (!Number.isInteger(params.maxIterations) || params.maxIterations < 1) {
      throw new AgentInputError('maxIterations must be a positive integer');
    }
    if (params.maxIterations > AGENT_LIMITS.maxIterationsCap) {
      throw new AgentInputError(`maxIterations exceeds cap of ${AGENT_LIMITS.maxIterationsCap}`);
    }
  }
  if (params.maxTokens !== undefined) {
    if (!Number.isInteger(params.maxTokens) || params.maxTokens < 1) {
      throw new AgentInputError('maxTokens must be a positive integer');
    }
  }
}
