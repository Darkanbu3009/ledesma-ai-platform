import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import type { AgentConfig } from './agents';
import type { AgentUsage, UsageRange } from './usage';

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => apiFetch<{ agents: AgentConfig[] }>('/v1/agents').then((r) => r.agents),
  });
}

export function useAgent(id: string | undefined) {
  return useQuery({
    queryKey: ['agents', id],
    queryFn: () => apiFetch<{ agent: AgentConfig }>(`/v1/agents/${id}`).then((r) => r.agent),
    enabled: Boolean(id),
  });
}

export function useAgentUsage(id: string | undefined, range: UsageRange = {}) {
  // Solo los campos presentes del rango viajan en el querystring.
  const params = new URLSearchParams();
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  const query = params.toString();
  return useQuery({
    queryKey: ['agents', id, 'usage', range.from ?? null, range.to ?? null],
    queryFn: () => apiFetch<AgentUsage>(`/v1/agents/${id}/usage${query ? `?${query}` : ''}`),
    enabled: Boolean(id),
  });
}
