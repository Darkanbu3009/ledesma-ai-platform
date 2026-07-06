import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import type { AgentConfig } from './agents';
import type { ProviderCredential } from './credentials';
import type { AgentUsage, UsageRange } from './usage';
import type { DashboardSummary } from './dashboard';
import { dashboardQueryString } from './dashboard';
import type { RegistrationState } from './registration';
import { deriveIsAdmin } from './registration';
import type { ScheduledTask } from './scheduled-tasks';
import type { Trigger } from './triggers';
import type { Recipe, RecipeSummary } from './recipes';
import type { JobsPage, JobStatusFilter } from './jobs';
import { JOB_PAGE_SIZE, JOBS_REFETCH_MS, buildJobsQuery, hasInFlightJobs } from './jobs';
import type { ConsentsState, DataRequest } from './privacy';

/** Estado de registro del usuario actual (perfil, organizacion, plan y uso). */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<RegistrationState>('/v1/me'),
  });
}

/**
 * Deriva de /v1/me (useMe) si el usuario actual es super-admin de plataforma, con su estado de carga.
 * NO hace un fetch nuevo: reusa la query ['me'] que ya consumen los gates de registro/consentimiento,
 * asi que cuando la consola llega al layout el dato ya suele estar en cache (sin parpadeo del item de
 * admin). isAdmin es fail-closed: false mientras carga o si el backend no marca el flag.
 *
 * IMPORTANTE: esto es UX cosmetica (mostrar/ocultar el area de admin). La seguridad real es server-side:
 * requireAdminRole gatea los endpoints admin y un no-admin recibe 403 aunque forzara la ruta.
 */
export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const { data, isLoading } = useMe();
  return { isAdmin: deriveIsAdmin(data), isLoading };
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
 * HISTORIAL DE EJECUCIONES del usuario (GET /v1/jobs), paginado con "cargar mas" (useInfiniteQuery).
 * Cada pagina trae JOB_PAGE_SIZE jobs; getNextPageParam avanza el offset mientras el backend diga
 * hasMore. El filtro por estado va en la queryKey: cambiarlo arranca una lista nueva.
 *
 * AUTO-REFRESH PRUDENTE: refetchInterval reconsulta cada JOBS_REFETCH_MS SOLO si hay algun job en vuelo
 * (pending/running) entre los cargados; si todo esta en estado terminal, devuelve false y no toca el API
 * (no lo martillamos cuando no hay nada que pueda cambiar).
 */
export function useJobs(status: JobStatusFilter = 'all') {
  return useInfiniteQuery({
    queryKey: ['jobs', status],
    queryFn: ({ pageParam }) =>
      apiFetch<JobsPage>(`/v1/jobs${buildJobsQuery({ limit: JOB_PAGE_SIZE, offset: pageParam, status })}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.offset + lastPage.pagination.limit : undefined,
    refetchInterval: (query) => {
      const jobs = query.state.data?.pages.flatMap((page) => page.jobs) ?? [];
      return hasInFlightJobs(jobs) ? JOBS_REFETCH_MS : false;
    },
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

/**
 * RESUMEN del dashboard del owner (GET /v1/dashboard): los tres ejes -- actividad, operaciones y gasto
 * -- en una sola lectura agregada. El rango (?from/?to) va en la queryKey: cambiar el preset arranca una
 * consulta nueva. Sin gate por tier: cada quien ve su propio dashboard. Solo lectura.
 */
export function useDashboard(range: UsageRange = {}) {
  const query = dashboardQueryString(range);
  return useQuery({
    queryKey: ['dashboard', range.from ?? null, range.to ?? null],
    queryFn: () => apiFetch<DashboardSummary>(`/v1/dashboard${query}`),
    // Al cambiar de rango la queryKey cambia: sin esto la vista se remontaria al SkeletonList (salto de
    // layout) y el indicador "Actualizando" no aparecia. keepPreviousData conserva los datos del rango
    // anterior mientras carga el nuevo, asi el refetch es silencioso (isLoading=false, isFetching=true).
    placeholderData: keepPreviousData,
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
