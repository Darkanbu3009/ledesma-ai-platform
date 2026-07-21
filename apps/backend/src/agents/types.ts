import type { JsonSchema, ProviderId } from '@ledesma-platform/shared';

/** Tool declarativa almacenada (sin codigo ejecutable): un webhook externo del cliente. */
export interface StoredTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  url: string;
}

/** Discriminador y name fijo de la tool de TAREAS EN SITIOS CONECTADOS guardada en el agente. */
export const SITIOS_TOOL_KIND = 'sitios_conectados';
export const SITIOS_TOOL_NAME = 'sitios_conectados';

/**
 * Activacion de la herramienta de SITIOS CONECTADOS (7.1d) en un agente. No es ejecutable por si
 * misma: es un flag persistido DENTRO del arreglo de tools existente (mismo mecanismo, sin sistema
 * paralelo) que le dice al ensamblado que inyecte las tools platform_ de sitios cuando el run trae
 * contexto de tenancy. Los webhooks guardados no traen kind, por eso el discriminador solo existe
 * en esta variante.
 */
export interface StoredSitiosTool {
  kind: typeof SITIOS_TOOL_KIND;
  name: typeof SITIOS_TOOL_NAME;
  description: string;
}

/** Cualquier tool guardada en agents.tools: webhook del cliente o la activacion de sitios. */
export type AgentTool = StoredTool | StoredSitiosTool;

export function esToolDeSitios(tool: AgentTool): tool is StoredSitiosTool {
  return (tool as StoredSitiosTool).kind === SITIOS_TOOL_KIND;
}

/** Solo los webhooks del cliente (lo unico que entiende el ejecutor firmado). */
export function webhookToolsDe(tools: AgentTool[]): StoredTool[] {
  return tools.filter((tool): tool is StoredTool => !esToolDeSitios(tool));
}

/** true si el agente tiene ACTIVADA la herramienta de tareas en sitios conectados. */
export function agenteTieneToolDeSitios(tools: AgentTool[]): boolean {
  return tools.some(esToolDeSitios);
}

/** Config de un agente tal como vive en la base de datos. NUNCA incluye llaves. */
export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  providerId: ProviderId;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number | null;
  baseUrl: string | null;
  tools: AgentTool[];
  /** Secreto de firma de webhooks. Lo genera la base al insertar; el update jamas lo toca. */
  webhookSecret: string;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Campos que el cliente puede crear/editar. */
export interface AgentConfigInput {
  name: string;
  description?: string;
  providerId: ProviderId;
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number | null;
  baseUrl?: string | null;
  tools?: AgentTool[];
  ownerId?: string | null;
}
