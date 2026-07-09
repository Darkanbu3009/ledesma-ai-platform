// Tipos, VERSIONES y ESTRUCTURA de los documentos de privacidad en la consola (Fase 5.6). Sin React ni
// red: la logica pura (que falta aceptar, etiquetas, armado de bodies) se testea como funciones puras,
// igual que registration.ts / recipes.ts.
//
// El TEXTO legal de los avisos NO vive aqui: son PLACEHOLDERS marcados [REVISION LEGAL PENDIENTE] que un
// abogado mexicano debe redactar/revisar. Aqui solo esta la ESTRUCTURA (las secciones que la ley exige
// como encabezados) y la VERSION vigente para el consentimiento versionado.

// -----------------------------------------------------------------------------------------------------
// VERSIONES. Copia de DISPLAY de las versiones vigentes. La AUTORIDAD del gate es el backend
// (GET /v1/consents/me devuelve `missing`, calculado contra apps/backend/src/privacy/documents.ts):
// estas constantes solo se muestran en las paginas de aviso. MANTENER SINCRONIZADAS con el backend
// (misma convencion que el repo ya usa para tipos espejados backend/consola).
// -----------------------------------------------------------------------------------------------------
export const PRIVACY_NOTICE_VERSION = '2025-03-21';
export const TERMS_VERSION = '2025-03-21';

export type DocumentType = 'privacy_notice' | 'terms';

// -----------------------------------------------------------------------------------------------------
// CONSENTIMIENTO. Espeja las respuestas del backend (consents-route.ts).
// -----------------------------------------------------------------------------------------------------
export interface Consent {
  id: string;
  ownerId: string;
  documentType: DocumentType;
  documentVersion: string;
  acceptedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
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

/** True si al titular le falta aceptar la version vigente del AVISO DE PRIVACIDAD (dispara el gate). */
export function needsPrivacyConsent(state: ConsentsState | undefined): boolean {
  return state !== undefined && state.missing.includes('privacy_notice');
}

/** True si al titular le falta aceptar CUALQUIER documento vigente. */
export function hasPendingConsents(state: ConsentsState | undefined): boolean {
  return state !== undefined && state.missing.length > 0;
}

/**
 * Arma los bodies de consentimiento (uno por documento faltante) a partir del estado. Se envia al aceptar:
 * registra la version VIGENTE de cada documento que faltaba. Pura y testeable.
 */
export function pendingConsentBodies(state: ConsentsState): CreateConsentInput[] {
  return state.missing.map((type) => ({ document_type: type, document_version: state.current[type] }));
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
  { type: 'rectification', label: 'Rectificacion', description: 'Corregir datos incompletos o inexactos.' },
  { type: 'cancellation', label: 'Cancelacion', description: 'Eliminar tus datos de nuestros registros.' },
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

// -----------------------------------------------------------------------------------------------------
// ESTRUCTURA DE LOS AVISOS. Solo encabezados de las secciones que la ley exige; el CONTENIDO es un
// PLACEHOLDER (que va aqui) que redacta un abogado. `optional` marca secciones no obligatorias por la
// nueva LFPDPPP pero recomendadas (buenas practicas / GDPR).
// -----------------------------------------------------------------------------------------------------
export interface NoticeSection {
  id: string;
  heading: string;
  /** Descripcion de QUE texto legal va en esta seccion (para el placeholder). */
  placeholder: string;
  optional?: boolean;
}

export interface PrivacyDocument {
  title: string;
  subtitle: string;
  version: string;
  sections: NoticeSection[];
}

/** AVISO SIMPLIFICADO (obligatorio al recabar datos por medios electronicos, como esta plataforma). */
export const SIMPLIFIED_NOTICE: PrivacyDocument = {
  title: 'Aviso de Privacidad Simplificado',
  subtitle: 'Resumen de como tratamos tus datos personales. El aviso integral tiene el detalle completo.',
  version: PRIVACY_NOTICE_VERSION,
  sections: [
    {
      id: 'responsable',
      heading: 'Identidad y domicilio del responsable',
      placeholder:
        'Nombre/denominacion legal del responsable, domicilio fiscal y datos de contacto en Mexico.',
    },
    {
      id: 'datos',
      heading: 'Datos personales que se tratan',
      placeholder:
        'Categorias de datos que se recaban, indicando expresamente si se tratan datos personales SENSIBLES.',
    },
    {
      id: 'finalidades',
      heading: 'Finalidades del tratamiento',
      placeholder:
        'Finalidades NECESARIAS (para prestar el servicio) y VOLUNTARIAS (requieren consentimiento), indicando cuales de estas ultimas requieren tu consentimiento.',
    },
    {
      id: 'limitar-uso',
      heading: 'Medios para limitar el uso o divulgacion',
      placeholder:
        'Como puedes limitar el uso o divulgacion de tus datos (p.ej. registros de exclusion, mecanismos de contacto).',
    },
    {
      id: 'integral',
      heading: 'Donde consultar el aviso integral',
      placeholder:
        'Enlace y/o ubicacion donde puedes consultar el AVISO DE PRIVACIDAD INTEGRAL con todo el detalle.',
    },
  ],
};

/** AVISO INTEGRAL: la version completa con todas las secciones que exige la ley. */
export const INTEGRAL_NOTICE: PrivacyDocument = {
  title: 'Aviso de Privacidad Integral',
  subtitle: 'Detalle completo del tratamiento de tus datos personales conforme a la LFPDPPP y el GDPR.',
  version: PRIVACY_NOTICE_VERSION,
  sections: [
    {
      id: 'responsable',
      heading: 'Identidad y domicilio del responsable',
      placeholder:
        'Nombre/denominacion legal del responsable, domicilio fiscal y datos de contacto (incluye area/persona de datos personales).',
    },
    {
      id: 'datos',
      heading: 'Datos personales que se tratan',
      placeholder:
        'Todas las categorias de datos que se recaban, IDENTIFICANDO expresamente los datos personales SENSIBLES si los hubiera.',
    },
    {
      id: 'finalidades',
      heading: 'Finalidades del tratamiento',
      placeholder:
        'Finalidades NECESARIAS (dan origen/son requeridas para la relacion) distinguidas de las VOLUNTARIAS (que requieren consentimiento). Indicar cuales requieren consentimiento.',
    },
    {
      id: 'derechos',
      heading: 'Medios para ejercer los derechos del titular (ARCO)',
      placeholder:
        'Procedimiento y medios para ejercer los derechos de Acceso, Rectificacion, Cancelacion y Oposicion (y supresion/portabilidad para GDPR), incluyendo requisitos y plazos de respuesta.',
    },
    {
      id: 'limitar-uso',
      heading: 'Medios para limitar el uso o divulgacion',
      placeholder:
        'Mecanismos para limitar el uso o divulgacion de los datos (p.ej. registros de exclusion, revocacion del consentimiento).',
    },
    {
      id: 'ia',
      heading: 'Uso de inteligencia artificial y decisiones automatizadas',
      placeholder:
        'Que la plataforma opera agentes de IA de forma autonoma; existencia de decisiones automatizadas y, cuando tengan efecto significativo, el derecho a INTERVENCION HUMANA y a oponerse (GDPR Art 22). Divulgacion de interaccion con IA (EU AI Act Art 50).',
    },
    {
      id: 'transferencias',
      heading: 'Transferencias de datos',
      placeholder:
        'Transferencias a terceros, sus finalidades y si requieren consentimiento. La nueva LFPDPPP ya NO exige informarlas en el aviso; se incluye por buenas practicas y GDPR.',
      optional: true,
    },
    {
      id: 'cambios',
      heading: 'Cambios al aviso de privacidad',
      placeholder:
        'Como se comunicaran los cambios al aviso y el versionado. Al cambiar la version, se solicita nuevamente tu consentimiento.',
      optional: true,
    },
  ],
};
