import { isValidCronExpression } from './cron';

/**
 * Tipos y logica pura de las TAREAS PROGRAMADAS en la consola. Espeja la forma camelCase que devuelve
 * el backend (GET/POST/PATCH /v1/scheduled-tasks, ver apps/backend/src/routes/scheduled-tasks.ts y
 * scheduled-tasks-repository.ts). Sin React ni red: la validacion del formulario y el armado del body
 * se testean como funciones puras, igual que credential-schema.ts.
 */

/** Un mensaje del payload que ejecuta el agente cada vez que corre (mismo shape que un job). */
export interface ScheduledTaskMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Payload fijo de la tarea: los mensajes que se ejecutan en cada disparo. */
export interface ScheduledTaskPayload {
  messages: ScheduledTaskMessage[];
  maxIterations?: number;
}

/** Una tarea programada tal como la devuelve el backend (campos camelCase, timestamps ISO o null). */
export interface ScheduledTask {
  id: string;
  ownerId: string;
  agentId: string;
  credentialId: string;
  /** Horario en cron estandar de 5 campos (interpretado en UTC por el backend). */
  cronExpression: string;
  payload: ScheduledTaskPayload;
  /** Pausada/activa: solo las activas se disparan. */
  isActive: boolean;
  /** Ultima ejecucion encolada (ISO) o null si nunca corrio. */
  lastRunAt: string | null;
  /** Proximo horario en que toca correr (ISO) o null. */
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Body de POST /v1/scheduled-tasks. owner_id lo pone el backend desde el JWT. */
export interface CreateScheduledTaskInput {
  agentId: string;
  credentialId: string;
  cronExpression: string;
  payload: ScheduledTaskPayload;
}

/** Body de PATCH /v1/scheduled-tasks/:id. Al menos un campo; el backend fusiona sobre la tarea actual. */
export interface ScheduledTaskPatch {
  cronExpression?: string;
  payload?: ScheduledTaskPayload;
  isActive?: boolean;
}

/** Estado crudo del formulario de alta, antes de validar. cronExpression sale del selector de horario. */
export interface ScheduledTaskDraft {
  agentId: string;
  credentialId: string;
  message: string;
  cronExpression: string;
}

export type ScheduledTaskDraftErrors = Partial<
  Record<'agentId' | 'credentialId' | 'message' | 'cronExpression', string>
>;

/**
 * Valida el borrador del formulario en cliente (espejo del backend: agente, credencial, mensaje no
 * vacio y cron valido). Devuelve un mapa de errores por campo; vacio = valido. El backend sigue
 * siendo la autoridad (revalida y puede devolver 400/403/404).
 */
export function validateScheduledTaskDraft(draft: ScheduledTaskDraft): ScheduledTaskDraftErrors {
  const errors: ScheduledTaskDraftErrors = {};
  if (draft.agentId.trim() === '') {
    errors.agentId = 'Elige el agente que se va a ejecutar.';
  }
  if (draft.credentialId.trim() === '') {
    errors.credentialId = 'Elige la credencial que va a usar.';
  }
  if (draft.message.trim() === '') {
    errors.message = 'Escribe el mensaje que ejecutara el agente.';
  }
  if (!isValidCronExpression(draft.cronExpression)) {
    errors.cronExpression = 'Define un horario valido.';
  }
  return errors;
}

/**
 * Arma el body del POST desde el borrador ya validado. El mensaje se mapea a payload.messages con un
 * unico mensaje de rol 'user' (lo que el backend espera). Recorta espacios sobrantes.
 */
export function toScheduledTaskApiInput(draft: ScheduledTaskDraft): CreateScheduledTaskInput {
  return {
    agentId: draft.agentId,
    credentialId: draft.credentialId,
    cronExpression: draft.cronExpression.trim(),
    payload: {
      messages: [{ role: 'user', content: draft.message.trim() }],
    },
  };
}
