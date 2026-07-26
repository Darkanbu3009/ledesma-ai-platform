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
 * El guion, listo para inyectar. Es idempotente (si ya se instalo en este documento, no hace nada) y
 * jamas lanza hacia la pagina: cualquier fallo propio se traga, porque romper la navegacion del
 * usuario mientras ensena una tarea seria peor que perder la grabacion.
 */
export const GUION_GRABADOR = `(() => {
  if (window.__ledesmaGrabadorInstalado) return;
  window.__ledesmaGrabadorInstalado = true;
${AYUDANTES_DOM}
  const TECLAS = ${JSON.stringify(TECLAS_GRABABLES)};
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
    return null;
  }

  function elementoDe(evento) {
    const objetivo = evento.target;
    return objetivo && objetivo.nodeType === 1 ? objetivo : null;
  }

  emitir({ tipo: 'navegacion', url: String(location.href) });
  guardia();

  // Los tres escuchas van en FASE DE CAPTURA: se registran antes que los del sitio, asi que un sitio
  // que detiene la propagacion de sus propios eventos no puede esconderle la accion a la grabacion.
  document.addEventListener('click', (evento) => {
    if (guardia()) return;
    const el = elementoDe(evento);
    if (!el) return;
    emitir({ tipo: 'clic', url: String(location.href), estrategias: estrategiasDe(el) });
  }, true);

  // 'change' cubre input/textarea/select (dispara al salir del campo o al confirmar) y 'focusout'
  // cubre los redactores contenteditable, que no disparan 'change'. El valor que se graba es el FINAL
  // del campo, no cada pulsacion: una receta teclea el valor completo de una vez.
  function emitirEscritura(el) {
    if (!el) return;
    const valor = valorDe(el);
    if (valor === null || valor.trim() === '') return;
    emitir({
      tipo: 'escritura',
      url: String(location.href),
      estrategias: estrategiasDe(el),
      valor: valor,
      contexto: contextoDe(el),
    });
  }
  function alTerminarDeEscribir(evento) {
    if (guardia()) return;
    emitirEscritura(elementoDe(evento));
  }
  document.addEventListener('change', alTerminarDeEscribir, true);
  document.addEventListener('focusout', alTerminarDeEscribir, true);

  document.addEventListener('keydown', (evento) => {
    if (guardia()) return;
    if (TECLAS.indexOf(evento.key) === -1) return;
    const el = elementoDe(evento);
    // El valor del campo se emite ANTES que la tecla. Sin esto el orden quedaria invertido (keydown
    // ocurre antes que change/focusout) y la receta pulsaria Tab o Enter sobre un campo todavia vacio.
    // La escritura que llegue despues por change/focusout no duplica el paso: el acumulador reemplaza
    // la ultima escritura del mismo elemento por su valor final.
    emitirEscritura(el);
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
