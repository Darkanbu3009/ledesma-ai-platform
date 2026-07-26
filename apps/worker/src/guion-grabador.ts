import { EXPRESION_HAY_CAMPO_DE_CONTRASENA, SELECTOR_CAMPO_CONTRASENA } from './contrasena.js';
import { AYUDANTES_DOM } from './localizacion.js';

/**
 * EL GUION QUE GRABA (Fase de grabacion, CAMBIO 1): el JavaScript que corre DENTRO de la pagina
 * mientras el usuario hace la tarea el mismo en la vista en vivo, y que informa cada accion al worker
 * por una funcion enlazada de CDP (Runtime.addBinding).
 *
 * QUE CAPTURA, por accion: el TIPO (clic, escritura, tecla, navegacion), la URL, y las ESTRATEGIAS DE
 * LOCALIZACION del elemento en el orden que ya define el sistema de recetas (atributo estable, rol mas
 * nombre accesible, texto visible, xpath absoluto como ultimo recurso). Reusa exactamente los mismos
 * ayudantes de DOM que la ejecucion determinista (AYUDANTES_DOM de localizacion.ts): si el grabador
 * describiera los elementos de otra forma que el ejecutor, la receta grabada no localizaria nada.
 *
 * LA ESCRITURA SE ANOTA MIENTRAS SE TECLEA, no al salir del campo (CAMBIO 1). Antes el valor se leia
 * en 'change'/'focusout', y para entonces muchos sitios ya habian VACIADO el campo: el "Para" de un
 * correo acepta la sugerencia del autocompletado, borra lo tecleado y lo reemplaza por una etiqueta.
 * Medido en produccion: de una grabacion de 9 pasos, el destinatario no quedo como escritura y el
 * unico rastro fue un clic sobre la sugerencia, que al repetir la tarea no existe. Ahora cada 'input'
 * ANOTA el ultimo valor no vacio del campo y ese valor se emite cuando el usuario CONFIRMA (al hacer
 * clic en otra cosa, al pulsar Enter o Tab, o al cerrarse el campo), aunque la pagina ya lo haya
 * borrado. Por eso una sugerencia aceptada deja SIEMPRE dos pasos: primero el escribir con lo
 * tecleado, despues el clic (o la tecla) que la confirma.
 *
 * QUE CUENTA COMO CAMPO EDITABLE: input, textarea y select como siempre, mas los contenedores
 * `contenteditable` y los que el sitio declara con rol de combobox, textbox o searchbox. Un correo
 * moderno no usa un input para el cuerpo ni para los destinatarios, y limitarse a los campos estandar
 * era justo lo que dejaba fuera el dato que mas importa.
 *
 * CERO LLAMADAS AL MODELO: esto es lectura de DOM y eventos del navegador. No hay ningun canal por el
 * que este guion, ni el worker mientras graba, hablen con un modelo.
 *
 * EL INVARIANTE INNEGOCIABLE, aqui adentro y en tres capas:
 *  1. El guion NUNCA lee el valor de un `input[type=password]` (ni de ningun campo cuyo tipo sea
 *     password): el lector de valores lo salta antes de tocarlo.
 *  2. Antes de emitir CUALQUIER evento comprueba si hay un campo de contrasena en el documento; si lo
 *     hay, emite `{ tipo: 'contrasena' }` y se APAGA (deja de escuchar). El worker descarta lo
 *     capturado y avisa al usuario.
 *  3. Ademas comprueba periodicamente, para atrapar la pantalla de login que aparece SIN que el
 *     usuario haga nada (una expiracion de sesion a mitad de la grabacion).
 * La comprobacion es la MISMA que el pre-chequeo determinista de la tarea web (contrasena.ts).
 *
 * MUNDO AISLADO SIEMPRE: el guion se instala en un mundo aislado (igual que la verificacion y la
 * ejecucion determinista). Un sitio hostil que parchea `addEventListener`, `getAttribute` o
 * `JSON.stringify` no puede hacer que la grabacion registre otra cosa; y como el mundo aislado comparte
 * DOM pero no globales, la pagina tampoco puede ver ni llamar a la funcion enlazada.
 */

/** Nombre del mundo aislado donde vive el grabador. */
export const MUNDO_DE_GRABACION = 'ledesma-grabacion';

/** Nombre de la funcion enlazada por CDP con la que el guion le habla al worker. */
export const ENLACE_DE_GRABACION = '__ledesmaGrabacion';

/** Cada cuanto el guion vuelve a mirar si aparecio un campo de contrasena (ms). */
const INTERVALO_GUARDIA_MS = 1000;

/** Teclas NO imprimibles que se graban como paso 'teclas'. Cerrada: el texto va por 'escritura'. */
const TECLAS_GRABABLES = ['Enter', 'Tab', 'Escape'];

/**
 * ROLES que hacen editable a un contenedor que NO es input ni textarea. Lista cerrada y corta a
 * proposito: son los tres con los que un sitio implementa un campo de texto propio (el "Para" de un
 * correo es un combobox; un redactor enriquecido es un textbox). Cualquier otro rol no se lee.
 */
const ROLES_EDITABLES = ['combobox', 'textbox', 'searchbox'];

/**
 * El guion, listo para inyectar. Es idempotente (si ya se instalo en este documento, no hace nada) y
 * jamas lanza hacia la pagina: cualquier fallo propio se traga, porque romper la navegacion del
 * usuario mientras ensena una tarea seria peor que perder la grabacion.
 */
export const GUION_GRABADOR = `(() => {
  if (window.__ledesmaGrabadorInstalado) return;
  window.__ledesmaGrabadorInstalado = true;
${AYUDANTES_DOM}
  const TECLAS = ${JSON.stringify(TECLAS_GRABABLES)};
  const ROLES_EDITABLES = ${JSON.stringify(ROLES_EDITABLES)};
  let apagado = false;

  function emitir(dato) {
    try { ${ENLACE_DE_GRABACION}(JSON.stringify(dato)); } catch (e) { /* sin canal, sin grabacion */ }
  }

  // GUARDIA: la MISMA comprobacion determinista del pre-chequeo de caducidad. Devuelve true si hay que
  // parar; al parar, el grabador se apaga y no vuelve a emitir nada mas.
  function hayContrasena() {
    try { return ${EXPRESION_HAY_CAMPO_DE_CONTRASENA}; } catch (e) { return false; }
  }
  function guardia() {
    if (apagado) return true;
    if (!hayContrasena()) return false;
    apagado = true;
    emitir({ tipo: 'contrasena' });
    return true;
  }

  // El CONTEXTO con el que el worker decide si un valor es sensible: lo mismo que lee la verificacion
  // determinista de los campos de la pagina (tag, tipo, name, id, placeholder, aria-label, etiqueta).
  function contextoDe(el) {
    let etiqueta = '';
    try {
      const id = el.getAttribute('id');
      if (id && window.CSS && window.CSS.escape) {
        const asociada = document.querySelector('label[for="' + window.CSS.escape(id) + '"]');
        if (asociada) etiqueta = asociada.innerText || asociada.textContent || '';
      }
      if (!etiqueta && el.closest) {
        const contenedora = el.closest('label');
        if (contenedora) etiqueta = contenedora.innerText || contenedora.textContent || '';
      }
    } catch (e) { etiqueta = ''; }
    return [
      String(el.tagName || '').toLowerCase(),
      String(el.getAttribute('type') || '').toLowerCase(),
      el.getAttribute('name') || '',
      el.getAttribute('id') || '',
      el.getAttribute('placeholder') || '',
      el.getAttribute('aria-label') || '',
      etiqueta,
    ].join(' ').replace(/\\s+/g, ' ').trim().slice(0, 200);
  }

  // Lee el valor de un campo editable. NUNCA de un campo de contrasena: se salta antes de tocarlo.
  // Devuelve null cuando el elemento NO es un campo donde se escriba (entonces no se anota nada).
  function valorDe(el) {
    const tag = String(el.tagName || '').toLowerCase();
    const tipo = String(el.getAttribute ? el.getAttribute('type') || '' : '').toLowerCase();
    if (tipo === 'password') return null;
    if (el.matches && el.matches('${SELECTOR_CAMPO_CONTRASENA}')) return null;
    if (tag === 'select') {
      const opcion = el.selectedOptions && el.selectedOptions[0];
      return opcion ? String(opcion.textContent || opcion.value || '') : String(el.value || '');
    }
    if (tag === 'input' || tag === 'textarea') return String(el.value || '');
    if (el.isContentEditable === true) return String(el.innerText || el.textContent || '');
    // Contenedor que el sitio declara editable por ROL sin ser un campo estandar (el "Para" de un
    // correo, un buscador propio): se lee su valor si lo expone y, si no, su texto visible.
    if (ROLES_EDITABLES.indexOf(rolDe(el)) !== -1) {
      if (typeof el.value === 'string') return el.value;
      return String(el.innerText || el.textContent || '');
    }
    return null;
  }

  function elementoDe(evento) {
    const objetivo = evento.target;
    return objetivo && objetivo.nodeType === 1 ? objetivo : null;
  }

  emitir({ tipo: 'navegacion', url: String(location.href) });
  guardia();

  // LO QUE EL USUARIO ESTA ESCRIBIENDO AHORA: el campo y el ultimo valor NO VACIO que se le leyo.
  // Vive fuera del DOM a proposito. Cuando el sitio vacia el campo al aceptar una sugerencia, el
  // valor tecleado ya no esta en la pagina; sin esta anotacion el paso se perderia entero (que es
  // exactamente lo que pasaba con el destinatario de un correo).
  let pendiente = null;

  function anotar(el) {
    if (!el) return;
    // Escribir en OTRO campo cierra el anterior: su escritura se emite antes de empezar la nueva.
    if (pendiente !== null && pendiente.el !== el) volcar();
    const valor = valorDe(el);
    if (valor === null || valor.trim() === '') return;
    pendiente = { el: el, valor: valor };
  }

  // EMITE la escritura anotada (si hay). Las estrategias se leen AQUI, con el campo todavia en la
  // pagina: se emite durante la fase de captura del evento que la confirma, antes de que el sitio
  // reaccione.
  function volcar() {
    const anotado = pendiente;
    pendiente = null;
    if (anotado === null) return;
    emitir({
      tipo: 'escritura',
      url: String(location.href),
      estrategias: estrategiasDe(anotado.el),
      valor: anotado.valor,
      contexto: contextoDe(anotado.el),
    });
  }

  // Los escuchas van en FASE DE CAPTURA: se registran antes que los del sitio, asi que un sitio
  // que detiene la propagacion de sus propios eventos no puede esconderle la accion a la grabacion.

  // 'input' dispara en CADA pulsacion, en campos estandar y en contenteditable. No emite nada: solo
  // anota, para que el valor sobreviva a que el sitio vacie el campo.
  document.addEventListener('input', (evento) => {
    if (guardia()) return;
    anotar(elementoDe(evento));
  }, true);

  document.addEventListener('click', (evento) => {
    if (guardia()) return;
    const el = elementoDe(evento);
    // Clic FUERA del campo que se venia escribiendo: primero la escritura, despues el clic. Ese
    // orden es el que hace reutilizable una sugerencia de autocompletado. Un clic DENTRO del mismo
    // campo (mover el cursor) no cierra nada.
    if (pendiente !== null && pendiente.el !== el) volcar();
    if (!el) return;
    emitir({ tipo: 'clic', url: String(location.href), estrategias: estrategiasDe(el) });
  }, true);

  // 'change' cubre input/textarea/select y 'focusout' cubre los redactores contenteditable y los
  // contenedores con rol de campo, que no disparan 'change'. Los dos CIERRAN el campo: se relee su
  // valor (por si nunca hubo un 'input': autocompletado del navegador, un select) y se emite.
  function alTerminarDeEscribir(evento) {
    if (guardia()) return;
    anotar(elementoDe(evento));
    volcar();
  }
  document.addEventListener('change', alTerminarDeEscribir, true);
  document.addEventListener('focusout', alTerminarDeEscribir, true);

  document.addEventListener('keydown', (evento) => {
    if (guardia()) return;
    if (TECLAS.indexOf(evento.key) === -1) return;
    const el = elementoDe(evento);
    // El valor del campo se emite ANTES que la tecla. Sin esto el orden quedaria invertido (keydown
    // ocurre antes que change/focusout) y la receta pulsaria Tab o Enter sobre un campo todavia vacio.
    anotar(el);
    volcar();
    emitir({
      tipo: 'tecla',
      url: String(location.href),
      teclas: String(evento.key),
      estrategias: el ? estrategiasDe(el) : [],
    });
  }, true);

  // Una pantalla de login puede aparecer SIN que el usuario toque nada (la sesion expira a mitad).
  const reloj = setInterval(() => {
    if (guardia()) clearInterval(reloj);
  }, ${INTERVALO_GUARDIA_MS});
})()`;
