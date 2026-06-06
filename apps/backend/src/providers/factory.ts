import type { ModelProvider, ProviderId } from '@ledesma-platform/shared';
import { AnthropicProvider } from './anthropic/index.js';
import { OpenAIProvider } from './openai/index.js';
import { OpenAICompatibleProvider } from './openai-compatible/index.js';

/**
 * Selecciona e instancia el adaptador correcto segun el proveedor.
 * Exhaustivo en tiempo de compilacion (el caso default con `never` falla el build si se agrega
 * un ProviderId sin manejar) y con guarda en runtime para valores invalidos.
 */
export function createProvider(providerId: ProviderId): ModelProvider {
  switch (providerId) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'openai':
      return new OpenAIProvider();
    case 'openai-compatible':
      return new OpenAICompatibleProvider();
    default: {
      const exhaustive: never = providerId;
      throw new Error(`unknown provider: ${String(exhaustive)}`);
    }
  }
}
