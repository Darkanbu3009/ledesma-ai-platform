import type { PasoDeReceta } from '@ledesma-platform/shared';
import { claseDeElemento } from './atlas-sitios.js';
import { AYUDANTES_DOM, nombreCoincidePorPrefijo } from './localizacion.js';

/**
 * SONDA DE RECONOCIMIENTO PREVIA (pre-flight), parte PURA: antes de ejecutar cualquier procedimiento
 * aprendido (plantilla ajena o receta propia), con la pagina de partida cargada, se lee la
 * estructura y se comprueba que las CLASES DE ELEMENTO que el procedimiento necesita y que son
 * OBSERVABLES en ese momento existan en la pagina. Si falta alguna, NO se ejecuta un solo paso: la
 * tarea cae al motor libre con la pagina limpia y el desajuste queda registrado.
 *
 * CERO REGLAS POR SITIO. Todo opera sobre el modelo canonico de clases de elemento
 * (`claseDeElemento`, atlas-sitios.ts), que es agnostico al sitio: no hay un selector, un dominio ni
 * una heuristica de ningun sitio concreto en este modulo, y la comparacion de nombres es LA MISMA
 * FUNCION que usa la barrera de identidad (`nombreCoincidePorPrefijo`, localizacion.ts, ver
 * `verificarIdentidadDeElemento` en barrera-identidad.ts). La sonda es una compuerta ADICIONAL: no
 * relaja ni sustituye la barrera ni la verificacion determinista, que siguen corriendo igual.
 *
 * SIN MODELO Y SIN ACCIONES: la unica entrada al DOM es la expresion de SOLO LECTURA de
 * `expresionSondaDeClases`, evaluada en el mundo aislado por el adaptador del navegador (misma
 * primitiva que la percepcion y el localizador de la barrera). Cero tokens por construccion.
 *
 * QUE ES OBSERVABLE EN PRE-FLIGHT, y es un criterio GENERICO, no una lista: la clase de un paso es
 * observable en la pagina inicial solo si NINGUN paso anterior pudo haber alterado la estructura
 * visible. Un 'click' puede abrir un panel, un dialogo o una vista; un 'escribir' puede desplegar un
 * autocompletado; una pulsacion de 'teclas' puede confirmar o cerrar; un 'navegar' cambia la pagina
 * entera. 'verificar' y 'esperar' no tocan nada. Por eso el recorrido se corta EN el primer paso que
 * puede mutar la pagina (ese paso, si actua sobre un elemento, SI es observable: nada ocurrio antes
 * de el), y las clases que solo existen despues -- el campo de destinatario que nace al abrir un
 * redactor -- se siguen verificando en su momento natural con la barrera de identidad.
 *
 * ANTI FALSO POSITIVO: la decision de desajuste NUNCA se toma con una sola lectura. El cableado
 * (tarea-web.ts) reintenta tras un intervalo corto para tolerar una pagina que aun esta hidratando,
 * la presencia se acepta con el elemento OCULTO (un menu colapsado sigue siendo el mismo control) y
 * una lectura que falla deja la sonda en 'no_evaluable': declarar desajuste por una pagina a medio
 * cargar seria peor que no tener sonda.
 */

/** Lecturas de la sonda antes de declarar desajuste: la primera mas UN reintento por hidratacion. */
export const LECTURAS_DE_SONDA = 2;

/** Espera entre las dos lecturas, para que una pagina hidratando termine de pintar sus controles. */
export const ESPERA_ENTRE_LECTURAS_DE_SONDA_MS = 1_500;

/** Tope de candidatos que la expresion devuelve por clase: la comparacion final corre en el worker. */
export const MAX_CANDIDATOS_POR_CLASE = 200;

/** Tope de caracteres de cada candidato. Mas que MAX_NOMBRE_ATLAS: el prefijo compara contra 60. */
const MAX_TEXTO_CANDIDATO = 120;

/**
 * UNA clase de elemento ya parseada para la sonda: el eje con el que se busca en la pagina y el
 * nombre normalizado contra el que se compara. El formato lo produce `claseDeElemento`
 * (`accion|rol:<rol>|<nombre>`, `accion|atributo:<attr>|<nombre>` o `accion|texto|<nombre>`) y el
 * nombre puede contener el separador, asi que solo se parte por los dos primeros (mismo criterio que
 * `nombreDeLaClase`, barrera-identidad.ts).
 */
export interface DescriptorDeSonda {
  /** La clase completa, para nombrar el desajuste sin recalcular nada. */
  clase: string;
  eje: 'rol' | 'atributo' | 'texto';
  /** Solo eje 'rol': el rol accesible que el elemento debe tener. */
  rol: string | null;
  /** Solo eje 'atributo': el atributo del que se lee el valor (aria-label o data-*). */
  atributo: string | null;
  /** El nombre de la clase, ya normalizado y truncado por quien la construyo. */
  nombre: string;
}

/** ¿Atributo que la sonda puede consultar? La misma lista estrecha del atlas: aria-label y data-*. */
function esAtributoSondeable(atributo: string): boolean {
  return atributo === 'aria-label' || /^data-[a-z0-9-]{1,40}$/.test(atributo);
}

/**
 * Parsea una clase de elemento al descriptor de la sonda. Devuelve null ante cualquier forma que no
 * sea la del contrato (falla ABIERTA a proposito: una clase que no se puede sondear simplemente no
 * se comprueba en pre-flight; la barrera la seguira comprobando en su momento).
 */
export function parsearClaseDeElemento(clase: string): DescriptorDeSonda | null {
  const primero = clase.indexOf('|');
  if (primero < 0) return null;
  const segundo = clase.indexOf('|', primero + 1);
  if (segundo < 0) return null;
  const eje = clase.slice(primero + 1, segundo);
  const nombre = clase.slice(segundo + 1);
  if (nombre === '') return null;
  if (eje === 'texto') return { clase, eje: 'texto', rol: null, atributo: null, nombre };
  if (eje.startsWith('rol:')) {
    const rol = eje.slice('rol:'.length);
    return rol === '' ? null : { clase, eje: 'rol', rol, atributo: null, nombre };
  }
  if (eje.startsWith('atributo:')) {
    const atributo = eje.slice('atributo:'.length);
    if (!esAtributoSondeable(atributo)) return null;
    return { clase, eje: 'atributo', rol: null, atributo, nombre };
  }
  return null;
}

/** Acciones que pueden ALTERAR la estructura visible de la pagina. Ver la cabecera del modulo. */
const ACCIONES_QUE_MUTAN: ReadonlySet<PasoDeReceta['accion']> = new Set<PasoDeReceta['accion']>([
  'click',
  'escribir',
  'teclas',
  'navegar',
]);

/**
 * LAS CLASES OBSERVABLES en la pagina inicial de un procedimiento: las de los pasos que actuan sobre
 * un elemento ANTES de que nada haya podido cambiar la pagina, o sea hasta el PRIMER paso que puede
 * mutarla, inclusive (el elemento de ese paso tiene que existir antes de que el paso actue).
 *
 * Un paso de OTRO dominio corta el recorrido: la pagina que el usuario tiene enfrente es la del
 * dominio de partida y nada de otro sitio es observable en ella. Lista vacia = no hay nada que
 * sondear (por ejemplo, un procedimiento que arranca navegando) y el pre-flight no aplica.
 */
export function clasesObservablesEnInicio(
  pasos: readonly PasoDeReceta[],
  dominioInicial: string,
): string[] {
  const clases: string[] = [];
  for (const paso of pasos) {
    if (paso.accion === 'verificar' || paso.accion === 'esperar') continue;
    if ((paso.dominio ?? dominioInicial) !== dominioInicial) break;
    if (paso.accion === 'click' || paso.accion === 'escribir') {
      const clase = claseDeElemento(paso.accion, paso.estrategias);
      if (clase !== null && !clases.includes(clase)) clases.push(clase);
    }
    if (ACCIONES_QUE_MUTAN.has(paso.accion)) break;
  }
  return clases;
}

/** Los descriptores sondeables de una lista de clases. Lo no parseable se omite (falla abierta). */
export function descriptoresDeSonda(clases: readonly string[]): DescriptorDeSonda[] {
  const descriptores: DescriptorDeSonda[] = [];
  for (const clase of clases) {
    const descriptor = parsearClaseDeElemento(clase);
    if (descriptor !== null) descriptores.push(descriptor);
  }
  return descriptores;
}

/**
 * Expresion de SOLO LECTURA que, para cada descriptor, junta los CANDIDATOS de su eje leidos de la
 * pagina: los nombres accesibles de los elementos con ese rol, los valores de ese atributo o los
 * textos visibles de los elementos hoja. Devuelve un JSON `string[][]`, una lista por descriptor y
 * en su orden.
 *
 * LA COMPARACION NO OCURRE AQUI a proposito: los candidatos vuelven CRUDOS y el worker los compara
 * con `normalizarTexto` (la MISMA normalizacion con la que se construyo la clase y con la que
 * compara la barrera de identidad). Normalizar dentro de la pagina exigiria una segunda copia del
 * normalizador, y dos copias que diverjan producirian desajustes falsos, que es lo unico que la
 * sonda no puede permitirse.
 *
 * Los elementos OCULTOS cuentan como candidatos a proposito (tolerancia): la sonda pregunta si el
 * control EXISTE en la estructura, no si esta a la vista; quien decide como accionarlo sigue siendo
 * la ejecucion de siempre. Usa los MISMOS ayudantes (`rolDe`, `nombreDe`, `textoDe`) con los que la
 * percepcion y el grabador derivan la clase de ese mismo control.
 */
export function expresionSondaDeClases(descriptores: readonly DescriptorDeSonda[]): string {
  const especificacion = descriptores.map((descriptor) => ({
    eje: descriptor.eje,
    rol: descriptor.rol,
    atributo: descriptor.atributo,
  }));
  return `(() => {
${AYUDANTES_DOM}
  const descriptores = JSON.parse(${JSON.stringify(JSON.stringify(especificacion))});
  const MAX = ${MAX_CANDIDATOS_POR_CLASE};
  const CORTE = ${MAX_TEXTO_CANDIDATO};
  const resultado = [];
  for (const d of descriptores) {
    const candidatos = [];
    if (d.eje === 'rol') {
      for (const el of document.querySelectorAll('*')) {
        if (candidatos.length >= MAX) break;
        if (rolDe(el) !== d.rol) continue;
        const nombre = nombreDe(el);
        if (nombre !== '') candidatos.push(nombre.slice(0, CORTE));
      }
    } else if (d.eje === 'atributo') {
      let elementos;
      try { elementos = document.querySelectorAll('[' + d.atributo + ']'); } catch (e) { elementos = []; }
      for (const el of elementos) {
        if (candidatos.length >= MAX) break;
        const valor = el.getAttribute(d.atributo) || '';
        if (valor.trim() !== '') candidatos.push(valor.slice(0, CORTE));
      }
    } else {
      for (const el of document.querySelectorAll('*')) {
        if (candidatos.length >= MAX) break;
        if (el.childElementCount !== 0) continue;
        const texto = textoDe(el);
        if (texto !== '' && texto.length <= CORTE) candidatos.push(texto);
      }
    }
    resultado.push(candidatos);
  }
  return JSON.stringify(resultado);
})()`;
}

/**
 * Lee (tolerante) lo que la expresion devolvio. null = la lectura no sirve y la sonda queda
 * NO EVALUABLE: jamas se declara un desajuste sobre una lectura rota.
 */
export function parsearLecturaDeSonda(
  crudo: string | null,
  cuantos: number,
): string[][] | null {
  if (crudo === null || crudo === '') return null;
  try {
    const parseado: unknown = JSON.parse(crudo);
    if (!Array.isArray(parseado) || parseado.length !== cuantos) return null;
    const listas: string[][] = [];
    for (const item of parseado) {
      if (!Array.isArray(item)) return null;
      listas.push(item.filter((texto): texto is string => typeof texto === 'string'));
    }
    return listas;
  } catch {
    return null;
  }
}

/**
 * ¿Que clases FALTAN en la pagina? Una clase esta presente si algun candidato de su eje lleva su
 * nombre COMO PREFIJO HASTA UN LIMITE DE PALABRA: exactamente la comparacion de la barrera de
 * identidad, que es la MISMA funcion (`nombreCoincidePorPrefijo`, localizacion.ts). El prefijo hace
 * falta porque el nombre de la clase viene truncado a MAX_NOMBRE_ATLAS y el nombre real puede
 * llevar sufijos que la clase no puede tener; el limite de palabra hace falta porque un candidato
 * que solo CONTINUA la palabra ("Parar reproduccion" para una clase "para") no es ese control, y
 * darlo por presente aqui es prometer que la barrera lo va a dejar actuar despues.
 */
export function clasesFaltantes(
  descriptores: readonly DescriptorDeSonda[],
  lecturas: readonly (readonly string[])[],
): string[] {
  const faltantes: string[] = [];
  descriptores.forEach((descriptor, indice) => {
    const candidatos = lecturas[indice] ?? [];
    const presente = candidatos.some((candidato) =>
      nombreCoincidePorPrefijo(candidato, descriptor.nombre),
    );
    if (!presente) faltantes.push(descriptor.clase);
  });
  return faltantes;
}
