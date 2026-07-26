/**
 * Punto de entrada REUTILIZABLE de la capa de GRABACIONES DE TAREA (V036), expuesto como subpath de
 * paquete (`@ledesma-platform/backend/grabaciones`, ver `exports` de package.json) con el mismo
 * criterio que `/trayectorias` y `/recetas-web`: el WORKER reusa el MISMO repositorio que los
 * endpoints del backend (el worker captura y escribe los pasos; la consola los lee y los revisa).
 * Este barrel SOLO re-exporta, no agrega comportamiento.
 */
export { GrabacionesRepository } from './grabaciones-repository.js';
export type { Grabacion, NuevaGrabacion } from './grabaciones-repository.js';
