import OpenAI from 'openai';
import type {
  ModelProvider,
  ProviderStreamEvent,
  ProviderStreamInput,
} from '@ledesma-platform/shared';
import { mapRequestToOpenAI } from '../openai/map-request.js';
import { translateOpenAIStream } from '../openai/translate-stream.js';
import { toProviderError } from '../errors.js';

/**
 * Adaptador OpenAI-compatible. Mismo protocolo que OpenAI (Chat Completions, function calling +
 * streaming) apuntando a un endpoint configurable via baseURL. Cubre modelos open source
 * autohospedados (vLLM, Ollama, TGI) y agregadores/proveedores compatibles (OpenRouter, Together,
 * Groq, etc.). La plataforma NO hospeda modelos: el cliente/tercero corre el endpoint.
 * BYOK: key y baseURL viajan por llamada; NO se guardan ni se loguean.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  public readonly id = 'openai-compatible';

  async *stream(input: ProviderStreamInput): AsyncIterable<ProviderStreamEvent> {
    const baseURL = input.credentials.baseUrl;
    if (baseURL === undefined || baseURL.trim() === '') {
      throw new Error('openai-compatible provider requires credentials.baseUrl');
    }

    try {
      const client = new OpenAI({ apiKey: input.credentials.apiKey, baseURL });
      const params = mapRequestToOpenAI(input.request);

      const stream = await client.chat.completions.create(params, { signal: input.signal });

      yield* translateOpenAIStream(stream);
    } catch (error) {
      throw toProviderError(error, this.id);
    }
  }
}
