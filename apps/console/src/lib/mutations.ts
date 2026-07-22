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
  Profile,
  ProfileTier,
  RegistrationResult,
  RegistrationState,
  UpdateProfileNameInput,
  UpdateProfilePaisInput,
} from './registration';
import type { Consent, CreateConsentInput, CreateDataRequestInput, DataRequest } from './privacy';
import type { CreateUpgradeRequestInput, CreateUpgradeRequestResult } from './upgrade-requests';
import type { ConexionAceptada, SitioJobAceptado } from './sitios';
import type { AprobacionWeb } from './aprobaciones';
import type { PlanId } from './plans';

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

/** Registra una empresa: crea la organizacion activa + plan free; el usuario queda org_admin y entra directo. */
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

/**
 * Edita el PROPIO nombre del usuario (PATCH /v1/me/profile con { fullName }). Reusa el patron de
 * useRegisterIndividual: el endpoint devuelve el estado consolidado (misma forma que GET /v1/me), asi que
 * al exito refrescamos la cache ['me'] con setQueryData -- sin una segunda lectura -- y toda la consola
 * (Sidebar, gates, pantalla de perfil) ve el nombre nuevo de inmediato. El backend valida el mismo
 * criterio de nombre que el registro y descarta cualquier otro campo del body (no puede tocar
 * tier/role/is_admin). Los errores (400/401/404) los mapea la UI con updateProfileNameErrorMessage.
 */
export function useUpdateProfileName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileNameInput) =>
      apiFetch<RegistrationState>('/v1/me/profile', {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (state) => {
      qc.setQueryData<RegistrationState>(['me'], state);
    },
  });
}

/**
 * Declara o cambia el PROPIO pais del usuario (PATCH /v1/me/profile con { pais }, ISO 3166-1
 * alpha-2). Mismo patron que useUpdateProfileName: el endpoint devuelve el estado consolidado y se
 * refresca la cache ['me'] con setQueryData, asi la pagina de Sitios ve el pais recien declarado de
 * inmediato (y no lo vuelve a pedir). El backend normaliza a mayusculas y whitelistea el campo.
 */
export function useUpdateProfilePais() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfilePaisInput) =>
      apiFetch<RegistrationState>('/v1/me/profile', {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (state) => {
      qc.setQueryData<RegistrationState>(['me'], state);
    },
  });
}

/**
 * Registra la aceptacion de uno o mas documentos (consentimiento versionado). Recibe un array (uno por
 * documento faltante) y los envia todos; refresca el estado de consentimiento al terminar. La aceptacion
 * es EXPLICITA: la dispara el usuario al marcar el check y confirmar (nunca automatica).
 */
export function useAcceptConsents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inputs: CreateConsentInput[]) =>
      Promise.all(
        inputs.map((input) =>
          apiFetch<{ consent: Consent }>('/v1/consents', {
            method: 'POST',
            body: JSON.stringify(input),
          }).then((r) => r.consent),
        ),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['consents'] }),
  });
}

/** Crea una solicitud de derechos del titular (ARCO/GDPR). Refresca la lista al crearla. */
export function useCreateDataRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDataRequestInput) =>
      apiFetch<{ request: DataRequest }>('/v1/data-requests', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((r) => r.request),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['data-requests'] }),
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

/**
 * CONECTAR UN SITIO (POST /v1/sitios/conectar): encola kind:'conectar_sitio' con la URL que pego el
 * usuario (LA UNICA entrada humana del flujo: jamas viaja una contrasena por aqui). Devuelve el jobId
 * para que la pagina siga el job con useJobSeguimiento y el dominio para ubicar la fila que
 * aparecera en 'esperando_login' con su vista en vivo. Refresca la lista al aceptarse.
 */
/**
 * CONECTAR: el body lleva la URL que pego el usuario Y el pais DECLARADO en su perfil (la pagina lo
 * garantiza pidiendolo antes de la primera conexion). El backend ademas cae al pais del perfil si el
 * body no lo trajera (defensa en profundidad); jamas se pinea un default silencioso.
 */
export function useConectarSitio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; pais: string }) =>
      apiFetch<ConexionAceptada>('/v1/sitios/conectar', {
        method: 'POST',
        body: JSON.stringify({ url: input.url, pais: input.pais }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sitios'] }),
  });
}

/**
 * CONFIRMAR el login de un sitio (POST /v1/sitios/:id/confirmar): el usuario avisa que YA inicio
 * sesion en la vista en vivo; se encola kind:'confirmar_conexion' (el worker hereda y cifra el
 * contexto y marca 'activo'). Refresca la lista; el auto-refresh de useSitios sigue la transicion.
 */
export function useConfirmarSitio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<SitioJobAceptado>(`/v1/sitios/${id}/confirmar`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sitios'] }),
  });
}

/**
 * ELIMINAR un sitio con BORRADO FORZADO (DELETE /v1/sitios/:id?force=true): LA UNICA salida de la
 * UI y la garantizada desde cualquier estado. El worker intenta cerrar/borrar en el proveedor
 * best-effort, pero el registro local y la constancia ARCO se completan pase lo que pase con
 * Browserbase. La UI SIEMPRE lo dispara tras una confirmacion explicita (EliminarSitioDialog).
 * El DELETE sin force (flujo limpio) sigue existiendo en el backend pero la consola ya no lo usa.
 */
export function useEliminarSitio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<SitioJobAceptado>(`/v1/sitios/${id}?force=true`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sitios'] }),
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

/**
 * PANEL DE ADMIN -- CAMBIO DE TIER atribuible (PUT /v1/admin/users/:id/tier): la UNICA mutacion del panel y
 * la palanca de monetizacion (sube/baja el plan de un usuario). El backend la gatea por rol (403 a un
 * no-admin) y la registra en el audit log con el actor real. La UI SIEMPRE la dispara tras una
 * confirmacion explicita (accion sensible; ver ChangeTierDialog).
 *
 * Al exito invalida el arbol ['admin'] completo: la ficha del usuario (para reflejar el tier nuevo) y el
 * listado (donde tambien se muestra el tier). No hace optimistic update: esperamos la respuesta real del
 * backend antes de refrescar, para no mostrar un cambio que el gate podria rechazar.
 */
export function useChangeTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tier }: { id: string; tier: ProfileTier }) =>
      apiFetch<{ profile: Profile }>(`/v1/admin/users/${id}/tier`, {
        method: 'PUT',
        body: JSON.stringify({ tier }),
      }).then((r) => r.profile),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}

/**
 * SELECCION SELF-SERVICE DE PLAN (POST /v1/subscription/select): activa el plan elegido AL INSTANTE
 * para el owner autenticado (lanzamiento gratuito, sin cobro; Stripe gobernara esto despues). El
 * backend escribe subscriptions.plan/status + profiles.tier y devuelve el estado consolidado (misma
 * forma que GET /v1/me): al exito refrescamos la cache ['me'] con setQueryData, igual que
 * useUpdateProfileName, asi los gates de Recetas/Tareas/Triggers (que leen useMe) se desbloquean o
 * re-bloquean SIN recargar la pagina. Idempotente en el backend: reelegir el plan actual responde ok.
 */
export function useSelectPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planId: PlanId) =>
      apiFetch<RegistrationState>('/v1/subscription/select', {
        method: 'POST',
        body: JSON.stringify({ planId }),
      }),
    onSuccess: (state) => {
      qc.setQueryData<RegistrationState>(['me'], state);
    },
  });
}

/**
 * SOLICITAR ACCESO a un plan superior desde un gate de tier (POST /v1/upgrade-requests). Registra el interes
 * del usuario 'free' por una feature premium (requestedTier + featureContext); el backend es idempotente
 * (una 'pending' por owner+tier: un segundo click devuelve la existente con created:false). NO sube el tier
 * -- la conversion la gestiona el admin; el enforcement server-side queda intacto. Al exito invalida
 * ['upgrade-requests','me'] para que el CTA pase a "Solicitud enviada".
 */
export function useRequestUpgrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUpgradeRequestInput) =>
      apiFetch<CreateUpgradeRequestResult>('/v1/upgrade-requests', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['upgrade-requests', 'me'] }),
  });
}

/**
 * APROBAR un checkpoint de tarea web (POST /v1/aprobaciones/:id/aprobar, 7.1e): la accion pendiente
 * queda AUTORIZADA, el backend registra la intervencion Art.22 y devuelve el job pausado a la cola;
 * el worker reanuda LA MISMA sesion y ejecuta la accion. Un 409 significa que la aprobacion ya fue
 * decidida o expiro (doble click / carrera con el barrido): la UI refresca la lista y lo muestra.
 * Al exito invalida ['aprobaciones'] (el banner/modal desaparecen) y ['jobs'] (el job vuelve a
 * moverse en /actividad).
 */
export function useAprobarAprobacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ aprobacion: AprobacionWeb; jobReanudado: boolean }>(
        `/v1/aprobaciones/${id}/aprobar`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['aprobaciones'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

/**
 * RECHAZAR un checkpoint (POST /v1/aprobaciones/:id/rechazar). Sin instruccion la tarea aborta
 * limpia; con instruccion, esta entra como mensaje del usuario y la tarea continua con ese ajuste
 * SIN ejecutar la accion original. Mismas invalidaciones y semantica de 409 que aprobar.
 */
export function useRechazarAprobacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, instruccion }: { id: string; instruccion?: string }) =>
      apiFetch<{ aprobacion: AprobacionWeb; jobReanudado: boolean }>(
        `/v1/aprobaciones/${id}/rechazar`,
        {
          method: 'POST',
          body: JSON.stringify(instruccion !== undefined && instruccion !== '' ? { instruccion } : {}),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['aprobaciones'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
