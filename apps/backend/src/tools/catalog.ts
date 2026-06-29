import type {
  ResolvedToolCatalogEntry,
  ToolCatalogEntry,
  ToolDefinition,
  WebhookToolCapability,
} from '@ledesma-platform/shared';
import type { Env } from '../config/env.js';
import { NATIVE_TOOLS, NATIVE_TOOL_PREFIX } from './native-tools.js';

/**
 * CATALOGO DE TOOLS de la plataforma: la fuente legible por maquina que enumera las capacidades
 * que un agente puede tener, para que el agente Configurador sepa que herramientas ensamblar.
 *
 * Las entradas nativas DERIVAN de NATIVE_TOOLS (fuente unica): name, description e inputSchema NO
 * se re-declaran aqui, se toman de la def nativa. Este archivo solo APORTA la metadata adicional
 * que el Configurador necesita y que NO existe en la def nativa (title, whenToUse, requiresConfig).
 * Es ADITIVO: solo LEE NATIVE_TOOLS, no toca runtime, executors ni firma.
 */

/** Metadata ADICIONAL del catalogo por cada tool nativa (no duplica datos de la def nativa). */
interface NativeToolCatalogMeta {
  /** Etiqueta humana para UI. */
  title: string;
  /** Guia breve para el Configurador sobre cuando elegir la tool (afinable). */
  whenToUse: string;
  /** Claves de env requeridas para que la tool este disponible. */
  requiresConfig: string[];
}

// Las dos nativas dependen del web worker propio: WEB_WORKER_URL + WEB_WORKER_SECRET. Si falta
// cualquiera, la feature se desactiva y la tool no esta disponible (ver resolveToolCatalog).
const NATIVE_TOOL_REQUIRES_CONFIG = ['WEB_WORKER_URL', 'WEB_WORKER_SECRET'];

/**
 * Metadata adicional keyed por el name de la nativa. Si se agrega una nativa a NATIVE_TOOLS sin
 * una entrada aqui, buildToolCatalog lanza (fail-fast) y el test guardian de drift falla.
 */
const NATIVE_TOOL_CATALOG_META: Record<string, NativeToolCatalogMeta> = {
  platform_iniciar_tarea_web: {
    title: 'Iniciar tarea web',
    whenToUse:
      'Elegila cuando el agente necesita usar la web: leer datos de una pagina (extraer_datos_web), ' +
      'ejecutar una tarea de varios pasos como navegar, hacer clic, llenar formularios o iniciar ' +
      'sesion (ejecutar_tarea_web), o leer texto dentro de imagenes y documentos escaneados ' +
      '(leer_pagina_visual). Inicia el trabajo en segundo plano y devuelve un job_id; el resultado ' +
      'se obtiene despues con platform_revisar_tarea_web.',
    requiresConfig: NATIVE_TOOL_REQUIRES_CONFIG,
  },
  platform_revisar_tarea_web: {
    title: 'Revisar tarea web',
    whenToUse:
      'Elegila siempre junto con platform_iniciar_tarea_web: consulta con el job_id el resultado de ' +
      'una tarea web ya iniciada y, si sigue en proceso, se vuelve a llamar en unos segundos. No se ' +
      'usa sola: depende de un job_id devuelto por platform_iniciar_tarea_web.',
    requiresConfig: NATIVE_TOOL_REQUIRES_CONFIG,
  },
};

/**
 * Combina cada def nativa con su metadata de catalogo. name/description/inputSchema SALEN de la
 * def nativa (fuente unica); title/whenToUse/requiresConfig vienen de la metadata. embedSafe = true
 * para toda nativa (corren server-side). Es exportada y parametrizada para poder testear el drift:
 * lanza si una nativa no tiene metadata, o si hay metadata huerfana sin nativa correspondiente.
 */
export function buildToolCatalog(
  natives: readonly ToolDefinition[],
  meta: Record<string, NativeToolCatalogMeta>,
): ToolCatalogEntry[] {
  const entries = natives.map((tool): ToolCatalogEntry => {
    const extra = meta[tool.name];
    if (!extra) {
      throw new Error(
        `Falta metadata de catalogo para la tool nativa "${tool.name}". ` +
          'Agrega una entrada en NATIVE_TOOL_CATALOG_META (apps/backend/src/tools/catalog.ts).',
      );
    }
    return {
      name: tool.name,
      kind: 'native',
      title: extra.title,
      description: tool.description,
      whenToUse: extra.whenToUse,
      inputSchema: tool.inputSchema,
      embedSafe: true,
      requiresConfig: extra.requiresConfig,
    };
  });

  // Guarda inversa: ninguna clave de metadata sin tool nativa correspondiente (drift al borrar/renombrar).
  const nativeNames = new Set(natives.map((t) => t.name));
  for (const name of Object.keys(meta)) {
    if (!nativeNames.has(name)) {
      throw new Error(
        `NATIVE_TOOL_CATALOG_META tiene metadata huerfana para "${name}" (no existe en NATIVE_TOOLS).`,
      );
    }
  }

  return entries;
}

/** Catalogo construido al cargar el modulo desde NATIVE_TOOLS + su metadata adicional. */
export const TOOL_CATALOG: ToolCatalogEntry[] = buildToolCatalog(NATIVE_TOOLS, NATIVE_TOOL_CATALOG_META);

/**
 * Capacidad de integracion webhook custom: la posibilidad de conectar una tool propia. NO es una
 * tool fija del catalogo. requiredFields refleja las reglas reales de StoredToolSchema
 * (routes/agents.ts): name sin el prefijo reservado de plataforma, description string, inputSchema
 * objeto JSON Schema, url https.
 */
export const WEBHOOK_TOOL_CAPABILITY: WebhookToolCapability = {
  kind: 'webhook',
  title: 'Integracion webhook custom',
  description:
    'Conecta una tool propia: la plataforma firma (HMAC) y hace POST a tu endpoint HTTPS con el ' +
    'input del modelo, y reinyecta la respuesta al agente. Se ejecuta server-side.',
  whenToUse:
    'Usala cuando la capacidad que necesitas no existe entre las tools nativas y tienes (o puedes ' +
    'crear) un endpoint HTTPS que la implemente.',
  embedSafe: true,
  requiredFields: [
    {
      field: 'name',
      rule: `String no vacio; no puede empezar con el prefijo reservado "${NATIVE_TOOL_PREFIX}" (es de las tools nativas).`,
    },
    { field: 'description', rule: 'String que describe que hace la tool (se envia al modelo).' },
    { field: 'inputSchema', rule: 'Objeto JSON Schema que define la entrada de la tool.' },
    { field: 'url', rule: 'URL absoluta del webhook; debe usar https://.' },
  ],
};

/** true si la clave existe en env con un valor no vacio. */
function envHasKey(env: Env, key: string): boolean {
  const value = (env as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.length > 0 : value !== undefined && value !== null;
}

/**
 * Resuelve el catalogo contra el env: marca available = true cuando todas las claves de
 * requiresConfig estan presentes. Para las nativas: WEB_WORKER_URL && WEB_WORKER_SECRET. Solo lee.
 */
export function resolveToolCatalog(env: Env): ResolvedToolCatalogEntry[] {
  return TOOL_CATALOG.map((entry) => ({
    ...entry,
    available: entry.requiresConfig.every((key) => envHasKey(env, key)),
  }));
}
