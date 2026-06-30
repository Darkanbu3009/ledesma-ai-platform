import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';
import type { AgentConfig } from './agents';
import type { AgentFormParsed } from './agent-schema';
import { toApiInput } from './agent-schema';
import type { ProviderCredential } from './credentials';
import type { CredentialFormParsed } from './credential-schema';
import { toCredentialApiInput } from './credential-schema';
import { specToAgentInput, type AgentSpecDraft } from './configurator';
import type {
  IndividualInput,
  OrganizationInput,
  RegistrationResult,
  RegistrationState,
} from './registration';

/** Registra al usuario actual como individuo: queda activo de inmediato. */
export function useRegisterIndividual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IndividualInput) =>
      apiFetch<RegistrationResult>('/v1/register/individual', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (result) => {
      // El endpoint devuelve el estado consolidado: refrescamos la cache de /v1/me sin otra llamada.
      qc.setQueryData<RegistrationState>(['me'], result);
    },
  });
}

/** Registra una empresa: crea la organizacion en 'pending'; el usuario queda org_admin a la espera. */
export function useRegisterOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrganizationInput) =>
      apiFetch<RegistrationResult>('/v1/register/organization', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (result) => {
      qc.setQueryData<RegistrationState>(['me'], result);
    },
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: AgentFormParsed) =>
      apiFetch<{ agent: AgentConfig }>('/v1/agents', {
        method: 'POST',
        body: JSON.stringify(toApiInput(values)),
      }).then((r) => r.agent),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

/**
 * Crea un agente a partir del AgentSpec final del Configurador. REUSA el mismo flujo que el alta
 * manual: POST /v1/agents con el JWT (apiFetch) y la misma invalidacion de la cache de agentes. El
 * spec se mapea al body con specToAgentInput (solo deberia llamarse con validation.ok === true; si el
 * spec estuviera incompleto, la mutacion falla de forma manejable en vez de mandar un body invalido).
 */
export function useCreateAgentFromSpec() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (spec: AgentSpecDraft) => {
      const body = specToAgentInput(spec);
      if (!body) {
        return Promise.reject(new Error('El spec no esta completo para crear el agente'));
      }
      return apiFetch<{ agent: AgentConfig }>('/v1/agents', {
        method: 'POST',
        body: JSON.stringify(body),
      }).then((r) => r.agent);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useUpdateAgent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: AgentFormParsed) =>
      apiFetch<{ agent: AgentConfig }>(`/v1/agents/${id}`, {
        method: 'PUT',
        body: JSON.stringify(toApiInput(values)),
      }).then((r) => r.agent),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useRotateWebhookSecret(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ agent: AgentConfig }>(`/v1/agents/${id}/webhook-secret/rotate`, {
        method: 'POST',
      }).then((r) => r.agent),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agents', id] });
      void qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export interface TestToolResult {
  content: string;
  isError: boolean;
  durationMs: number;
}

/** Prueba una tool GUARDADA del agente contra su webhook real (ejecutor firmado del backend). */
export function useTestTool(agentId: string) {
  return useMutation({
    mutationFn: ({ toolName, input }: { toolName: string; input: Record<string, unknown> }) =>
      apiFetch<TestToolResult>(
        `/v1/agents/${agentId}/tools/${encodeURIComponent(toolName)}/test`,
        { method: 'POST', body: JSON.stringify({ input }) },
      ),
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/v1/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

/** Guarda una credencial nueva. El backend responde solo con metadata (nunca la key). */
export function useCreateCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: CredentialFormParsed) =>
      apiFetch<{ credential: ProviderCredential }>('/v1/credentials', {
        method: 'POST',
        body: JSON.stringify(toCredentialApiInput(values)),
      }).then((r) => r.credential),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['credentials'] }),
  });
}

export function useDeleteCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/v1/credentials/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['credentials'] }),
  });
}
