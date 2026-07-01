// FUENTE DE VERDAD de las VERSIONES VIGENTES de los documentos de privacidad/terminos. El consentimiento
// se versiona (V014, tabla consents): un titular acepta UNA version; si el documento cambia de version
// (nueva finalidad -> nuevo consentimiento), la version nueva queda SIN aceptar hasta que la acepte otra vez.
//
// Estas constantes las usa el gate de consentimiento del backend (missingConsents) para decidir que le
// falta aceptar al usuario. La CONSOLA tiene su propia copia de la version para DISPLAY en las paginas de
// aviso (apps/console/src/lib/privacy.ts). MANTENER SINCRONIZADAS ambas copias: el backend es la autoridad
// del gate (calcula `missing`), la consola solo muestra el numero. Duplicar una constante con nota de
// sincronia es la misma convencion que ya usa el repo para los tipos espejados backend/consola
// (registration/types.ts <-> lib/registration.ts).
//
// El texto legal NO vive aqui: lo redacta un abogado y la consola lo renderiza con placeholders marcados
// [REVISION LEGAL PENDIENTE]. Subir una version aqui (cuando el abogado cambie el aviso) fuerza la
// re-aceptacion de todos los usuarios de forma automatica.

/** Tipos de documento que la plataforma versiona y para los que registra consentimiento. */
export type DocumentType = 'privacy_notice' | 'terms';

/** Lista de tipos de documento (para iterar). */
export const DOCUMENT_TYPES: readonly DocumentType[] = ['privacy_notice', 'terms'];

/**
 * Version VIGENTE de cada documento. Fecha ISO (YYYY-MM-DD) como esquema de versionado legible: la fecha
 * de la ultima revision legal del documento. Al cambiar una version, el gate re-solicita la aceptacion.
 */
export const CURRENT_DOCUMENT_VERSIONS: Record<DocumentType, string> = {
  // Alineado con la entrada en vigor de la nueva LFPDPPP (21-mar-2025) como version inicial del andamiaje.
  privacy_notice: '2025-03-21',
  terms: '2025-03-21',
};

/** True si `type` es un DocumentType conocido (para validar input externo sin castear a ciegas). */
export function isDocumentType(value: unknown): value is DocumentType {
  return value === 'privacy_notice' || value === 'terms';
}

/**
 * Dado el conjunto de versiones ya aceptadas por un titular por tipo de documento, devuelve los tipos cuya
 * version VIGENTE aun NO fue aceptada (los que el gate debe re-solicitar). Es PURA y testeable: no toca la
 * base. `acceptedByType` mapea document_type -> conjunto de versiones que el usuario acepto de ese tipo.
 */
export function missingConsents(acceptedByType: Map<DocumentType, Set<string>>): DocumentType[] {
  const missing: DocumentType[] = [];
  for (const type of DOCUMENT_TYPES) {
    const current = CURRENT_DOCUMENT_VERSIONS[type];
    const accepted = acceptedByType.get(type);
    if (accepted === undefined || !accepted.has(current)) {
      missing.push(type);
    }
  }
  return missing;
}
