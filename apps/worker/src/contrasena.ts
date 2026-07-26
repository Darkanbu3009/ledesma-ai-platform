/**
 * DETECCION DETERMINISTA DE UN CAMPO DE CONTRASENA. Un solo lugar, usado por los DOS caminos que la
 * necesitan, para que no puedan divergir:
 *
 *  1. El PRE-CHEQUEO DE CADUCIDAD de la tarea web (`detectarPantallaDeLogin`, browserbase.ts): antes
 *     de gastar un solo token, si el sitio ya muestra una pantalla de login se aborta la tarea.
 *  2. La GUARDIA DE LA GRABACION: mientras el usuario le ensena una tarea al sistema, la aparicion de
 *     un campo de contrasena DETIENE la grabacion al instante y descarta lo capturado.
 *
 * Es la MISMA comprobacion (presencia de un `input[type=password]` en el documento) porque el
 * invariante es el mismo en los dos casos: EL LOGIN JAMAS SE AUTOMATIZA NI SE GRABA. Tener dos
 * detectores permitiria que uno se quedara atras del otro.
 *
 * Modulo PURO (solo texto de expresiones): no importa el SDK del navegador ni ningun cliente de
 * modelo, y se testea sin abrir nada.
 */

/** Selector del campo que delata un login. Cerrado a proposito: el tipo del input, nada mas. */
export const SELECTOR_CAMPO_CONTRASENA = 'input[type=password]';

/**
 * Expresion (booleana) que responde si el documento actual tiene un campo de contrasena. Corre en el
 * MUNDO AISLADO de la pagina: el JavaScript del sitio no puede parchear `querySelector` para
 * esconderselo al detector.
 */
export const EXPRESION_HAY_CAMPO_DE_CONTRASENA = `!!document.querySelector('${SELECTOR_CAMPO_CONTRASENA}')`;
