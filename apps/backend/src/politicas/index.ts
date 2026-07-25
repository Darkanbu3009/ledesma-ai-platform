/**
 * Punto de entrada REUTILIZABLE de la POLITICA DE EJECUCION (V034), expuesto como subpath de paquete
 * (`@ledesma-platform/backend/politicas`, ver `exports` de package.json) con el mismo criterio que
 * `/sitios` y `/aprobaciones`: el WORKER lee la politica con el MISMO repositorio que la escribe el
 * endpoint de la consola, sin duplicar el mapeo de columnas ni los defaults. Este barrel SOLO
 * re-exporta, no agrega comportamiento.
 */
export {
  PoliticasEjecucionRepository,
  POLITICA_EJECUCION_DEFAULT,
} from './politicas-ejecucion-repository.js';
export type {
  PoliticaEjecucion,
  PoliticaEjecucionInput,
} from './politicas-ejecucion-repository.js';
