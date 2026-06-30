import type { StopReason, TokenUsage } from '../provider/events.js';

/**
 * Razon de fin del loop agentico: las razones del modelo mas los CORTES de seguridad del motor de
 * ejecucion (cota de iteraciones, timeout global de pared y cap de tokens acumulados del run).
 *
 * Nota: 'max_tokens' (heredado de StopReason) es el corte que reporta el PROVEEDOR cuando el modelo
 * agota su presupuesto de salida en un solo turno. Es distinto de 'token_cap', el corte de la
 * PLATAFORMA cuando el uso ACUMULADO (input + output) a traves de las iteraciones del run supera el
 * cap configurado. Se nombran aparte a proposito para no confundir ambos limites.
 */
export type AgentStopReason = StopReason | 'max_iterations' | 'timeout' | 'token_cap';

/**
 * Eventos que emite el cuerpo (loop agentico) hacia el consumidor / SSE.
 * Superset semantico de los eventos de un solo turno del modelo: incluye tool_result (que el loop
 * produce al ejecutar una tool) y un unico stop final con el uso acumulado de todos los turnos.
 * Se definen aparte de ProviderStreamEvent a proposito: este es el contrato de salida del CUERPO,
 * no el de un turno de proveedor.
 */
export interface AgentTextDeltaEvent {
  type: 'text_delta';
  text: string;
}

export interface AgentToolUseEvent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AgentToolResultEvent {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface AgentStopEvent {
  type: 'stop';
  reason: AgentStopReason;
  usage: TokenUsage;
}

export type AgentEvent =
  | AgentTextDeltaEvent
  | AgentToolUseEvent
  | AgentToolResultEvent
  | AgentStopEvent;
