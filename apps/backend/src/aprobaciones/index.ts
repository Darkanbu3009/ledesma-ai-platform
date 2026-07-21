/**
 * Punto de entrada REUTILIZABLE de la capa de APROBACIONES WEB (7.1e), expuesto como subpath de
 * paquete (`@ledesma-platform/backend/aprobaciones`, ver `exports` de package.json) con el mismo
 * criterio que `/sitios`: el WORKER reusa el MISMO repositorio que los endpoints del backend (crear
 * el checkpoint al pausar, leer la decision al reanudar, expirar en el barrido y registrar la
 * intervencion Art.22). Este barrel SOLO re-exporta, no agrega comportamiento.
 */
export { AprobacionesWebRepository } from './aprobaciones-repository.js';
export type {
  AccionTipo,
  AprobacionEstado,
  AprobacionWeb,
} from './aprobaciones-repository.js';
