/**
 * Validacion de correo compartida por las pantallas de acceso (login, crear
 * cuenta y recuperacion de contrasena): chequeo laxo de forma usuario@dominio
 * antes de llamar a Supabase, que aplica la validacion real en el servidor.
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
