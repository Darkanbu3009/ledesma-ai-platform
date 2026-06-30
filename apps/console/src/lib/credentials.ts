import type { ProviderId } from './agents';

/**
 * Metadata de una credencial guardada, tal como la devuelve el backend (GET /v1/credentials).
 * NUNCA incluye la apiKey: la boveda solo expone metadata (ver routes/credentials.ts en el backend).
 */
export interface ProviderCredential {
  id: string;
  label: string;
  providerId: ProviderId;
  baseUrl: string | null;
  createdAt: string;
}

/**
 * Credenciales utilizables con un agente de cierto proveedor: SOLO las del mismo providerId. El
 * backend valida el match al ejecutar (rechaza una credencial de otro proveedor); el front filtra
 * antes para no ofrecer las que serian rechazadas (p. ej. en el Playground, segun agent.providerId).
 */
export function compatibleCredentials(
  credentials: ProviderCredential[],
  providerId: ProviderId,
): ProviderCredential[] {
  return credentials.filter((credential) => credential.providerId === providerId);
}
