/**
 * Subpath `@ledesma-platform/backend/plantillas-compartidas`: acceso a datos de las PLANTILLAS
 * COMPARTIDAS (V041), el procedimiento de una tarea de intencion irreversible sin dueno y sin valores.
 *
 * Igual que los subpaths de sitios / aprobaciones / politicas / trayectorias / recetas-web /
 * aprendizaje-sitios, existe para que el WORKER reuse el repositorio sin cargar el servidor Fastify
 * entero.
 */
export {
  PlantillasCompartidasRepository,
  MAX_CLASES_POR_DOMINIO,
  ORIGENES_PARA_PUBLICAR,
  type PlantillaParaPublicar,
  type ResultadoDePublicacion,
} from './plantillas-compartidas-repository.js';
