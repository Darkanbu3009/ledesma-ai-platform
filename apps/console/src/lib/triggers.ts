/**
 * Tipos y logica pura de los TRIGGERS POR EVENTO en la consola. Espeja la forma camelCase que devuelve
 * el backend (GET/POST/PATCH/DELETE /v1/triggers, ver apps/backend/src/routes/triggers.ts y
 * triggers-repository.ts). Sin React ni red: la validacion del formulario, el armado del body del POST
 * y la extraccion del material de auth "de una sola vez" se testean como funciones puras, igual que
 * scheduled-tasks.ts.
 *
 * SEGURIDAD: el secreto HMAC / token-en-URL solo llega en la respuesta de crear o rotar y se muestra
 * UNA sola vez. Este modulo NO lo persiste (ni localStorage ni nada): vive en el estado de React del
 * momento de crear/rotar y desaparece al cerrar el modal.
 */

import i18n from '../i18n';

export type TriggerAuthMode = 'hmac' | 'url_token';

/** Un mensaje del payload base que ejecuta el agente al dispararse (mismo shape que un job). */
export interface TriggerMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Plantilla de payload del trigger: los mensajes base que se ejecutan en cada disparo. */
export interface TriggerPayloadTemplate {
  messages: TriggerMessage[];
  maxIterations?: number;
}

/**
 * Instrucciones de firma que el backend adjunta a un trigger 'hmac' (nombres de headers, algoritmo,
 * ventana anti-replay). La UI las muestra para que el usuario configure su sistema externo. Espeja
 * HMAC_SIGNATURE_INFO del backend (routes/triggers.ts).
 */
export interface HmacSignatureInfo {
  algorithm: string;
  signedPayload: string;
  signatureFormat: string;
  timestampHeader: string;
  signatureHeader: string;
  toleranceSeconds: number;
}

/**
 * Un trigger tal como lo devuelve el LISTADO (GET /v1/triggers) y el campo `trigger` de POST/PATCH:
 * metadata SIN material de auth + la URL entrante. Para 'hmac' incluye las instrucciones de firma. La
 * URL del listado nunca lleva el token de un 'url_token' (ese token solo se vio al crear/rotar).
 */
export interface Trigger {
  id: string;
  ownerId: string;
  agentId: string;
  credentialId: string;
  authMode: TriggerAuthMode;
  payloadTemplate: TriggerPayloadTemplate;
  isActive: boolean;
  /** Ultima vez que un evento lo disparo (ISO) o null si nunca se disparo. */
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** URL entrante del webhook. Para 'url_token' es la URL base (sin el token, que no se re-expone). */
  webhookUrl: string;
  /** Solo 'hmac': como debe firmar el sistema externo cada peticion. */
  signature?: HmacSignatureInfo;
}

/** Body de POST /v1/triggers. owner_id lo pone el backend desde el JWT. */
export interface CreateTriggerInput {
  agentId: string;
  credentialId: string;
  authMode: TriggerAuthMode;
  payloadTemplate: TriggerPayloadTemplate;
}

/** Body de PATCH /v1/triggers/:id: activar/pausar (isActive) y/o ROTAR el secreto/token (rotate). */
export interface TriggerUpdate {
  isActive?: boolean;
  rotate?: boolean;
}

/**
 * Respuesta de POST /v1/triggers. Incluye el material de auth en claro UNA sola vez: `hmacSecret` +
 * `signature` (authMode 'hmac') o `urlToken` con la `webhookUrl` que ya lo lleva embebido (authMode
 * 'url_token'). Despues nunca se vuelve a exponer.
 */
export interface CreateTriggerResponse {
  trigger: Trigger;
  webhookUrl: string;
  hmacSecret?: string;
  signature?: HmacSignatureInfo;
  urlToken?: string;
}

/**
 * Respuesta de PATCH /v1/triggers/:id. El material de auth SOLO viene cuando se roto: `hmacSecret`
 * (hmac) o `urlToken` + `webhookUrl` con el token nuevo (url_token). Un PATCH que solo activa/pausa
 * devuelve unicamente `trigger`.
 */
export interface UpdateTriggerResponse {
  trigger: Trigger;
  hmacSecret?: string;
  urlToken?: string;
  webhookUrl?: string;
}

/**
 * Material de auth a mostrar UNA sola vez en el modal de "copia esto ahora". Union por authMode:
 *  - hmac: la URL del webhook, el secreto en claro y como firmar (headers).
 *  - url_token: la URL COMPLETA con el token embebido (no hay secreto aparte que copiar).
 * Se arma desde la respuesta de crear o rotar y vive solo en el estado de React del momento.
 */
export type TriggerReveal =
  | {
      authMode: 'hmac';
      webhookUrl: string;
      hmacSecret: string;
      signature: HmacSignatureInfo;
    }
  | {
      authMode: 'url_token';
      webhookUrl: string;
    };

/**
 * Extrae el material de auth de la respuesta de CREAR un trigger para mostrarlo una sola vez. Devuelve
 * null si la respuesta no trae el secreto/token esperado (defensivo: nunca abre el modal sin nada que
 * copiar, p. ej. si el backend cambiara el shape).
 */
export function revealFromCreate(res: CreateTriggerResponse): TriggerReveal | null {
  if (res.trigger.authMode === 'hmac') {
    if (!res.hmacSecret || !res.signature) return null;
    return {
      authMode: 'hmac',
      webhookUrl: res.webhookUrl,
      hmacSecret: res.hmacSecret,
      signature: res.signature,
    };
  }
  if (!res.urlToken) return null;
  return { authMode: 'url_token', webhookUrl: res.webhookUrl };
}

/**
 * Extrae el material de auth de la respuesta de ROTAR un trigger para mostrarlo una sola vez. Para
 * 'hmac' las instrucciones de firma viajan en `trigger.signature`; para 'url_token' la URL con el
 * token nuevo viene en `webhookUrl`. Devuelve null si falta el material (p. ej. un PATCH que solo
 * activo/pauso, sin rotar).
 */
export function revealFromUpdate(res: UpdateTriggerResponse): TriggerReveal | null {
  if (res.trigger.authMode === 'hmac') {
    if (!res.hmacSecret || !res.trigger.signature) return null;
    return {
      authMode: 'hmac',
      webhookUrl: res.trigger.webhookUrl,
      hmacSecret: res.hmacSecret,
      signature: res.trigger.signature,
    };
  }
  if (!res.urlToken || !res.webhookUrl) return null;
  return { authMode: 'url_token', webhookUrl: res.webhookUrl };
}

/** Modo de auth por defecto en el formulario: HMAC (recomendado, mas seguro). */
export const DEFAULT_AUTH_MODE: TriggerAuthMode = 'hmac';

/** Estado crudo del formulario de alta, antes de validar. */
export interface TriggerDraft {
  agentId: string;
  credentialId: string;
  message: string;
  authMode: TriggerAuthMode;
}

export type TriggerDraftErrors = Partial<
  Record<'agentId' | 'credentialId' | 'message' | 'authMode', string>
>;

/**
 * Valida el borrador del formulario en cliente (espejo del backend: agente, credencial, mensaje no
 * vacio y un authMode valido). Devuelve un mapa de errores por campo; vacio = valido. El backend sigue
 * siendo la autoridad (revalida y puede devolver 400/403/404).
 */
export function validateTriggerDraft(draft: TriggerDraft): TriggerDraftErrors {
  const errors: TriggerDraftErrors = {};
  if (draft.agentId.trim() === '') {
    errors.agentId = i18n.t('triggers.validacion.agente');
  }
  if (draft.credentialId.trim() === '') {
    errors.credentialId = i18n.t('triggers.validacion.credencial');
  }
  if (draft.message.trim() === '') {
    errors.message = i18n.t('triggers.validacion.mensaje');
  }
  if (draft.authMode !== 'hmac' && draft.authMode !== 'url_token') {
    errors.authMode = i18n.t('triggers.validacion.authMode');
  }
  return errors;
}

/**
 * Arma el body del POST desde el borrador ya validado. El mensaje se mapea a payloadTemplate.messages
 * con un unico mensaje de rol 'user' (lo que el backend espera; al dispararse, el evento entrante puede
 * sumar un mensaje extra con sus datos como contexto). Recorta espacios sobrantes.
 */
export function toTriggerApiInput(draft: TriggerDraft): CreateTriggerInput {
  return {
    agentId: draft.agentId,
    credentialId: draft.credentialId,
    authMode: draft.authMode,
    payloadTemplate: {
      messages: [{ role: 'user', content: draft.message.trim() }],
    },
  };
}

/** Etiqueta corta del modo de auth para badges/listado. */
export function authModeLabel(mode: TriggerAuthMode): string {
  return mode === 'hmac' ? i18n.t('triggers.authModeEtiqueta.hmac') : i18n.t('triggers.authModeEtiqueta.urlToken');
}
