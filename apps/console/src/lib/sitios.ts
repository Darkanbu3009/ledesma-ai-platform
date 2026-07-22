/**
 * Tipos y logica PURA de los SITIOS CONECTADOS (7.1c) en la consola: dominios donde el usuario inicia
 * sesion EL MISMO en una vista en vivo del navegador remoto, para que despues un agente opere dentro
 * de su cuenta (7.1d). Espeja la forma camelCase de GET /v1/sitios (apps/backend/src/routes/sitios.ts).
 * Sin React ni red: etiquetas de estado, validacion de la URL de entrada, deteccion de filas "en
 * transicion" (para el auto-refresh, mismo criterio que hasInFlightJobs en jobs.ts) y derivaciones de
 * la fila del login en curso se testean como funciones puras, igual que jobs.ts / scheduled-tasks.ts.
 *
 * PRINCIPIO NO NEGOCIABLE: el login lo hace el usuario, no la plataforma. La UNICA entrada humana de
 * este flujo es la URL del sitio; la contrasena se teclea DENTRO del iframe de la vista en vivo, que
 * apunta directo al proveedor del navegador remoto. En este modulo (y en toda la pagina) no existe
 * ningun campo ni tipo de contrasena.
 */

import i18n from '../i18n';

/** Ciclo de vida de una conexion (mismos estados que el CHECK de V024). */
export type EstadoSitio = 'esperando_login' | 'activo' | 'caducado' | 'error';

/** Un sitio conectado, tal como lo devuelve GET /v1/sitios (metadata minima; jamas contexto). */
export interface SitioConectado {
  id: string;
  dominio: string;
  estado: EstadoSitio;
  /** URL de la vista en vivo del login EN CURSO. Solo poblada en 'esperando_login'. */
  vistaEnVivoUrl: string | null;
  creadoEn: string;
  /** Ultima vez que una ejecucion uso esta sesion (ISO). null = nunca. */
  ultimoUsoEn: string | null;
}

/** Respuesta 202 de POST /v1/sitios/conectar: el job encolado + el dominio derivado de la URL. */
export interface ConexionAceptada {
  status: string;
  jobId: string;
  dominio: string;
}

/** Respuesta 202 de confirmar/eliminar: solo el job encolado. */
export interface SitioJobAceptado {
  status: string;
  jobId: string;
}

/** Intervalo de auto-refresh de la lista mientras hay conexiones en transicion (ms). */
export const SITIOS_REFETCH_MS = 4000;

/** Intervalo de polling del estado de UN job encolado por esta pagina (ms). */
export const JOB_SEGUIMIENTO_REFETCH_MS = 2000;

/** Etiqueta legible del estado de una conexion. */
export function estadoSitioLabel(estado: EstadoSitio): string {
  switch (estado) {
    case 'esperando_login':
      return i18n.t('sitios.estado.esperandoLogin');
    case 'activo':
      return i18n.t('sitios.estado.activo');
    case 'caducado':
      return i18n.t('sitios.estado.caducado');
    case 'error':
      return i18n.t('sitios.estado.error');
    default:
      return estado;
  }
}

/**
 * Normaliza la URL que pego el usuario: recorta espacios y antepone https:// si no trae esquema
 * (pegar "app.ejemplo.com" es lo natural). Devuelve la URL lista para el backend, o null si ni asi
 * es una URL http(s) valida (el backend re-valida con el mismo criterio del payload del worker).
 */
export function normalizarUrlDeSitio(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const conEsquema = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(conEsquema);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.hostname.length === 0 || !parsed.hostname.includes('.')) return null;
  return conEsquema;
}

/** Inicial del dominio para el avatar de la fila (primer caracter alfanumerico, en mayuscula). */
export function inicialDeDominio(dominio: string): string {
  const match = dominio.match(/[a-zA-Z0-9]/);
  return (match?.[0] ?? '?').toUpperCase();
}

/**
 * ¿Hay alguna conexion en transicion (esperando_login)? La pagina lo usa para el auto-refresh
 * prudente de la lista, mismo criterio que hasInFlightJobs: si todo esta en un estado estable
 * (activo/caducado/error), NO se reconsulta el API.
 */
export function haySitiosEnTransicion(sitios: SitioConectado[]): boolean {
  return sitios.some((sitio) => sitio.estado === 'esperando_login');
}

/**
 * La fila del login EN CURSO de la conexion que esta pagina acaba de encolar: el dominio coincide,
 * esta 'esperando_login' y ya tiene la vista en vivo. Es la senal (derivada de datos, sin efectos)
 * de que el modal del login puede abrirse.
 */
export function sitioEnLoginParaDominio(
  sitios: SitioConectado[],
  dominio: string,
): SitioConectado | null {
  return (
    sitios.find(
      (sitio) =>
        sitio.dominio === dominio &&
        sitio.estado === 'esperando_login' &&
        sitio.vistaEnVivoUrl !== null,
    ) ?? null
  );
}
