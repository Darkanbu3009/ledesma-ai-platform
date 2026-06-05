import OpenAI from 'openai';
import type {
  ModelProvider,
  ProviderStreamEvent,
  ProviderStreamInput,
} from '@ledesma-platform/shared';
import { mapRequestToOpenAI } from './map-request.js';
import { translateOpenAIStream } from './translate-stream.js';

/**
 * Adaptador de OpenAI (Chat Completions, function calling + streaming).
 * Implementa el contrato ModelProvider. BYOK: construye un cliente con la key recibida por
 * llamada y NO la guarda en ningun campo. No loguea credenciales ni contenido.
 */
export class OpenAIProvider implements ModelProvider {
  public readonly id = 'openai';

  async *stream(input: ProviderStreamInput): AsyncIterable<ProviderStreamEvent> {
    const client = new OpenAI({ apiKey: input.credentials.apiKey });
    const params = mapRequestToOpenAI(input.request);

    const stream = await client.chat.completions.create(params, { signal: input.signal });

    yield* translateOpenAIStream(stream);
  }
}
