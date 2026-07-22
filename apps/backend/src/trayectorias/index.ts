/**
 * Punto de entrada REUTILIZABLE de la capa de TRAYECTORIAS DE TAREAS WEB (Fase F, V030), expuesto
 * como subpath de paquete (`@ledesma-platform/backend/trayectorias`, ver `exports` de package.json)
 * con el mismo criterio que `/aprobaciones`: el WORKER reusa el MISMO repositorio que los endpoints
 * del backend (el worker escribe la traza al cerrar cada ejecucion del motor; la consola la lee).
 * Este barrel SOLO re-exporta, no agrega comportamiento.
 */
export { TrayectoriasWebRepository } from './trayectorias-repository.js';
export type {
  NuevaTrayectoria,
  NuevoPasoTrayectoria,
  PasoTrayectoria,
  TrayectoriaConPasos,
  TrayectoriaEstado,
  TrayectoriaWeb,
} from './trayectorias-repository.js';
