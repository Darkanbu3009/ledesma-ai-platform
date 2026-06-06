import type {
  ModelProvider,
  ProviderId,
  ProviderStreamEvent,
  ProviderStreamInput,
} from '@ledesma-platform/shared';
import { createProvider } from './factory.js';

/** Entrada de una llamada al modelo: el contrato de stream + que proveedor usar. */
export interface ModelCallInput extends ProviderStreamInput {
  providerId: ProviderId;
}

/** Dependencias inyectables (para tests). Por defecto usa el factory real. */
export interface RunModelDeps {
  createProvider: (providerId: ProviderId) => ModelProvider;
}

const defaultDeps: RunModelDeps = { createProvider };

/**
 * Puerta de entrada unica a la capa de modelo (BYOK por request).
 * Selecciona el adaptador segun providerId y le pasa la peticion y las credenciales recibidas por
 * llamada, devolviendo el stream normalizado. NO guarda, persiste ni loguea la key: las
 * credenciales solo fluyen como parametro hacia el adaptador y quedan fuera de alcance al terminar.
 */
export function runModel(
  input: ModelCallInput,
  deps: RunModelDeps = defaultDeps,
): AsyncIterable<ProviderStreamEvent> {
  const { providerId, ...streamInput } = input;
  const provider = deps.createProvider(providerId);
  return provider.stream(streamInput);
}
