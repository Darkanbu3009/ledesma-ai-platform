import type { JsonSchema, ToolDefinition } from '@ledesma-platform/shared';
import type { ToolCall, ToolExecutionResult, ToolExecutor } from '../agent/index.js';
import { performSignedToolPost } from './signed-tool-fetch.js';

/**
 * Prefijo reservado para las tools nativas de la plataforma. El cliente NO puede crear/actualizar
 * tools con este prefijo (ver StoredToolSchema en routes/agents.ts): garantiza que el dispatch por
 * nombre nunca confunda una tool de cliente con una nativa.
 */
export const NATIVE_TOOL_PREFIX = 'platform_';

const iniciarTareaWebSchema: JsonSchema = {
  type: 'object',
  properties: {
    flujo: {
      type: 'string',
      enum: ['extraer_datos_web', 'ejecutar_tarea_web', 'leer_pagina_visual'],
      description:
        'extraer_datos_web para leer HTML; ejecutar_tarea_web para tareas de varios pasos; leer_pagina_visual para leer texto dentro de imagenes (vision).',
    },
    params: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL de la pagina inicial' },
        instruccion: {
          type: 'string',
          description:
            'Para extraer_datos_web: que extraer. Para ejecutar_tarea_web: la tarea completa de varios pasos, con criterio claro de cuando termina. Para leer_pagina_visual: que texto/datos extraer de la imagen.',
        },
        credenciales: {
          type: 'object',
          description:
            'Opcional. Solo para ejecutar_tarea_web. Datos sensibles para iniciar sesion (ej. usuario, contrasena). Se pasan de forma segura.',
          additionalProperties: { type: 'string' },
        },
        max_pasos: {
          type: 'number',
          description: 'Opcional. Solo para ejecutar_tarea_web. Limite de pasos del agente (default 25).',
        },
      },
      required: ['url', 'instruccion'],
    },
  },
  required: ['flujo', 'params'],
};

const revisarTareaWebSchema: JsonSchema = {
  type: 'object',
  properties: {
    job_id: { type: 'string', description: 'El job_id que devolvio platform_iniciar_tarea_web' },
  },
  required: ['job_id'],
};

/**
 * Catalogo de tools nativas que la plataforma inyecta en TODOS los agentes cuando WEB_WORKER_URL y
 * WEB_WORKER_SECRET estan configuradas. Apuntan al web worker propio y se firman con el secreto de
 * plataforma (no con el whsec_ por agente). Arranca con automatizacion web asincrona.
 */
export const NATIVE_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'platform_iniciar_tarea_web',
    description:
      'Inicia una tarea de automatizacion web en segundo plano y devuelve un job_id. La tarea NO es inmediata: usa platform_revisar_tarea_web con ese job_id para obtener el resultado. Hay tres flujos: extraer_datos_web es una LECTURA simple (navega a una URL y extrae datos del HTML), rapido y barato, usalo cuando solo necesitas leer informacion; ejecutar_tarea_web es una tarea de VARIOS PASOS en lenguaje natural (navegar, hacer clic, llenar formularios, iniciar sesion, descargar), mas potente, usalo cuando hay que ACTUAR, no solo leer; leer_pagina_visual lee texto que esta DENTRO de una imagen (paginas hechas de imagen, documentos escaneados, capturas, facturas en imagen) mediante extraccion visual (la pagina se captura y el modelo LEE la imagen), usalo cuando el texto NO es seleccionable/extraible como HTML y hay que verlo; para texto normal de una pagina web usa extraer_datos_web que es mas barato.',
    inputSchema: iniciarTareaWebSchema,
  },
  {
    name: 'platform_revisar_tarea_web',
    description:
      'Consulta el resultado de una tarea web iniciada con platform_iniciar_tarea_web, usando su job_id. Si sigue en proceso, vuelve a llamarla en unos segundos.',
    inputSchema: revisarTareaWebSchema,
  },
];

/** Nombres de las tools nativas (para el dispatch por nombre y el dedupe defensivo). */
export const NATIVE_TOOL_NAMES: Set<string> = new Set(NATIVE_TOOLS.map((t) => t.name));

/** Mapeo nombre de tool nativa -> ruta del web worker (POST {WEB_WORKER_URL}{ruta}). */
export const NATIVE_TOOL_ROUTES: Readonly<Record<string, string>> = {
  platform_iniciar_tarea_web: '/tools/iniciar-tarea-web',
  platform_revisar_tarea_web: '/tools/revisar-tarea-web',
};

/** Definiciones para el modelo. Devuelve copias frescas (no aliasea el catalogo compartido). */
export function nativeToolsToDefinitions(): ToolDefinition[] {
  return NATIVE_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

/**
 * Ejecutor de tools nativas: POST { tool, input } a la ruta del worker que corresponde al nombre,
 * firmado con el SECRETO DE PLATAFORMA (no el del agente). Misma mecanica que createWebhookExecutor
 * (timeout, redirect manual, recorte de respuesta, NUNCA lanza -> { content, isError: true }). La
 * URL del worker es de confianza y fija, asi que se omiten las guardas anti-SSRF por hostname/DNS.
 * Si el nombre no es nativo (no deberia llegar por el dispatch) regresa isError con un mensaje.
 */
export function createNativeExecutor(
  workerUrl: string,
  platformSecret: string,
  fetchImpl: typeof fetch = fetch,
  deps: { warn?: (message: string) => void } = {},
): ToolExecutor {
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const base = workerUrl.replace(/\/+$/, '');

  return async (call: ToolCall, signal?: AbortSignal): Promise<ToolExecutionResult> => {
    const route = NATIVE_TOOL_ROUTES[call.name];
    if (route === undefined) {
      return { content: `Tool ${call.name} no es una herramienta nativa de la plataforma`, isError: true };
    }
    return performSignedToolPost(`${base}${route}`, platformSecret, call, {
      channel: 'native',
      warn,
      fetchImpl,
      signal,
    });
  };
}
