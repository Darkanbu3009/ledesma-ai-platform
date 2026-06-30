import { apiFetch } from './api';
import {
  configuratorBody,
  configuratorHeaders,
  type ConfiguratorMessage,
  type ConfiguratorMode,
  type ConfiguratorResponse,
  type CredentialSession,
} from './configurator';

/**
 * Un turno del Configurador: POST /v1/configurator/message con el historial COMPLETO + el header de
 * credencial (x-credential-id si es guardada, x-provider-key si es al momento). El Authorization JWT
 * lo agrega apiFetch. Es request/response normal (no streaming): el backend acumula el stream del
 * proveedor server-side y responde el turno entero { reply, spec, validation } (+ autonomous en modo
 * autonomo). mode default 'assistant': el comportamiento existente no cambia.
 */
export function sendConfiguratorMessage(
  session: CredentialSession,
  messages: ConfiguratorMessage[],
  signal?: AbortSignal,
  mode: ConfiguratorMode = 'assistant',
): Promise<ConfiguratorResponse> {
  return apiFetch<ConfiguratorResponse>('/v1/configurator/message', {
    method: 'POST',
    body: JSON.stringify(configuratorBody(session, messages, mode)),
    headers: configuratorHeaders(session),
    ...(signal ? { signal } : {}),
  });
}
