import { z } from 'zod';
import type { AgentConfig, ProviderId } from './agents';

/**
 * Contrato de cliente del Configurador. Espeja, sin Zod en los tipos, lo que el backend EMITE
 * (routes/configurator.ts y packages/shared/src/agent/agent-spec.ts). Este modulo es PURO: no importa
 * api/supabase, asi puede testearse en el entorno node de vitest. La llamada de red vive en
 * configurator-client.ts y la mutacion de creacion en mutations.ts.
 */

/** Mensaje del historial de conversacion. El endpoint es stateless: la UI manda el historial completo
 * en cada turno y lo mantiene en estado React (nunca en localStorage). */
export interface ConfiguratorMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Referencia a una tool NATIVA del catalogo: el runtime la inyecta, no se persiste en el agente. */
export interface NativeToolRef {
  kind: 'native';
  name: string;
}

/** Webhook tool custom que el Configurador define (mismo shape que StoredTool + el discriminador). */
export interface WebhookToolSpec {
  kind: 'webhook';
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  url: string;
}

export type AgentSpecTool = NativeToolRef | WebhookToolSpec;

/**
 * Espejo en cliente del AgentSpec (packages/shared). El backend lo construye y valida; aqui solo se
 * lee para el preview. TODOS los campos son opcionales porque el spec llega PARCIAL mientras dura la
 * entrevista (incluso vacio al principio).
 */
export interface AgentSpecDraft {
  name?: string;
  description?: string;
  systemPrompt?: string;
  providerId?: ProviderId;
  model?: string;
  maxTokens?: number;
  temperature?: number | null;
  baseUrl?: string | null;
  tools?: AgentSpecTool[];
}

/** Resultado de validateAgentSpec tal como lo expone el endpoint: ok, o la lista de errores. */
export type ConfiguratorValidation = { ok: true } | { ok: false; errors: string[] };

/**
 * Modo del turno del Configurador:
 *  - 'assistant': comportamiento de siempre (arma+valida; el humano confirma y crea con el boton).
 *  - 'autonomous': el backend crea el agente solo si pasa la validacion ESTRICTA. Gated por tier
 *    server-side: un usuario sin plan recibe 403 (el cliente no puede forzarlo).
 */
export type ConfiguratorMode = 'assistant' | 'autonomous';

/**
 * Resultado del modo autonomo (presente SOLO cuando el turno se envio con mode 'autonomous'). Si
 * created es true el agente ya quedo creado (agent trae la config). Si es false, la validacion
 * estricta no paso y el usuario sigue conversando (validation lista lo que falta).
 */
export interface AutonomousResult {
  created: boolean;
  agent: AgentConfig | null;
  validation: ConfiguratorValidation;
}

/** Cuerpo de la respuesta de POST /v1/configurator/message. spec es null si la salida del modelo no
 * fue interpretable (en ese caso validation.ok es false). autonomous solo viene en modo autonomo. */
export interface ConfiguratorResponse {
  reply: string;
  spec: AgentSpecDraft | null;
  validation: ConfiguratorValidation;
  autonomous?: AutonomousResult;
}

/**
 * Como el usuario provee la key para ESTA sesion del Configurador. Las dos variantes son
 * mutuamente excluyentes en la UI:
 *  - 'saved': una credencial GUARDADA de la boveda. Se manda x-credential-id; el backend resuelve
 *    providerId/baseUrl/key desde la credencial (autoritativos) y solo el model viaja en el body.
 *  - 'paste': una key pegada AL MOMENTO. Se manda x-provider-key y providerId/model/baseUrl en el body.
 * La precedencia (key al momento gana) la maneja el backend; la UI solo elige un modo a la vez.
 * La apiKey vive SOLO en este estado de sesion: nunca se persiste ni se loguea.
 */
export type CredentialSession =
  | {
      mode: 'saved';
      credentialId: string;
      label: string;
      providerId: ProviderId;
      model: string;
      baseUrl: string | null;
    }
  | {
      mode: 'paste';
      providerId: ProviderId;
      model: string;
      apiKey: string;
      baseUrl: string | null;
    };

/** Regla openai-compatible -> baseUrl, replicada en cliente (la autoridad sigue siendo el backend). */
export function providerNeedsBaseUrl(providerId: ProviderId): boolean {
  return providerId === 'openai-compatible';
}

/**
 * Header de credencial del turno: x-credential-id (guardada) o x-provider-key (al momento). El
 * Authorization JWT lo agrega apiFetch; aqui solo va la fuente de la key.
 */
export function configuratorHeaders(session: CredentialSession): Record<string, string> {
  return session.mode === 'saved'
    ? { 'x-credential-id': session.credentialId }
    : { 'x-provider-key': session.apiKey };
}

/** Cuerpo de POST /v1/configurator/message. baseUrl solo viaja para openai-compatible (asi el body
 * satisface el schema del backend tanto al momento como con credencial guardada). mode elige
 * asistente (default) o autonomo. */
export interface ConfiguratorRequestBody {
  messages: ConfiguratorMessage[];
  providerId: ProviderId;
  model: string;
  baseUrl?: string;
  mode: ConfiguratorMode;
}

export function configuratorBody(
  session: CredentialSession,
  messages: ConfiguratorMessage[],
  mode: ConfiguratorMode = 'assistant',
): ConfiguratorRequestBody {
  const body: ConfiguratorRequestBody = {
    messages,
    providerId: session.providerId,
    model: session.model,
    mode,
  };
  if (providerNeedsBaseUrl(session.providerId) && session.baseUrl) {
    body.baseUrl = session.baseUrl;
  }
  return body;
}

/** Tool persistible del agente (shape de StoredTool, sin el discriminador kind). */
export interface AgentCreateTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  url: string;
}

/** Cuerpo de POST /v1/agents (mismo shape que produce toApiInput del flujo manual). */
export interface AgentCreateBody {
  name: string;
  description: string;
  providerId: ProviderId;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number | null;
  baseUrl: string | null;
  tools: AgentCreateTool[];
}

/** maxTokens por defecto cuando el spec no lo captura (igual al default del form manual). */
export const DEFAULT_MAX_TOKENS = 1024;

/**
 * Mapea el AgentSpec final al body de creacion de agente, replicando la conversion del validador del
 * backend: las tools NATIVAS NO se persisten (el runtime las inyecta en todos los agentes); solo las
 * webhook van, sin el discriminador kind. baseUrl solo se conserva para openai-compatible.
 *
 * Devuelve null si faltan los requeridos (name/providerId/model). No deberia ocurrir cuando
 * validation.ok es true (el boton de crear esta gateado por esa condicion), pero el null mantiene la
 * funcion total y type-safe sin asunciones sobre el spec parcial.
 */
export function specToAgentInput(spec: AgentSpecDraft): AgentCreateBody | null {
  if (!spec.name || !spec.providerId || !spec.model) return null;
  const tools: AgentCreateTool[] = (spec.tools ?? [])
    .filter((tool): tool is WebhookToolSpec => tool.kind === 'webhook')
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      url: tool.url,
    }));
  return {
    name: spec.name,
    description: spec.description ?? '',
    providerId: spec.providerId,
    model: spec.model,
    systemPrompt: spec.systemPrompt ?? '',
    maxTokens: spec.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: spec.temperature ?? null,
    baseUrl: providerNeedsBaseUrl(spec.providerId) ? (spec.baseUrl ?? null) : null,
    tools,
  };
}

/**
 * Espejo en cliente de los campos de credencial AL MOMENTO del Configurador. Da feedback inmediato
 * antes de enviar (la autoridad sigue siendo el backend). Igual que en el resto de la consola,
 * openai-compatible exige baseUrl.
 */
export const ConfiguratorPasteSchema = z
  .object({
    providerId: z.enum(['anthropic', 'openai', 'openai-compatible']),
    model: z.string().min(1, 'El modelo es obligatorio').max(120),
    apiKey: z.string().min(1, 'La API key es obligatoria').max(8192),
    baseUrl: z.string().url('Debe ser una URL valida').optional().or(z.literal('')),
  })
  .superRefine((data, ctx) => {
    if (data.providerId === 'openai-compatible' && (!data.baseUrl || data.baseUrl === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message: 'Requerido para proveedores compatibles',
      });
    }
  });

export type ConfiguratorPasteValues = z.input<typeof ConfiguratorPasteSchema>;
export type ConfiguratorPasteParsed = z.output<typeof ConfiguratorPasteSchema>;
