export type ProviderId = 'anthropic' | 'openai' | 'openai-compatible';

export interface StoredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  url: string;
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
