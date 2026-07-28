// Tipos y VERSIONES de los documentos legales en la consola. Sin React ni red: la logica pura (que falta
// aceptar, etiquetas, armado de bodies) se testea como funciones puras, igual que registration.ts.
//
// El TEXTO legal NO vive aqui: vive versionado en apps/console/src/content/legal/ (aviso de privacidad,
// aviso simplificado y terminos, en espanol e ingles). Aqui solo esta el contrato con el backend.

// -----------------------------------------------------------------------------------------------------
// VERSIONES. Copia de DISPLAY de las versiones vigentes. La AUTORIDAD del gate es el backend
// (GET /v1/consents/me devuelve `missing`, calculado contra apps/backend/src/privacy/documents.ts):
// estas constantes solo se muestran. MANTENER SINCRONIZADAS con el backend y con el campo `version` de
// los archivos de content/legal (misma convencion que el repo ya usa para los tipos espejados
// backend/consola). El test privacy.test.ts verifica la sincronia con el contenido.
// -----------------------------------------------------------------------------------------------------
export const PRIVACY_NOTICE_VERSION = '2026-07-28';
export const TERMS_VERSION = '2026-07-28';

export type DocumentType = 'privacy_notice' | 'terms';

/** Los dos documentos que el gate EXIGE aceptar, en el orden en que se presentan al titular. */
export const REQUIRED_DOCUMENTS: readonly DocumentType[] = ['privacy_notice', 'terms'];

/** Ruta publica del texto completo de cada documento, para enlazarlo desde el gate y el perfil. */
export const DOCUMENT_PATHS: Record<DocumentType, string> = {
  privacy_notice: '/privacidad',
  terms: '/terminos',
};

// -----------------------------------------------------------------------------------------------------
// CONSENTIMIENTO. Espeja las respuestas del backend (routes/consents.ts).
// -----------------------------------------------------------------------------------------------------
export interface Consent {
  id: string;
  ownerId: string;
  documentType: DocumentType;
  documentVersion: string;
  acceptedAt: string;
  /** HMAC no reversible de la IP. La consola no lo muestra; esta para que el tipo refleje el contrato. */
  ipHash: string | null;
}

/** Forma exacta de GET /v1/consents/me. `missing` son los documentos cuya version vigente falta aceptar. */
export interface ConsentsState {
  consents: Consent[];
  current: Record<DocumentType, string>;
  documentTypes: DocumentType[];
  missing: DocumentType[];
}

/** Body de POST /v1/consents (snake_case, tal como lo espera el backend). */
export interface CreateConsentInput {
  document_type: DocumentType;
  document_version: string;
}

/** True si al titular le falta aceptar CUALQUIER documento vigente (dispara el gate). */
export function hasPendingConsents(state: ConsentsState | undefined): boolean {
  return state !== undefined && state.missing.length > 0;
}

/**
 * Arma los bodies de consentimiento (uno por documento faltante) a partir del estado. Se envia al aceptar:
 * registra la version VIGENTE de cada documento que faltaba. Pura y testeable.
 */
export function pendingConsentBodies(state: ConsentsState): CreateConsentInput[] {
  return state.missing.map((type) => ({
    document_type: type,
    document_version: state.current[type],
  }));
}

/**
 * La aceptacion VIGENTE de un documento, o null si el titular no acepto la version actual. Es lo que la
 * seccion del perfil muestra: version y fecha de lo que esta al dia, no el historico completo.
 */
export function currentAcceptance(
  state: ConsentsState | undefined,
  type: DocumentType,
): Consent | null {
  if (state === undefined) return null;
  const current = state.current[type];
  return (
    state.consents.find((c) => c.documentType === type && c.documentVersion === current) ?? null
  );
}

// -----------------------------------------------------------------------------------------------------
// DERECHOS DEL TITULAR (ARCO / GDPR). Espeja data-requests-route.ts.
// -----------------------------------------------------------------------------------------------------
export type DataRequestType =
  | 'access'
  | 'rectification'
  | 'cancellation'
  | 'opposition'
  | 'erasure';

export type DataRequestStatus = 'pending' | 'in_progress' | 'completed' | 'rejected';

export interface DataRequest {
  id: string;
  ownerId: string;
  requestType: DataRequestType;
  status: DataRequestStatus;
  details: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

/** Body de POST /v1/data-requests (snake_case). */
export interface CreateDataRequestInput {
  request_type: DataRequestType;
  details?: string;
}

/**
 * Opciones del formulario de ejercicio de derechos (etiqueta + descripcion corta para el radio group).
 * Solo los 4 derechos ARCO: la supresion GDPR se atiende via `cancellation` en el formulario, aunque
 * `erasure` sigue existiendo como tipo (el backend lo acepta y el historial lo etiqueta).
 */
export const DATA_REQUEST_OPTIONS: ReadonlyArray<{
  type: DataRequestType;
  label: string;
  description: string;
}> = [
  { type: 'access', label: 'Acceso', description: 'Saber que datos tratamos y para que.' },
  {
    type: 'rectification',
    label: 'Rectificacion',
    description: 'Corregir datos incompletos o inexactos.',
  },
  {
    type: 'cancellation',
    label: 'Cancelacion',
    description: 'Eliminar tus datos de nuestros registros.',
  },
  { type: 'opposition', label: 'Oposicion', description: 'Detener usos especificos de tus datos.' },
];

const REQUEST_TYPE_LABELS: Record<DataRequestType, string> = {
  access: 'Acceso',
  rectification: 'Rectificacion',
  cancellation: 'Cancelacion',
  opposition: 'Oposicion',
  erasure: 'Supresion',
};

const REQUEST_STATUS_LABELS: Record<DataRequestStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En proceso',
  completed: 'Resuelta',
  rejected: 'Rechazada',
};

export function requestTypeLabel(type: DataRequestType): string {
  return REQUEST_TYPE_LABELS[type] ?? type;
}

export function requestStatusLabel(status: DataRequestStatus): string {
  return REQUEST_STATUS_LABELS[status] ?? status;
}
