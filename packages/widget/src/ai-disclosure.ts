// DIVULGACION DE IA (EU AI Act Art 50). El widget debe informar CLARAMENTE al end-user que interactua con
// un sistema de IA. La divulgacion esta SIEMPRE presente (default), y su texto es configurable via el
// atributo `ai-notice`; opcionalmente enlaza un aviso de privacidad via `privacy-url`. Logica pura y
// testeable, sin DOM (el render la usa en element.ts).

/** Texto por defecto de la divulgacion de IA. Siempre presente aunque no se configure (cumplimiento). */
export const DEFAULT_AI_NOTICE = 'Estas interactuando con un asistente de IA.';

/**
 * Resuelve el texto de la divulgacion: usa el atributo si trae contenido; si falta o esta vacio, cae al
 * default. Nunca devuelve cadena vacia (la divulgacion no puede desaparecer).
 */
export function resolveAiNotice(attr: string | null | undefined): string {
  if (attr === null || attr === undefined) return DEFAULT_AI_NOTICE;
  const trimmed = attr.trim();
  return trimmed === '' ? DEFAULT_AI_NOTICE : trimmed;
}

/**
 * Solo se enlaza el aviso de privacidad si la URL es SEGURA: http(s) absoluta o ruta relativa. Descarta
 * esquemas peligrosos (javascript:, data:, etc.) que un integrador podria inyectar via atributo.
 */
export function isSafeDisclosureUrl(url: string | null | undefined): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed === '') return false;
  return /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/');
}
