import type Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  NormalizedMessage,
  NormalizedRequest,
} from '@ledesma-platform/shared';

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
  }
}

function mapMessage(message: NormalizedMessage): Anthropic.MessageParam {
  return {
    role: message.role,
    content: message.content.map(mapContentBlock),
  };
}

/**
 * Traduce la peticion normalizada al formato de params de Anthropic (sin la bandera stream).
 * camelCase del contrato -> snake_case de la API. Solo incluye opcionales si estan definidos.
 */
export function mapRequestToAnthropic(
  request: NormalizedRequest,
): Anthropic.MessageCreateParamsNonStreaming {
  const { system, messages, tools, modelConfig } = request;

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: modelConfig.model,
    max_tokens: modelConfig.maxTokens,
    messages: messages.map(mapMessage),
  };

  if (system !== undefined) {
    params.system = system;
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
    params.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
    }));
  }

  return params;
}
