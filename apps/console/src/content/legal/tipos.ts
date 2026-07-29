// Forma de los DOCUMENTOS LEGALES publicados (aviso de privacidad integral, aviso simplificado y terminos
// de servicio). El texto vive en archivos de contenido por documento e idioma, no en los locales de i18n:
// son documentos versionados que un abogado edita como una unidad, y meterlos en es.json/en.json los
// mezclaria con las cadenas de interfaz (que se editan por otras razones y en otro ritmo).
//
// El contenido es DATO, no JSX: asi el mismo texto se renderiza, se testea y en el futuro se puede exportar
// (a PDF o a un correo de aviso de cambios) sin arrastrar componentes.

/** Un bloque dentro de una seccion. La lista cubre lo unico que el texto legal necesita maquetar. */
export type BloqueLegal =
  | { tipo: 'parrafo'; texto: string }
  | { tipo: 'lista'; items: string[] }
  /** Lista de definiciones (termino + descripcion). Se usa para categorias de datos y encargados. */
  | { tipo: 'definiciones'; items: Array<{ termino: string; descripcion: string }> };

export interface SeccionLegal {
  /** Id estable de la seccion. Se usa como ancla del documento y como key de React. */
  id: string;
  titulo: string;
  bloques: BloqueLegal[];
}

export interface DocumentoLegal {
  /** Que documento es. Alinea con DocumentType del contrato de consentimiento. */
  tipo: 'privacy_notice' | 'terms';
  /**
   * Version del documento. DEBE coincidir con CURRENT_DOCUMENT_VERSIONS del backend
   * (apps/backend/src/privacy/documents.ts) y con las constantes de apps/console/src/lib/privacy.ts.
   * Subirla obliga a todos los usuarios a re-aceptar.
   */
  version: string;
  /** Fecha de la ultima actualizacion, ya formateada en el idioma del documento. */
  fecha: string;
  titulo: string;
  subtitulo: string;
  secciones: SeccionLegal[];
}
