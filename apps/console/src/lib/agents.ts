export type ProviderId = 'anthropic' | 'openai' | 'openai-compatible';

/** Webhook externo del cliente, tal como se persiste en agents.tools (shape historico, sin kind). */
export interface StoredWebhookTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  url: string;
}

/** Discriminador y name fijo de la activacion de tareas en sitios conectados (espejo del backend). */
export const SITIOS_TOOL_KIND = 'sitios_conectados';
export const SITIOS_TOOL_NAME = 'sitios_conectados';

/** Activacion de la herramienta de sitios conectados guardada DENTRO del mismo arreglo tools. */
export interface StoredSitiosTool {
  kind: typeof SITIOS_TOOL_KIND;
  name: typeof SITIOS_TOOL_NAME;
  description: string;
}

/** Cualquier tool guardada del agente: webhook del cliente o la activacion de sitios. */
export type StoredTool = StoredWebhookTool | StoredSitiosTool;

export function esToolDeSitios(tool: StoredTool): tool is StoredSitiosTool {
  return (tool as StoredSitiosTool).kind === SITIOS_TOOL_KIND;
}

/** Config de un agente tal como la devuelve el backend (sin llaves, por diseno). */
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
  tools: StoredTool[];
  /** Secreto de firma de webhooks (opcional: backends sin la migracion aplicada no lo mandan). */
  webhookSecret?: string;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Etiqueta legible del proveedor. */
export function providerLabel(providerId: ProviderId): string {
  switch (providerId) {
    case 'anthropic':
      return 'Anthropic';
    case 'openai':
      return 'OpenAI';
    case 'openai-compatible':
      return 'Compatible (OpenAI)';
    default:
      return providerId;
  }
}

/**
 * Ruta del Playground (conversacion) de un agente. Centraliza el destino de la accion
 * "Usar agente": al crear un agente (asistente, autonomo o manual) la consola redirige aqui,
 * y la tarjeta y el form usan la misma funcion para su boton. Un solo lugar para la ruta evita
 * que los flujos se desincronicen si cambia el path.
 */
export function playgroundPath(agentId: string): string {
  return `/agentes/${agentId}/playground`;
}
