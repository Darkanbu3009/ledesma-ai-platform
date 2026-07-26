/**
 * Tipos y logica PURA de las TRAYECTORIAS DE TAREAS WEB (Fase F, V030) en la consola. Espeja la forma
 * camelCase que devuelve el backend (GET /v1/trayectorias?jobId=..., ver
 * apps/backend/src/routes/trayectorias.ts). Sin React ni red, igual que jobs.ts: las etiquetas y el
 * formato de duracion se testean como funciones puras.
 *
 * SOLO LECTURA: la trayectoria la escribe el worker con los pasos YA CENSURADOS (los valores de
 * campos sensibles llegan como '[CENSURADO]'); aqui solo se muestra. La promocion a receta y el
 * replay son un PR posterior.
 */

import i18n from '../i18n';

/** Desenlace de una ejecucion del motor de navegacion (trayectorias_web.estado). */
export type TrayectoriaEstado = 'exitosa' | 'fallida' | 'pausada';

/** La accion censurada de un paso, construida por whitelist en el worker. */
export interface AccionDePaso {
  tipo: string;
  instruccion: string | null;
  metodo: string | null;
  argumentos: string[];
}

/** Un paso de la trayectoria, tal como lo devuelve el backend. */
export interface PasoDeTrayectoria {
  idx: number;
  accion: AccionDePaso;
  selector: string | null;
  valorCensurado: string | null;
  url: string | null;
  exito: boolean | null;
}

/** Una ejecucion del motor con sus pasos. Un job puede tener mas de una (checkpoint + reanudacion). */
export interface Trayectoria {
  id: string;
  jobId: string;
  connectionId: string;
  dominio: string;
  objetivo: string;
  estado: TrayectoriaEstado;
  iniciadaEn: string;
  terminadaEn: string;
  duracionMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  pasos: PasoDeTrayectoria[];
}

/** Etiqueta legible del estado de una trayectoria. */
export function trayectoriaEstadoLabel(estado: TrayectoriaEstado): string {
  switch (estado) {
    case 'exitosa':
      return i18n.t('actividad.trayectoria.estado.exitosa');
    case 'fallida':
      return i18n.t('actividad.trayectoria.estado.fallida');
    case 'pausada':
      return i18n.t('actividad.trayectoria.estado.pausada');
    default:
      return estado;
  }
}

/**
 * Duracion legible de una trayectoria: menos de un segundo en ms, menos de un minuto en segundos
 * (un decimal) y a partir de ahi minutos + segundos. Es informacion de observabilidad, no cronometria:
 * redondeos simples.
 */
export function formatearDuracion(duracionMs: number): string {
  if (duracionMs < 1000) return `${Math.max(0, Math.round(duracionMs))} ms`;
  const segundos = duracionMs / 1000;
  if (segundos < 60) return `${segundos.toFixed(1)} s`;
  const minutos = Math.floor(segundos / 60);
  const resto = Math.round(segundos % 60);
  return `${minutos} min ${resto} s`;
}

/**
 * Texto principal de un paso para la lista: la instruccion del modelo si existe (lo mas legible), si
 * no el tipo de tool ejecutada.
 */
export function tituloDePaso(paso: PasoDeTrayectoria): string {
  return paso.accion.instruccion ?? paso.accion.tipo;
}

/**
 * SITIOS que una tarea uso, en el orden en que los uso y sin repetir. Una tarea puede trabajar en
 * varios sitios del usuario: cada tramo deja su propia ejecucion registrada, con el sitio en el que
 * corrio, asi que la lista sale de ahi y no de una suposicion.
 */
export function sitiosUsados(trayectorias: Trayectoria[]): string[] {
  const sitios: string[] = [];
  for (const trayectoria of trayectorias) {
    if (!sitios.includes(trayectoria.dominio)) sitios.push(trayectoria.dominio);
  }
  return sitios;
}
