/**
 * Tipos del CATALOGO DE TOOLS de la plataforma: la fuente legible por maquina que enumera las
 * capacidades (tools) que un agente puede tener. El futuro agente Configurador lee este catalogo
 * para saber que herramientas puede ensamblar. Es ADITIVO: describe capacidades, no cambia el
 * runtime. El backend deriva las entradas nativas de NATIVE_TOOLS (fuente unica) sin duplicarlas.
 */

import type { JsonSchema } from './types.js';

/** Tipo de capacidad enumerada en el catalogo. Hoy solo 'native'; extensible a futuro. */
export type ToolCatalogKind = 'native';

/** Una capacidad del catalogo: combina la def de la tool con metadata para el Configurador. */
export interface ToolCatalogEntry {
  /** Coincide con el name de una tool que el runtime puede ejecutar. */
  name: string;
  /** Clase de capacidad ('native' por ahora; extensible). */
  kind: ToolCatalogKind;
  /** Etiqueta humana para UI. */
  title: string;
  /** Que hace (TOMADO de la def nativa, no re-escrito). */
  description: string;
  /** Guia para el Configurador sobre cuando elegir esta tool. */
  whenToUse: string;
  /** Contrato de entrada (TOMADO de la def nativa). */
  inputSchema: JsonSchema;
  /** true si funciona cuando el agente corre embebido en el widget. */
  embedSafe: boolean;
  /** Claves de env requeridas para que la tool este disponible. */
  requiresConfig: string[];
}

/** Entrada del catalogo con la disponibilidad resuelta en runtime segun env. */
export interface ResolvedToolCatalogEntry extends ToolCatalogEntry {
  /** true si todas las claves de requiresConfig estan presentes en el env actual. */
  available: boolean;
}

/**
 * Capacidad de integracion webhook custom: NO es una tool fija del catalogo, es la posibilidad de
 * que el cliente conecte una tool propia. Describe las reglas que debe cumplir la definicion.
 */
export interface WebhookToolCapability {
  kind: 'webhook';
  title: string;
  description: string;
  whenToUse: string;
  /** true: las webhook tools se ejecutan server-side (firma + POST desde la plataforma). */
  embedSafe: boolean;
  /** Reglas reales que valida la plataforma para cada campo de una webhook tool. */
  requiredFields: Array<{ field: 'name' | 'description' | 'inputSchema' | 'url'; rule: string }>;
}

/** Respuesta del endpoint de catalogo: tools resueltas + la capacidad webhook custom. */
export interface ToolCatalogResponse {
  tools: ResolvedToolCatalogEntry[];
  webhookCapability: WebhookToolCapability;
}
