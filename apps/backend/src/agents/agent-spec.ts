import type { AgentSpec, ResolvedToolCatalogEntry } from '@ledesma-platform/shared';
import { AgentInputSchema, StoredToolSchema, type AgentCreateInput } from '../routes/agents.js';
import { WEBHOOK_TOOL_CAPABILITY } from '../tools/catalog.js';

/**
 * VALIDADOR DEL AGENT-SPEC: la compuerta que hace seguro el modo autonomo del Configurador. Toma el
 * AgentSpec que el LLM emite (estructurado pero NO confiable) + el catalogo de tools resuelto, y o
 * bien lo rechaza con errores explicitos, o bien produce el `value` que es input DIRECTO del flujo
 * de creacion existente (POST /v1/agents) -> repo.create. No crea rutas nuevas de creacion: solo
 * produce el input valido. Es ADITIVO: no toca el endpoint, el runtime ni el catalogo.
 *
 * Reusa, sin redefinir, las reglas reales: StoredToolSchema (webhook tools) y AgentInputSchema
 * (campos del agente) como compuerta final. Encima agrega las reglas DURAS que el schema de
 * creacion no impone pero que el modo autonomo necesita: openai-compatible exige baseUrl, las tools
 * nativas referenciadas deben existir en el catalogo Y estar disponibles, y toda tool debe ser
 * embed-safe (para que un agente generado SIEMPRE funcione embebido en el widget).
 */

/** Resultado discriminado: ok con el value listo para crear, o la lista de errores. */
export type AgentSpecValidationResult =
  | { ok: true; value: AgentCreateInput }
  | { ok: false; errors: string[] };

/** Campos permitidos del spec; cualquier otro es un campo desconocido (rechazado). */
const ALLOWED_SPEC_KEYS = new Set<string>([
  'name',
  'description',
  'systemPrompt',
  'providerId',
  'model',
  'maxTokens',
  'temperature',
  'baseUrl',
  'tools',
]);

/** Shape de una webhook tool (sin el discriminador kind) tal como lo espera StoredToolSchema. */
type WebhookToolInput = { name: string; description: string; inputSchema: Record<string, unknown>; url: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Valida una referencia a tool nativa contra el catalogo resuelto. Una nativa solo se acepta si el
 * runtime la puede ejecutar de verdad: debe existir, estar available=true (todas sus env vars
 * presentes) y ser embed-safe. No se persiste en el agente (el runtime inyecta las nativas).
 */
function validateNativeRef(
  tool: Record<string, unknown>,
  index: number,
  resolvedCatalog: ResolvedToolCatalogEntry[],
  errors: string[],
): void {
  const name = tool.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push(`tools[${index}] (native): requiere un name no vacio`);
    return;
  }
  const entry = resolvedCatalog.find((e) => e.name === name);
  if (!entry) {
    errors.push(`La tool nativa "${name}" no existe en el catalogo`);
    return;
  }
  if (!entry.available) {
    errors.push(`La tool nativa "${name}" no esta disponible (el runtime no puede ejecutarla)`);
  }
  if (!entry.embedSafe) {
    errors.push(`La tool nativa "${name}" no es embed-safe`);
  }
}

/**
 * Valida una webhook tool nueva REUSANDO StoredToolSchema (no redefine reglas) y, si pasa, la
 * acumula como StoredTool para el value. Tambien exige que la integracion webhook sea embed-safe
 * (hoy siempre lo es; la regla vive para que un agente generado funcione embebido).
 */
function validateWebhookTool(
  tool: Record<string, unknown>,
  index: number,
  out: WebhookToolInput[],
  errors: string[],
): void {
  const label = typeof tool.name === 'string' && tool.name !== '' ? `"${tool.name}"` : `tools[${index}]`;
  // Solo los campos que StoredToolSchema conoce: descarta kind y cualquier extra (shape webhook).
  const fields = {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    url: tool.url,
  };
  const parsed = StoredToolSchema.safeParse(fields);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || '(root)';
      errors.push(`Tool webhook ${label}: ${path}: ${issue.message}`);
    }
    return;
  }
  if (!WEBHOOK_TOOL_CAPABILITY.embedSafe) {
    errors.push(`Tool webhook ${label}: no es embed-safe`);
    return;
  }
  out.push(parsed.data);
}

/**
 * Valida un AgentSpec contra el catalogo resuelto. Acumula TODOS los errores (no corta en el
 * primero) para devolver feedback completo y devuelve un resultado discriminado. El value, cuando
 * ok=true, es el output de AgentInputSchema: input directo de la capa de creacion existente.
 */
export function validateAgentSpec(
  spec: AgentSpec,
  resolvedCatalog: ResolvedToolCatalogEntry[],
): AgentSpecValidationResult {
  const errors: string[] = [];

  // Defensa contra salida de LLM malformada: el spec debe ser un objeto plano.
  if (!isPlainObject(spec)) {
    return { ok: false, errors: ['El agent-spec debe ser un objeto'] };
  }
  const raw = spec as unknown as Record<string, unknown>;

  // Sin campos desconocidos: cualquier clave fuera del contrato se rechaza explicitamente.
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_SPEC_KEYS.has(key)) {
      errors.push(`Campo desconocido en el spec: "${key}"`);
    }
  }

  // Requeridos no vacios (mensajes claros; AgentInputSchema refuerza tipos/rangos mas abajo).
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    errors.push('name es requerido y no puede estar vacio');
  }
  const providerId = raw.providerId;
  if (typeof providerId !== 'string' || providerId.trim() === '') {
    errors.push('providerId es requerido y no puede estar vacio');
  }
  if (typeof raw.model !== 'string' || raw.model.trim() === '') {
    errors.push('model es requerido y no puede estar vacio');
  }

  // openai-compatible exige baseUrl: el schema de creacion no lo fuerza, pero el runtime si
  // (OpenAICompatibleProvider lanza sin baseUrl). El validador lo vuelve regla dura.
  if (providerId === 'openai-compatible') {
    const baseUrl = raw.baseUrl;
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
      errors.push('baseUrl es requerido cuando providerId es openai-compatible');
    }
  }

  // Tools: separa nativas (referencia al catalogo, NO se persisten) de webhooks (se persisten).
  const webhookTools: WebhookToolInput[] = [];
  // Unicidad de names entre TODAS las tools referenciadas. Regla dura propia de la compuerta (no
  // de StoredToolSchema): dos tools con el mismo name dejan un dispatch ambiguo en runtime
  // (createWebhookExecutor se queda con la ultima, el endpoint de prueba con la primera). El
  // Configurador autonomo nunca debe emitir un agente con tools en conflicto.
  const seenToolNames = new Set<string>();
  const rawTools = raw.tools;
  if (rawTools !== undefined) {
    if (!Array.isArray(rawTools)) {
      errors.push('tools debe ser un arreglo');
    } else {
      rawTools.forEach((item, index) => {
        if (!isPlainObject(item)) {
          errors.push(`tools[${index}] debe ser un objeto`);
          return;
        }
        if (typeof item.name === 'string' && item.name !== '') {
          if (seenToolNames.has(item.name)) {
            errors.push(`Tool duplicada: "${item.name}" aparece mas de una vez`);
          } else {
            seenToolNames.add(item.name);
          }
        }
        switch (item.kind) {
          case 'native':
            validateNativeRef(item, index, resolvedCatalog, errors);
            break;
          case 'webhook':
            validateWebhookTool(item, index, webhookTools, errors);
            break;
          default:
            errors.push(
              `tools[${index}] tiene un kind desconocido: ${JSON.stringify(item.kind)} (esperado 'native' o 'webhook')`,
            );
        }
      });
    }
  }

  // Candidato de input de creacion: solo campos conocidos. Las nativas NO van (el runtime las
  // inyecta en todos los agentes); solo las webhook se guardan en tools.
  const candidate: Record<string, unknown> = {
    name: raw.name,
    providerId: raw.providerId,
    model: raw.model,
  };
  if (raw.description !== undefined) candidate.description = raw.description;
  if (raw.systemPrompt !== undefined) candidate.systemPrompt = raw.systemPrompt;
  if (raw.maxTokens !== undefined) candidate.maxTokens = raw.maxTokens;
  if (raw.temperature !== undefined) candidate.temperature = raw.temperature;
  if (raw.baseUrl !== undefined) candidate.baseUrl = raw.baseUrl;
  if (webhookTools.length > 0) candidate.tools = webhookTools;

  // Compuerta final: el schema REAL de creacion. Refuerza name/providerId/model, rangos de
  // temperature, maxTokens entero positivo, baseUrl url, el limite de tools (max 50), etc. Las
  // webhook tools que van en candidate.tools YA pasaron StoredToolSchema (solo se agregan si
  // parsean), asi que aqui no reaparecen errores por-tool: la unica issue de path 'tools' posible
  // es el limite del arreglo, que SI debe surgir como error (no se filtra).
  const parsed = AgentInputSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || '(root)';
      errors.push(`${path}: ${issue.message}`);
    }
  }

  if (errors.length === 0 && parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return { ok: false, errors };
}

/**
 * VALIDACION ESTRICTA: la compuerta EXCLUSIVA del MODO AUTONOMO del Configurador (crear el agente
 * sin confirmacion humana). Es ADITIVA: REUSA validateAgentSpec tal cual (no cambia su firma ni su
 * comportamiento; el modo asistente sigue gateado por validateAgentSpec.ok) y exige, ENCIMA, que el
 * spec este COMPLETO y sin ambiguedad.
 *
 * validateAgentSpec ya garantiza lo "creable": name/providerId/model presentes y validos, toda tool
 * nativa existe + available + embed-safe, toda webhook cumple StoredToolSchema, sin tools duplicadas
 * ni campos desconocidos, y el gate final de AgentInputSchema. Como ese validador NO distingue
 * warnings, el criterio mas estricto disponible es exigir que el spec este COMPLETO: ademas de los
 * requeridos, un agente que se crea sin que un humano lo revise DEBE traer su proposito
 * (description) y sus instrucciones (systemPrompt) no vacios; sin ellos su comportamiento queda
 * indefinido. Asi un spec con validateAgentSpec.ok === true pero incompleto (p.ej. sin systemPrompt)
 * NO pasa la estricta y el modo autonomo cae de vuelta a la conversacion en vez de crear un agente
 * pobre.
 *
 * Devuelve el MISMO resultado discriminado que validateAgentSpec: { ok:true, value } listo para
 * crear, o { ok:false, errors } con TODO lo que falta (errores de la base + los estrictos).
 */
export function validateAgentSpecStrict(
  spec: AgentSpec,
  resolvedCatalog: ResolvedToolCatalogEntry[],
): AgentSpecValidationResult {
  const base = validateAgentSpec(spec, resolvedCatalog);
  // Si ni siquiera pasa la base, no hay nada mas que chequear: propaga sus errores tal cual.
  if (!base.ok) {
    return base;
  }

  // base.ok === true => spec es un objeto plano con los requeridos validos. Chequeos de COMPLETITUD.
  const raw = spec as unknown as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof raw.systemPrompt !== 'string' || raw.systemPrompt.trim() === '') {
    errors.push(
      'El modo autonomo requiere systemPrompt: las instrucciones del agente deben estar definidas',
    );
  }
  if (typeof raw.description !== 'string' || raw.description.trim() === '') {
    errors.push(
      'El modo autonomo requiere description: el proposito del agente debe estar definido',
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  // Pasa la base Y la estricta: el value de la base ya es el input EXACTO de creacion.
  return base;
}
