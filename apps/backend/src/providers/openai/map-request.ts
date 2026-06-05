import type OpenAI from 'openai';
import type {
  ContentBlock,
  NormalizedMessage,
  NormalizedRequest,
} from '@ledesma-platform/shared';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;

function mapAssistantMessage(
  blocks: ContentBlock[],
): OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      });
    }
  }

  const message: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
    role: 'assistant',
    content: textParts.length > 0 ? textParts.join('') : null,
  };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }
  return message;
}

function mapUserMessages(blocks: ContentBlock[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  const textParts: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_result') {
      out.push({ role: 'tool', tool_call_id: block.toolUseId, content: block.content });
    }
  }
  if (textParts.length > 0) {
    out.push({ role: 'user', content: textParts.join('') });
  }
  return out;
}

function mapMessage(message: NormalizedMessage): ChatMessage[] {
  if (message.role === 'assistant') {
    return [mapAssistantMessage(message.content)];
  }
  return mapUserMessages(message.content);
}

/** Aplana los mensajes normalizados al formato de OpenAI (system + N mensajes por turno). */
export function mapMessagesToOpenAI(request: NormalizedRequest): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (request.system !== undefined) {
    out.push({ role: 'system', content: request.system });
  }
  for (const message of request.messages) {
    out.push(...mapMessage(message));
  }
  return out;
}

/** Traduce la peticion normalizada a params de Chat Completions en modo streaming. */
export function mapRequestToOpenAI(
  request: NormalizedRequest,
): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
  const { tools, modelConfig } = request;

  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model: modelConfig.model,
    messages: mapMessagesToOpenAI(request),
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: modelConfig.maxTokens,
  };

  if (modelConfig.temperature !== undefined) {
    params.temperature = modelConfig.temperature;
  }
  if (modelConfig.topP !== undefined) {
    params.top_p = modelConfig.topP;
  }
  if (modelConfig.stopSequences !== undefined) {
    params.stop = modelConfig.stopSequences;
  }
  if (tools !== undefined && tools.length > 0) {
    params.tools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  return params;
}
