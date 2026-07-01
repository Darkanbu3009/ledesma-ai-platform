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
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskPatch,
} from './scheduled-tasks';
import type {
  CreateTriggerInput,
  CreateTriggerResponse,
  TriggerUpdate,
  UpdateTriggerResponse,
} from './triggers';
import type { CreateRecipeInput, Recipe, RecipePatch, RunRecipeResult } from './recipes';
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

/** Programa una tarea nueva (POST /v1/scheduled-tasks). Refresca la lista al crearla. */
export function useCreateScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScheduledTaskInput) =>
      apiFetch<{ task: ScheduledTask }>('/v1/scheduled-tasks', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((r) => r.task),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['scheduled-tasks'] }),
  });
}

/** Edita una tarea (PATCH): activar/pausar (isActive) o cambiar cron/payload. Refresca la lista. */
export function useUpdateScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ScheduledTaskPatch }) =>
      apiFetch<{ task: ScheduledTask }>(`/v1/scheduled-tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }).then((r) => r.task),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['scheduled-tasks'] }),
  });
}

/** Borra una tarea (DELETE). Refresca la lista al eliminarla. */
export function useDeleteScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/v1/scheduled-tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['scheduled-tasks'] }),
  });
}

/**
 * Crea un trigger por evento (POST /v1/triggers). Devuelve la RESPUESTA COMPLETA (no solo el trigger):
 * incluye el secreto/URL con token que se muestra UNA sola vez. Refresca la lista al crearlo.
 */
export function useCreateTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTriggerInput) =>
      apiFetch<CreateTriggerResponse>('/v1/triggers', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['triggers'] }),
  });
}

/**
 * Edita un trigger (PATCH): activar/pausar (isActive) o ROTAR el secreto/token (rotate). Devuelve la
 * respuesta completa: al rotar trae el material nuevo (una sola vez). Refresca la lista.
 */
export function useUpdateTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: TriggerUpdate }) =>
      apiFetch<UpdateTriggerResponse>(`/v1/triggers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['triggers'] }),
  });
}

/** Borra un trigger (DELETE). Refresca la lista al eliminarlo. */
export function useDeleteTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/v1/triggers/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['triggers'] }),
  });
}

/** Crea una receta (POST /v1/recipes). Refresca la lista al crearla. */
export function useCreateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRecipeInput) =>
      apiFetch<{ recipe: Recipe }>('/v1/recipes', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((r) => r.recipe),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['recipes'] }),
  });
}

/**
 * Edita una receta (PATCH): name/description/steps (form de edicion) o activar/pausar (isActive, toggle
 * de la lista). Refresca la lista y el detalle de esa receta.
 */
export function useUpdateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: RecipePatch }) =>
      apiFetch<{ recipe: Recipe }>(`/v1/recipes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }).then((r) => r.recipe),
    onSuccess: (_recipe, { id }) => {
      void qc.invalidateQueries({ queryKey: ['recipes'] });
      void qc.invalidateQueries({ queryKey: ['recipes', id] });
    },
  });
}

/** Borra una receta (DELETE). Refresca la lista al eliminarla. */
export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/v1/recipes/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['recipes'] }),
  });
}

/**
 * EJECUTAR AHORA una receta (POST /v1/recipes/:id/run): encola un job; el worker la corre en segundo
 * plano (asincrono, sin resultado inline). Refresca la lista para reflejar el nuevo last_run_at.
 */
export function useRunRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<RunRecipeResult>(`/v1/recipes/${id}/run`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['recipes'] }),
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
