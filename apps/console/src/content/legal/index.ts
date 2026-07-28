// Selector de DOCUMENTO LEGAL por idioma. Unico punto donde las paginas resuelven que texto mostrar; el
// resto de la consola no importa los archivos de contenido directamente.
//
// El idioma llega del i18n (i18n.language, que puede venir como 'es-MX' o 'en-US'), asi que se normaliza a
// los dos idiomas que la consola soporta y cualquier otro cae a espanol, que es la version que rige.

import { AVISO_PRIVACIDAD_ES } from './aviso-privacidad.es';
import { AVISO_PRIVACIDAD_EN } from './aviso-privacidad.en';
import { AVISO_SIMPLIFICADO_ES, AVISO_SIMPLIFICADO_EN } from './aviso-simplificado';
import { TERMINOS_ES } from './terminos.es';
import { TERMINOS_EN } from './terminos.en';
import type { DocumentoLegal } from './tipos';

export type { BloqueLegal, DocumentoLegal, SeccionLegal } from './tipos';

/** Los documentos que la plataforma publica. */
export type NombreDocumento = 'aviso' | 'avisoSimplificado' | 'terminos';

const DOCUMENTOS: Record<NombreDocumento, { es: DocumentoLegal; en: DocumentoLegal }> = {
  aviso: { es: AVISO_PRIVACIDAD_ES, en: AVISO_PRIVACIDAD_EN },
  avisoSimplificado: { es: AVISO_SIMPLIFICADO_ES, en: AVISO_SIMPLIFICADO_EN },
  terminos: { es: TERMINOS_ES, en: TERMINOS_EN },
};

/** Normaliza 'es-MX' / 'en-US' / cualquier otra cosa a los dos idiomas publicados. */
export function idiomaLegal(idioma: string | undefined): 'es' | 'en' {
  return typeof idioma === 'string' && idioma.toLowerCase().startsWith('en') ? 'en' : 'es';
}

/** Devuelve el documento en el idioma pedido. */
export function documentoLegal(
  nombre: NombreDocumento,
  idioma: string | undefined,
): DocumentoLegal {
  return DOCUMENTOS[nombre][idiomaLegal(idioma)];
}
