import type { NormalizedRequest, ProviderCredentials } from './types.js';
import type { ProviderStreamEvent } from './events.js';

/** Argumentos de una llamada de streaming al proveedor. */
export interface ProviderStreamInput {
  request: NormalizedRequest;
  /** BYOK: credenciales por llamada. El proveedor las usa y las descarta. */
  credentials: ProviderCredentials;
  /** Permite cancelar la llamada (desconexion del cliente, timeout). */
  signal?: AbortSignal;
}

/**
 * Contrato que todo adaptador de proveedor cumple.
 * El cuerpo del agente (P2) opera SOLO contra esta interfaz, nunca contra un SDK directo.
 */
export interface ModelProvider {
  /** Identificador del adaptador, util para logging. */
  readonly id: string;
  /**
   * Ejecuta una llamada al modelo y emite eventos normalizados conforme llegan.
   * No persiste ni registra las credenciales recibidas.
   */
  stream(input: ProviderStreamInput): AsyncIterable<ProviderStreamEvent>;
}
