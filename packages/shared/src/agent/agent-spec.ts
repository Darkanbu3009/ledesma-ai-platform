/**
 * CONTRATO DEL AGENT-SPEC: la forma estructurada que el agente Configurador EMITE (salida de LLM)
 * para describir un agente. Es la pieza compartida por los dos modos del Configurador (asistente y
 * autonomo). Mapea a los campos de creacion de agente (POST /v1/agents) pero pensada para ser
 * generada y validada: el backend la convierte, con validateAgentSpec, en el input EXACTO del flujo
 * de creacion existente. Es ADITIVO: no cambia el endpoint de creacion ni el runtime.
 *
 * Son tipos PUROS (sin Zod, sin dependencias): la validacion en runtime vive en el backend
 * (validateAgentSpec), que reusa StoredToolSchema y el schema real de creacion en vez de redefinir
 * reglas aqui. El shape de las tools sale del catalogo real (ToolCatalogEntry) y de StoredTool.
 */

import type { JsonSchema, ProviderId } from '../provider/types.js';

/**
 * Referencia a una tool NATIVA del catalogo por su name. El Configurador no la redefine: solo la
 * referencia. El runtime ya inyecta las nativas en todos los agentes, asi que NO se persiste en el
 * agente; el validador solo exige que el name exista en el catalogo resuelto, este disponible
 * (available=true) y sea embed-safe.
 */
export interface NativeToolRef {
  kind: 'native';
  /** Coincide con el name de una entrada del catalogo de tools (ToolCatalogEntry.name). */
  name: string;
}

/**
 * Definicion de una webhook tool NUEVA. Mismo shape que StoredTool real (name, description,
 * inputSchema, url) mas el discriminador kind. El validador la valida con el StoredToolSchema real
 * (name sin prefijo reservado platform_, url https, description string, inputSchema objeto).
 */
export interface WebhookToolSpec {
  kind: 'webhook';
  name: string;
  description: string;
  inputSchema: JsonSchema;
  url: string;
}

/** Item de tools en un AgentSpec: UNA de dos variantes discriminadas por `kind`. */
export type AgentSpecTool = NativeToolRef | WebhookToolSpec;

/**
 * Contrato que el Configurador emite para describir un agente. Los unicos requeridos son name,
 * providerId y model (el minimo que el flujo de creacion exige); el resto es opcional y mapea 1:1 a
 * los campos de creacion de agente. baseUrl solo aplica para openai-compatible (lo exige el
 * validador, no este tipo). tools es opcional: las nativas se referencian, las webhook se definen.
 */
export interface AgentSpec {
  name: string;
  description?: string;
  systemPrompt?: string;
  providerId: ProviderId;
  model: string;
  maxTokens?: number;
  temperature?: number | null;
  baseUrl?: string | null;
  tools?: AgentSpecTool[];
}
