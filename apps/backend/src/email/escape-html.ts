/**
 * Escapa los caracteres especiales de HTML. UNICA copia del backend para armar cuerpos de correo con
 * datos de usuario (el nombre en la bienvenida, el email del solicitante en la alerta de upgrade):
 * un fix de escapado se aplica aca y alcanza a todos los correos, sin copias que puedan divergir.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
