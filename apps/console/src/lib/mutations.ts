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

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/v1/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}
