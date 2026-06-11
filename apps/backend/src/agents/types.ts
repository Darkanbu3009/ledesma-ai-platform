import type { JsonSchema, ProviderId } from '@ledesma-platform/shared';

/** Tool declarativa almacenada (sin codigo ejecutable). */
export interface StoredTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  url: string;
}

/** Config de un agente tal como vive en la base de datos. NUNCA incluye llaves. */
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
  /** Secreto de firma de webhooks. Lo genera la base al insertar; el update jamas lo toca. */
  webhookSecret: string;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Campos que el cliente puede crear/editar. */
export interface AgentConfigInput {
  name: string;
  description?: string;
  providerId: ProviderId;
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number | null;
  baseUrl?: string | null;
  tools?: StoredTool[];
  ownerId?: string | null;
}
