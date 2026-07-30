// FUENTE DE VERDAD de las VERSIONES VIGENTES de los documentos legales. El consentimiento se versiona
// (V039, tabla aceptaciones_legales): un titular acepta UNA version; si el documento cambia de version
// (nueva finalidad, nuevo encargado, cambio de texto sustantivo), la version nueva queda SIN aceptar hasta
// que la acepte otra vez, y el gate de la consola vuelve a pedirla.
//
// POR QUE UNA CONSTANTE Y NO UNA TABLA: la version tiene que subir EN EL MISMO COMMIT que el texto del
// documento, que tambien vive en el repo (apps/console/src/content/legal/). Una tabla permitiria que el
// numero de version y el texto publicado se desincronizaran entre despliegues, y dejaria la re-aceptacion
// masiva de todos los usuarios a un UPDATE de distancia, sin revision de codigo.
//
// PROCEDIMIENTO PARA SUBIR DE VERSION (los cuatro pasos van juntos en un commit):
//   1. Editar el texto en apps/console/src/content/legal/<documento>.<idioma>.ts (es y en).
//   2. Subir el campo `version` (y `fecha`) de ESE documento en los dos idiomas.
//   3. Subir la misma cadena aqui, en CURRENT_DOCUMENT_VERSIONS.
//   4. Subir la copia de display de la consola (apps/console/src/lib/privacy.ts).
// Al desplegar, missingConsents deja de encontrar la version vigente entre las aceptadas y el ConsentGate
// vuelve a bloquear a TODOS los usuarios hasta que acepten. No hay que tocar la base ni correr scripts.
//
// La CONSOLA tiene su propia copia de la version para DISPLAY en las paginas legales. El backend es la
// AUTORIDAD del gate (calcula `missing`); la consola solo muestra el numero. Duplicar una constante con
// nota de sincronia es la misma convencion que ya usa el repo para los tipos espejados backend/consola
// (registration/types.ts <-> lib/registration.ts), y el test privacy-documents.test.ts la verifica.

/** Tipos de documento que la plataforma versiona y para los que puede registrar consentimiento. */
export type DocumentType = 'privacy_notice' | 'terms';

/**
 * Tipos de documento cuyo consentimiento el GATE EXIGE. Los DOS: el aviso de privacidad y los terminos de
 * servicio estan publicados en rutas PUBLICAS (/privacidad y /terminos) y son revisables antes de aceptar,
 * que es lo que hace que el consentimiento sea informado.
 */
export const ENFORCED_DOCUMENT_TYPES: readonly DocumentType[] = ['privacy_notice', 'terms'];

/**
 * Version VIGENTE de cada documento. Fecha ISO (YYYY-MM-DD) como esquema de versionado legible: la fecha
 * de la ultima revision del documento. Al cambiar una version, el gate re-solicita la aceptacion.
 */
// LOS DOS DOCUMENTOS suben a 2026-07-31 porque el ALCANCE del aprendizaje colectivo se AMPLIA: a la lista
// cerrada de tres elementos (dominio, clase de elemento y estrategia de localizacion) se suman el codigo de
// intencion y el ORDEN en que los elementos se accionaron, mas el ofrecimiento explicito del procedimiento
// agregado a otro titular. El texto cambia en las cuatro piezas legales (aviso integral, aviso simplificado
// y terminos, en los dos idiomas), asi que los dos documentos vuelven a pedirse.
//
// POR QUE UNA FECHA NUEVA PARA LOS DOS Y NO UN SUFIJO: el aviso ya estaba en 2026-07-30 y su texto cambia,
// asi que necesitaba una cadena distinta. La opcion mas simple es la que NO introduce un segundo formato de
// version: se mantiene la fecha ISO YYYY-MM-DD, la misma en los dos documentos, que es la unica convencion
// que la base (V039), el contrato HTTP y la consola ya muestran. Un sufijo obligaria a explicar el formato
// en cada lugar y dejaria dos documentos con la misma fecha y versiones distintas.
export const CURRENT_DOCUMENT_VERSIONS: Record<DocumentType, string> = {
  privacy_notice: '2026-07-31',
  terms: '2026-07-31',
};

/**
 * Vocabulario que la tabla `aceptaciones_legales` (V039) usa en la columna `documento`, en espanol como el
 * resto del dominio nuevo del repo. El contrato HTTP mantiene privacy_notice/terms (ya publicado y
 * consumido por la consola), asi que la traduccion ocurre en el BORDE del repositorio y en ningun otro
 * lado. Es la unica pareja de vocabularios y esta acotada a estas dos constantes.
 */
export const DOCUMENT_TYPE_TO_COLUMN: Record<DocumentType, string> = {
  privacy_notice: 'aviso_privacidad',
  terms: 'terminos',
};

/** Inversa de DOCUMENT_TYPE_TO_COLUMN, para leer filas de la base. */
export const COLUMN_TO_DOCUMENT_TYPE: Record<string, DocumentType> = {
  aviso_privacidad: 'privacy_notice',
  terminos: 'terms',
};

/** True si `value` es un DocumentType conocido (para validar input externo sin castear a ciegas). */
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
  for (const type of ENFORCED_DOCUMENT_TYPES) {
    const current = CURRENT_DOCUMENT_VERSIONS[type];
    const accepted = acceptedByType.get(type);
    if (accepted === undefined || !accepted.has(current)) {
      missing.push(type);
    }
  }
  return missing;
}
