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
