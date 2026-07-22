import { useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
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
import type { JobActivity, JobsPage, JobStatusFilter } from './jobs';
import { JOB_PAGE_SIZE, JOBS_REFETCH_MS, buildJobsQuery, hasInFlightJobs, isJobInFlight } from './jobs';
import type { SitioConectado } from './sitios';
import type { Trayectoria } from './trayectorias';
import { JOB_SEGUIMIENTO_REFETCH_MS, SITIOS_REFETCH_MS, haySitiosEnTransicion } from './sitios';
import type { ConsentsState, DataRequest } from './privacy';
import type { AprobacionWeb } from './aprobaciones';
import { APROBACIONES_REFETCH_MS, obtenerScreenshotUrl } from './aprobaciones';
import type { AdminUserDetail, AdminUsersResponse } from './admin';
import { ADMIN_USERS_PAGE_SIZE, buildAdminUsersQuery } from './admin';
import type { MyUpgradeRequestsState } from './upgrade-requests';
import type { OnboardingProgress } from './onboarding';
import { deriveOnboardingProgress, hasRunFromSummary, onboardingRunWindow } from './onboarding';

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
 * TRAYECTORIA de una tarea web (GET /v1/trayectorias?jobId=..., Fase F V030): las ejecuciones del
 * motor de navegacion registradas para un job, con sus pasos censurados. Solo corre con `enabled`
 * (la tarjeta de actividad la pide recien al expandir la tarea: no se descargan pasos que nadie
 * abrio). Sin auto-refresh: la trayectoria se escribe UNA vez al cerrar la ejecucion.
 */
export function useTrayectoriasDeJob(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['trayectorias', jobId],
    queryFn: () =>
      apiFetch<{ trayectorias: Trayectoria[] }>(`/v1/trayectorias?jobId=${jobId}`).then(
        (r) => r.trayectorias,
      ),
    enabled,
  });
}

/**
 * SITIOS CONECTADOS del usuario (GET /v1/sitios). AUTO-REFRESH PRUDENTE, mismo criterio que useJobs:
 * reconsulta cada SITIOS_REFETCH_MS SOLO mientras hay una conexion en transicion (esperando_login) o
 * mientras `pollingExtra` (evaluado sobre la lista ya cargada) lo pida: la pagina lo usa cuando un
 * job de conectar/eliminar sigue en vuelo y su efecto aun no se refleja en la lista. Si todo esta
 * estable, no toca el API. Polling via refetchInterval de react-query, sin useEffect.
 */
export function useSitios(pollingExtra?: (sitios: SitioConectado[]) => boolean) {
  return useQuery({
    queryKey: ['sitios'],
    queryFn: () => apiFetch<{ sitios: SitioConectado[] }>('/v1/sitios').then((r) => r.sitios),
    refetchInterval: (query) => {
      const sitios = query.state.data ?? [];
      const extra = pollingExtra ? pollingExtra(sitios) : false;
      return extra || haySitiosEnTransicion(sitios) ? SITIOS_REFETCH_MS : false;
    },
  });
}

/**
 * SEGUIMIENTO de UN job encolado por la propia pagina (GET /v1/jobs/:id): el patron de polling del
 * historial (V017) aplicado a un job puntual. Reconsulta cada JOB_SEGUIMIENTO_REFETCH_MS mientras el
 * job sigue en vuelo (pending/running, mismo isJobInFlight del historial) y se detiene sola al llegar
 * a un estado terminal. Solo corre con un jobId presente. Polling con react-query, sin useEffect.
 */
function jobSeguimientoQueryOptions(jobId: string | null) {
  return {
    queryKey: ['jobs', 'detalle', jobId] as const,
    queryFn: () => apiFetch<{ job: JobActivity }>(`/v1/jobs/${jobId}`).then((r) => r.job),
    enabled: Boolean(jobId),
    refetchInterval: (query: { state: { data?: JobActivity } }) => {
      const job = query.state.data;
      return !job || isJobInFlight(job.status) ? JOB_SEGUIMIENTO_REFETCH_MS : false;
    },
  };
}

export function useJobSeguimiento(jobId: string | null) {
  return useQuery(jobSeguimientoQueryOptions(jobId));
}

/**
 * SEGUIMIENTO de VARIOS jobs a la vez (useQueries sobre las mismas opciones que useJobSeguimiento):
 * lo usa la pagina de sitios para vigilar N borrados forzados en paralelo sin perder ninguno (cada
 * uno con su propio polling, que se apaga solo al llegar el job a un estado terminal). El resultado
 * llega EN EL MISMO ORDEN que `jobIds` (garantia de useQueries), asi el llamador aparea por indice.
 */
export function useJobsSeguimiento(jobIds: string[]) {
  return useQueries({ queries: jobIds.map((jobId) => jobSeguimientoQueryOptions(jobId)) });
}

/**
 * APROBACIONES PENDIENTES de checkpoints de tareas web (GET /v1/aprobaciones?estado=pendiente).
 * Polling con refetchInterval (patron V017, sin useEffect) a intervalo FIJO: una aprobacion puede
 * aparecer en cualquier momento (la crea el worker) y expira en minutos, asi que no hay dato local
 * con el que "apagar" el polling; la query es un select indexado y barato, y react-query ya no
 * consulta con la pestana en background (refetchIntervalInBackground=false por defecto).
 */
export function useAprobacionesPendientes() {
  return useQuery({
    queryKey: ['aprobaciones', 'pendiente'],
    queryFn: () =>
      apiFetch<{ aprobaciones: AprobacionWeb[] }>('/v1/aprobaciones?estado=pendiente').then(
        (r) => r.aprobaciones,
      ),
    refetchInterval: APROBACIONES_REFETCH_MS,
  });
}

/**
 * Signed URL del screenshot de una aprobacion (bucket privado, RLS propia, TTL corto). Se firma
 * con la sesion del usuario via el cliente de Supabase; null = sin screenshot o firma fallida (el
 * modal decide igual con la descripcion). La queryKey por path evita re-firmar en cada render.
 */
export function useScreenshotAprobacion(path: string | null) {
  return useQuery({
    queryKey: ['aprobaciones', 'screenshot', path],
    queryFn: () => obtenerScreenshotUrl(path),
    enabled: path !== null,
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

/**
 * Solicitudes de upgrade del usuario actual (GET /v1/upgrade-requests/me), mas nuevas primero. La usa el CTA
 * de los gates de tier para saber si el usuario YA pidio acceso (y mostrar "Solicitud enviada" en vez de
 * re-ofrecer el boton). Devuelve [] si nunca solicito.
 */
export function useMyUpgradeRequests() {
  return useQuery({
    queryKey: ['upgrade-requests', 'me'],
    queryFn: () => apiFetch<MyUpgradeRequestsState>('/v1/upgrade-requests/me'),
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

/**
 * PANEL DE ADMIN -- LISTADO de usuarios de la plataforma (GET /v1/admin/users), paginado con "cargar mas"
 * (useInfiniteQuery), mismo patron que useJobs. Cada pagina trae ADMIN_USERS_PAGE_SIZE usuarios;
 * getNextPageParam avanza el offset mientras el backend diga hasMore. El termino de busqueda va en la
 * queryKey: cambiarlo arranca una lista nueva (y resetea el "cargar mas"). Solo lo consume el area /admin,
 * que ya vive detras del AdminGate; el backend igual gatea por rol (403 a un no-admin).
 */
export function useAdminUsers(search?: string) {
  const term = search?.trim() ? search.trim() : undefined;
  return useInfiniteQuery({
    queryKey: ['admin', 'users', 'list', term ?? null],
    queryFn: ({ pageParam }) =>
      apiFetch<AdminUsersResponse>(
        `/v1/admin/users${buildAdminUsersQuery({ limit: ADMIN_USERS_PAGE_SIZE, offset: pageParam, search: term })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.offset + lastPage.pagination.limit : undefined,
  });
}

/** PANEL DE ADMIN -- FICHA de un usuario objetivo (GET /v1/admin/users/:id). Solo corre con un id presente. */
export function useAdminUser(id: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'users', 'detail', id],
    queryFn: () => apiFetch<AdminUserDetail>(`/v1/admin/users/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * PANEL DE ADMIN -- ACTIVIDAD de un usuario objetivo (GET /v1/admin/users/:id/activity). Devuelve el MISMO
 * shape que el dashboard del propio usuario (DashboardSummary): los tres ejes, pero del :id objetivo. El
 * rango (?from/?to) va en la queryKey; keepPreviousData evita el salto al skeleton al cambiar de preset
 * (refetch silencioso), igual que useDashboard. Solo corre con un id presente.
 */
export function useAdminUserActivity(id: string | undefined, range: UsageRange = {}) {
  const query = dashboardQueryString(range);
  return useQuery({
    queryKey: ['admin', 'users', 'activity', id, range.from ?? null, range.to ?? null],
    queryFn: () => apiFetch<DashboardSummary>(`/v1/admin/users/${id}/activity${query}`),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
}

/** Progreso del onboarding derivado de datos reales, mas el estado de carga/error y el id del primer agente. */
export interface OnboardingProgressResult extends OnboardingProgress {
  /** Id del primer agente del usuario (para el CTA "Ejecutar" -> /agentes/:id/playground). null si aun no hay. */
  firstAgentId: string | null;
  /** true mientras ALGUNA de las tres senales aun no resolvio: la UI espera para no parpadear un "0 de 3" falso. */
  isLoading: boolean;
  /** true si ALGUNA senal fallo: la UI se oculta para no afirmar un estado que el dato real no confirmo. */
  isError: boolean;
}

/**
 * SENAL DE PROGRESO del onboarding guiado, DERIVADA de datos REALES (sin persistir estado en el cliente,
 * sin localStorage, sin backend nuevo). Combina tres hooks ya existentes:
 *  - hasCredential <- useCredentials (GET /v1/credentials): tiene >=1 credencial.
 *  - hasAgent      <- useAgents (GET /v1/agents): tiene >=1 agente.
 *  - hasRun        <- useDashboard con VENTANA AMPLIA (onboardingRunWindow, 365d): el resumen owner-scoped
 *    de agent_runs. Se pide 365d (no la ventana por defecto de 30d) para que la senal sea DURABLE: un
 *    usuario establecido que ya ejecuto no vuelve a ver el paso 3 como pendiente por estar inactivo. El
 *    rango se memoiza (estable durante el montaje) para no rehacer la query en cada render. Reusa el mismo
 *    endpoint del Panel; una corrida del Playground ya cuenta (se registra con el owner_id del agente).
 *    Nota: el Panel consulta /v1/dashboard con su propio preset, asi que esta es una peticion adicional
 *    (query key distinta) -- por diseno: mantiene la senal estable frente al selector de rango del Panel.
 *
 * `isComplete` cuando las tres son verdaderas: ahi el checklist y la bienvenida se ocultan. Veraz: un
 * paso solo se marca hecho si su dato real lo dice; ante error no se afirma nada (isError -> la UI se oculta).
 */
export function useOnboardingProgress(): OnboardingProgressResult {
  const credentials = useCredentials();
  const agents = useAgents();
  // Memoizado en el montaje: fija un `from` estable (evita una queryKey distinta -> refetch en cada render).
  const runWindow = useMemo(() => onboardingRunWindow(), []);
  const dashboard = useDashboard(runWindow);

  const isLoading = credentials.isLoading || agents.isLoading || dashboard.isLoading;
  const isError = credentials.isError || agents.isError || dashboard.isError;
  const hasCredential = (credentials.data?.length ?? 0) > 0;
  const hasAgent = (agents.data?.length ?? 0) > 0;
  const hasRun = dashboard.data ? hasRunFromSummary(dashboard.data) : false;
  const progress = deriveOnboardingProgress({ hasCredential, hasAgent, hasRun });

  return { ...progress, firstAgentId: agents.data?.[0]?.id ?? null, isLoading, isError };
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
