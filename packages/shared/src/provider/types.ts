/**
 * Tipos normalizados del contrato de proveedor.
 * Son provider-neutral: cada adaptador traduce entre estos tipos y el formato
 * nativo de su proveedor (Anthropic, OpenAI, OpenAI-compatible).
 */

/** Identificadores de proveedor soportados por el selector (P1.5). */
export type ProviderId = 'anthropic' | 'openai' | 'openai-compatible';

/** Esquema JSON de la entrada de una tool (lo aceptan Anthropic y OpenAI). */
export type JsonSchema = Record<string, unknown>;

/** Bloque de texto dentro de un mensaje. */
export interface TextBlock {
  type: 'text';
  text: string;
}

/** Bloque donde el modelo solicita ejecutar una tool. */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Bloque con el resultado de una tool, reinyectado al modelo. */
export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

/**
 * Bloque de imagen referenciada por URL (no inline). El adaptador de cada proveedor lo traduce
 * a su forma nativa de vision: Anthropic image source url, OpenAI image_url. mimeType viaja por si
 * algun proveedor lo requiere; Anthropic (source url) no lo usa.
 */
export interface ImageBlock {
  type: 'image';
  source: {
    kind: 'url';
    url: string;
    mimeType: string;
  };
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock;

export type MessageRole = 'user' | 'assistant';

export interface NormalizedMessage {
  role: MessageRole;
  content: ContentBlock[];
}

/** Definicion de una tool que el agente expone al modelo. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

/** Parametros de modelo configurables por agente. */
export interface ModelConfig {
  /** Identificador del modelo, definido por el cliente al configurar el agente. */
  model: string;
  /** Cota maxima de tokens de salida. Requerido (Anthropic lo exige). */
  maxTokens: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
}

/** Credenciales BYOK. Viajan por llamada, NUNCA se persisten ni se loguean. */
export interface ProviderCredentials {
  apiKey: string;
  /** Endpoint configurable para el adaptador OpenAI-compatible (P1.4). */
  baseUrl?: string;
}

/** Entrada normalizada para una llamada al modelo. */
export interface NormalizedRequest {
  system?: string;
  messages: NormalizedMessage[];
  tools?: ToolDefinition[];
  modelConfig: ModelConfig;
}
