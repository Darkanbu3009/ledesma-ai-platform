export type ProviderId = 'anthropic' | 'openai' | 'openai-compatible';

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  providerId: ProviderId;
  model: string;
  toolCount: number;
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
