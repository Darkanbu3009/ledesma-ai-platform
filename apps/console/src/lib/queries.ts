import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import type { AgentConfig } from './agents';
import type { ProviderCredential } from './credentials';
import type { AgentUsage, UsageRange } from './usage';
import type { RegistrationState } from './registration';
import type { ScheduledTask } from './scheduled-tasks';
import type { Trigger } from './triggers';
import type { Recipe, RecipeSummary } from './recipes';
import type { ConsentsState, DataRequest } from './privacy';

/** Estado de registro del usuario actual (perfil, organizacion, plan y uso). */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<RegistrationState>('/v1/me'),
  });
}

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => apiFetch<{ agents: AgentConfig[] }>('/v1/agents').then((r) => r.agents),
  });
}

/** Lista la metadata de las credenciales del usuario (sin la key, por diseno del backend). */
export function useCredentials() {
  return useQuery({
    queryKey: ['credentials'],
    queryFn: () =>
      apiFetch<{ credentials: ProviderCredential[] }>('/v1/credentials').then((r) => r.credentials),
  });
}

/** Lista las tareas programadas del usuario (mas nuevas primero, tal como las ordena el backend). */
export function useScheduledTasks() {
  return useQuery({
    queryKey: ['scheduled-tasks'],
    queryFn: () =>
      apiFetch<{ tasks: ScheduledTask[] }>('/v1/scheduled-tasks').then((r) => r.tasks),
  });
}

/** Lista los triggers por evento del usuario (mas nuevos primero). Sin material de auth (por diseno). */
export function useTriggers() {
  return useQuery({
    queryKey: ['triggers'],
    queryFn: () => apiFetch<{ triggers: Trigger[] }>('/v1/triggers').then((r) => r.triggers),
  });
}

/** Lista las recetas del usuario (resumen con stepCount, sin los pasos). Mas nuevas primero. */
export function useRecipes() {
  return useQuery({
    queryKey: ['recipes'],
    queryFn: () => apiFetch<{ recipes: RecipeSummary[] }>('/v1/recipes').then((r) => r.recipes),
  });
}

/** Detalle de UNA receta CON sus pasos (para editar). Solo corre cuando hay un id presente. */
export function useRecipe(id: string | undefined) {
  return useQuery({
    queryKey: ['recipes', id],
    queryFn: () => apiFetch<{ recipe: Recipe }>(`/v1/recipes/${id}`).then((r) => r.recipe),
    enabled: Boolean(id),
  });
}

/**
 * Estado de consentimiento del titular (GET /v1/consents/me): que acepto, versiones vigentes y `missing`
 * (documentos cuya version vigente falta aceptar). El ConsentGate usa `missing` para decidir si solicita
 * la aceptacion. El backend es la autoridad del calculo.
 */
export function useConsents() {
  return useQuery({
    queryKey: ['consents'],
    queryFn: () => apiFetch<ConsentsState>('/v1/consents/me'),
  });
}

/** Lista las solicitudes de derechos del titular (ARCO/GDPR), mas nuevas primero. */
export function useDataRequests() {
  return useQuery({
    queryKey: ['data-requests'],
    queryFn: () => apiFetch<{ requests: DataRequest[] }>('/v1/data-requests').then((r) => r.requests),
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
