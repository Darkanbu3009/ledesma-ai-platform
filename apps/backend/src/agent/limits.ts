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
} as const;

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
}
