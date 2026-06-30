import { apiFetch } from './api';
import {
  configuratorBody,
  configuratorHeaders,
  type ConfiguratorMessage,
  type ConfiguratorResponse,
  type CredentialSession,
} from './configurator';

/**
 * Un turno del Configurador: POST /v1/configurator/message con el historial COMPLETO + el header de
 * credencial (x-credential-id si es guardada, x-provider-key si es al momento). El Authorization JWT
 * lo agrega apiFetch. Es request/response normal (no streaming): el backend acumula el stream del
 * proveedor server-side y responde el turno entero { reply, spec, validation }.
 */
export function sendConfiguratorMessage(
  session: CredentialSession,
  messages: ConfiguratorMessage[],
  signal?: AbortSignal,
): Promise<ConfiguratorResponse> {
  return apiFetch<ConfiguratorResponse>('/v1/configurator/message', {
    method: 'POST',
    body: JSON.stringify(configuratorBody(session, messages)),
    headers: configuratorHeaders(session),
    ...(signal ? { signal } : {}),
  });
}
