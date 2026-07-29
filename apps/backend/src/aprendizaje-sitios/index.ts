/**
 * Subpath `@ledesma-platform/backend/aprendizaje-sitios`: acceso a datos del ATLAS DE SITIOS (V040),
 * la estructura de cada dominio agregada a partir de las ejecuciones exitosas de cualquier usuario.
 *
 * Igual que los subpaths de sitios / aprobaciones / politicas / trayectorias / recetas-web, existe
 * para que el WORKER reuse el repositorio sin cargar el servidor Fastify entero.
 */
export {
  AprendizajeSitiosRepository,
  MAX_ENTRADAS_POR_DOMINIO,
  type EntradaDeAtlasCruda,
  type ObservacionDeAtlas,
} from './aprendizaje-sitios-repository.js';
