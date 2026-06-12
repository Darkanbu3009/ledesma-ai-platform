import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';
import type { AgentConfig } from './agents';
import type { AgentFormParsed } from './agent-schema';
import { toApiInput } from './agent-schema';

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
