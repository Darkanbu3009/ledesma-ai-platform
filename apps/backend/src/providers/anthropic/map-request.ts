import type Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  NormalizedMessage,
  NormalizedRequest,
} from '@ledesma-platform/shared';

/**
 * Marca de prompt caching (ephemeral, TTL por defecto 5m) que Anthropic aplica sobre un bloque para
 * fijar un breakpoint de cache. Se crea una instancia nueva por uso: es un objeto plano de solo datos,
 * pero no compartir una referencia mutable evita sorpresas si alguien la muta aguas abajo.
 */
function ephemeral(): Anthropic.CacheControlEphemeral {
  return { type: 'ephemeral' };
}

function mapContentBlock(block: ContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError ? { is_error: true } : {}),
      };
    case 'image':
      // Anthropic acepta imagenes por referencia con source tipo 'url' (URLImageSource no lleva
      // media_type: la URL basta). La vision es nativa del modelo.
      return { type: 'image', source: { type: 'url', url: block.source.url } };
  }
}

function mapMessage(message: NormalizedMessage): Anthropic.MessageParam {
  return {
    role: message.role,
    content: message.content.map(mapContentBlock),
  };
}

/**
 * Coloca un breakpoint incremental de cache al final del historial: marca el ULTIMO bloque del ULTIMO
 * mensaje. En el loop agentico y en las recetas cada iteracion/paso re-envia el prefijo estable
 * (system + tools) mas el historial acumulado; con este breakpoint la peticion siguiente REUSA todo el
 * prefijo hasta aca (cache_read a ~0.1x) y solo paga a precio pleno los bloques nuevos que se agregaron
 * despues. El caching es transparente al output: no cambia lo que el modelo responde, solo el costo.
 *
 * Nuestro mapMessage siempre produce `content` como arreglo de bloques (text/tool_use/tool_result/image),
 * todos aceptan cache_control; el cast localizado cubre que el union ContentBlockParam incluye variantes
 * que no lo llevan. Muta el arreglo recien creado, sin efectos colaterales sobre la request normalizada.
 */
function markHistoryCacheBreakpoint(messages: Anthropic.MessageParam[]): void {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return;
  const content = lastMessage.content;
  if (typeof content === 'string' || content.length === 0) return;
  const lastBlock = content[content.length - 1];
  if (lastBlock === undefined) return;
  content[content.length - 1] = {
    ...lastBlock,
    cache_control: ephemeral(),
  } as Anthropic.ContentBlockParam;
}

/**
 * Traduce la peticion normalizada al formato de params de Anthropic (sin la bandera stream).
 * camelCase del contrato -> snake_case de la API. Solo incluye opcionales si estan definidos.
 *
 * PROMPT CACHING (aditivo, transparente al output): marca con cache_control (ephemeral) los bloques
 * estables y grandes que se re-envian en cada iteracion del loop y en cada paso de receta, para que el
 * proveedor los cachee una vez y los relea a ~0.1x en vez de re-cobrarlos a precio pleno:
 *   - `tools`: breakpoint sobre la ULTIMA definicion de tool (cubre el caso de un agente con tools pero
 *     sin system: el prefijo de tools queda cacheado por si solo).
 *   - `system`: se emite en forma de arreglo [{ type:'text', ... , cache_control }] (la forma string no
 *     admite cache_control). El orden de render de Anthropic es tools -> system -> messages, asi que
 *     este breakpoint cachea tools + system juntos como el prefijo estable del agente.
 *   - `messages`: breakpoint incremental al final del historial (ver markHistoryCacheBreakpoint).
 * Son a lo sumo 3 breakpoints (el maximo de la API es 4). Si el prefijo no alcanza el minimo cacheable
 * del modelo, el proveedor simplemente no cachea (sin error, sin costo): degrada limpio.
 */
export function mapRequestToAnthropic(
  request: NormalizedRequest,
): Anthropic.MessageCreateParamsNonStreaming {
  const { system, messages, tools, modelConfig } = request;

  const mappedMessages = messages.map(mapMessage);
  markHistoryCacheBreakpoint(mappedMessages);

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: modelConfig.model,
    max_tokens: modelConfig.maxTokens,
    messages: mappedMessages,
  };

  if (system !== undefined) {
    // Forma de arreglo para poder fijar el breakpoint de cache sobre el prefijo estable (system+tools).
    // Es equivalente a la forma string para el modelo: mismo prompt, mismo output.
    params.system = [{ type: 'text', text: system, cache_control: ephemeral() }];
  }
  if (modelConfig.temperature !== undefined) {
    params.temperature = modelConfig.temperature;
  }
  if (modelConfig.topP !== undefined) {
    params.top_p = modelConfig.topP;
  }
  if (modelConfig.stopSequences !== undefined) {
    params.stop_sequences = modelConfig.stopSequences;
  }
  if (tools !== undefined && tools.length > 0) {
    const mappedTools: Anthropic.Tool[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
    }));
    // Breakpoint sobre la ultima tool: cachea el bloque de tools (prefijo estable) incluso sin system.
    const lastTool = mappedTools[mappedTools.length - 1];
    if (lastTool !== undefined) {
      lastTool.cache_control = ephemeral();
    }
    params.tools = mappedTools;
  }

  return params;
}
