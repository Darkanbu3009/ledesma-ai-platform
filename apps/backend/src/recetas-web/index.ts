/**
 * Subpath `@ledesma-platform/backend/recetas-web`: acceso a datos de las RECETAS DE TAREA WEB (V035),
 * el procedimiento aprendido de una trayectoria exitosa que el worker repite sin llamar al modelo.
 *
 * NO confundir con `recipes` (V013), que vive en src/recipes/ y son cadenas de instrucciones de texto
 * para un agente conversacional. Ver la cabecera de la migracion V035.
 *
 * Igual que los subpaths de sitios / aprobaciones / politicas / trayectorias, existe para que el
 * WORKER reuse el repositorio sin cargar el servidor Fastify entero.
 */
export {
  RecetasWebRepository,
  type EstadoReceta,
  type NuevaRecetaWeb,
  type OrigenReceta,
  type RecetaWeb,
} from './recetas-web-repository.js';
export {
  encolarGuardadoDeJob,
  evaluarGuardadoDeJob,
  type EvaluacionDeGuardado,
  type GuardarTareaAprendidaDeps,
  type MotivoNoGuardable,
  type ResultadoDeEncolado,
} from './guardar-tarea-aprendida.js';
