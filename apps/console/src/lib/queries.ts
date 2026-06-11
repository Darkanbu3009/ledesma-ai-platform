import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import type { AgentConfig } from './agents';
import type { AgentUsage } from './usage';

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

export function useAgentUsage(id: string | undefined) {
  return useQuery({
    queryKey: ['agents', id, 'usage'],
    queryFn: () => apiFetch<AgentUsage>(`/v1/agents/${id}/usage`),
    enabled: Boolean(id),
  });
}
