import type { ProviderId } from './agents';

/**
 * Modelos SUGERIDOS por proveedor (editable; no es una lista cerrada: el campo acepta texto
 * libre porque la plataforma es agnostica de modelo). NUNCA incluir modelos Haiku.
 */
const CATALOG: Record<ProviderId, string[]> = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6'],
  openai: ['gpt-5.5'],
  'openai-compatible': [],
};

export function modelSuggestions(providerId: ProviderId): string[] {
  return CATALOG[providerId] ?? [];
}

export function modelPlaceholder(providerId: ProviderId): string {
  switch (providerId) {
    case 'anthropic':
      return 'p. ej. claude-sonnet-4-6';
    case 'openai':
      return 'p. ej. gpt-5.5';
    case 'openai-compatible':
      return 'p. ej. llama-3.3-70b';
    default:
      return 'identificador del modelo';
  }
}
