/**
 * Punto de entrada REUTILIZABLE de la capa de SITIOS CONECTADOS (7.1a), expuesto como subpath de
 * paquete (`@ledesma-platform/backend/sitios`, ver `exports` de package.json) para que el WORKER
 * (7.1b) reuse el MISMO repositorio y cifrado (VAULT_SECRET / aes-gcm.ts) que el backend, con el
 * mismo criterio que el subpath `/execution`: este barrel SOLO re-exporta, no agrega comportamiento.
 *
 * Tambien re-exporta el repositorio de solicitudes ARCO (data_subject_requests, V014): el job
 * kind:'desconectar_sitio' del worker ENCADENA cada desconexion con una solicitud de cancelacion
 * resuelta, y debe escribir en la MISMA tabla que el flujo HTTP de privacidad.
 */
export { SitiosConectadosRepository } from './sitios-conectados-repository.js';
export type {
  EstadoSitioConectado,
  SitioConectado,
  CrearSitioConectadoInput,
  GuardarContextoInput,
  RegistrarSesionDeLoginInput,
  SitioConectadoBorrado,
} from './sitios-conectados-repository.js';

export { DataSubjectRequestRepository } from '../privacy/data-subject-request-repository.js';
export type {
  DataSubjectRequest,
  DataSubjectRequestType,
  DataSubjectRequestStatus,
  CreateDataSubjectRequestInput,
} from '../privacy/data-subject-request-repository.js';
