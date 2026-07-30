import { normalizarTexto } from './parametros-objetivo.js';
import { VERBOS_ACCION_BLOQUEADA } from './prompt-tarea-web.js';

/**
 * BARRERA DE IDENTIDAD DEL ELEMENTO, parte PURA. Responde la unica pregunta que la verificacion
 * determinista (verificacion.ts, verificarAccion) NUNCA se hace: ¿el elemento que se va a accionar
 * es el que corresponde?
 *
 * EL HUECO QUE CIERRA. verificarAccion tiene siete criterios (politica, dominio excluido, dato
 * exigido por el verbo, pagina legible, tope de monto, comparacion de cada parametro declarado
 * contra el DOM y presencia de los N declarados) y NINGUNO mira la identidad del elemento: el
 * parametro `verbo` solo decide que dato es obligatorio. Un paso de receta cuyo ultimo click apunte
 * a [{tipo:'rol', rol:'button', nombre:'Eliminar definitivamente'}] supera la verificacion al 100 %
 * (los parametros coinciden con el DOM, el monto no aplica, la politica permite) y el ejecutor borra.
 * Los dos caminos por los que eso pasa hoy en produccion:
 *  - una receta cuyas estrategias se auto repararon (repararEstrategias, receta-web.ts) y quedaron
 *    apuntando a otro elemento tras un rediseno del sitio;
 *  - un modelo alucinado del motor libre que pulsa el boton contiguo.
 *
 * ASIMETRIA INVERTIDA, y es la razon de que esto sea una ALLOWLIST ESTRICTA. En
 * detectarAccionQueExigeVerificacion (prompt-tarea-web.ts) lo caro es el falso NEGATIVO: dejaria
 * pasar la accion del objetivo sin compararla, asi que ahi el matcheo es laxo a proposito. Aqui es al
 * REVES: un falso POSITIVO ejecuta la accion equivocada sobre la cuenta real del usuario. Por eso
 * solo hay `permitir` cuando cada comprobacion pasa de forma explicita, y no existe un tercer valor.
 *
 * FALLA CERRADA SIN EXCEPCION (precedente del repo: tarea-web.ts, verificacion.ts). Nombre accesible
 * null, clase null, clase ausente de las corroboradas o verbo que no corresponde: todos bloquean.
 *
 * QUE NO CONSULTA, a proposito: `esNavegacionDeSoloLectura` (prompt-tarea-web.ts). Esa funcion existe
 * para que la navegacion y la lectura JAMAS se bloqueen, y hoy devuelve true en cuanto la descripcion
 * menciona link, folder, sidebar o inbox. Consultarla aqui convertiria su bypass en un bypass de esta
 * barrera: un boton llamado "Mover a la carpeta" quedaria exento de comprobar su identidad. La
 * barrera juzga el NOMBRE ACCESIBLE LEIDO DEL DOM, no la descripcion que redacta un modelo.
 *
 * Modulo PURO: sin navegador, sin base y sin reloj. La lectura del DOM la hace el cableado
 * (ejecutor-receta.ts) y entra aqui como un dato mas.
 */

/** Por que la barrera no deja actuar sobre el elemento. */
export type MotivoDeBloqueoDeIdentidad =
  /** El paso no declara una clase de elemento, o esa clase no esta corroborada en el dominio. */
  | 'clase_no_corroborada'
  /** El elemento que hay en el DOM no lleva el nombre que la clase del paso declara. */
  | 'clase_distinta'
  /** El nombre accesible del elemento no pertenece a la familia del verbo que pidio el usuario. */
  | 'verbo_no_corresponde'
  /** No se pudo leer el nombre accesible del elemento (nunca se actua a ciegas). */
  | 'elemento_no_legible';

/** Veredicto de la barrera. Dos valores y nada mas: o pasa, o se bloquea con su motivo. */
export type VeredictoDeIdentidad =
  | { tipo: 'permitir' }
  | { tipo: 'bloquear'; motivo: MotivoDeBloqueoDeIdentidad };

/** MODO de la barrera (TAREA_WEB_BARRERA_IDENTIDAD). Ver env.ts para el criterio de cada valor. */
export type ModoBarreraIdentidad = 'apagada' | 'observacion' | 'activa';

export interface EntradaDeIdentidad {
  /** Clase del elemento del paso (claseDeElemento, atlas-sitios.ts). null = el paso no la declara. */
  claseDeclarada: string | null;
  /** Clases que el atlas tiene CORROBORADAS para este dominio (esServible ya aplicado). */
  clasesCorroboradas: ReadonlySet<string>;
  /** Verbo irreversible del OBJETIVO DEL USUARIO, resuelto una vez por corrida. null = no hay. */
  verboDelObjetivo: string | null;
  /** ¿Este paso es el que consuma la accion irreversible del objetivo? */
  esPasoIrreversible: boolean;
  /** Nombre accesible LEIDO DEL DOM del elemento que se va a accionar. null = no se pudo leer. */
  nombreAccesible: string | null;
}

/**
 * El NOMBRE que lleva dentro una clase de elemento. El formato lo produce claseDeElemento
 * (atlas-sitios.ts) y es `accion|rol:<rol>|<nombre>`, `accion|atributo:<attr>|<nombre>` o
 * `accion|texto|<nombre>`: el nombre es todo lo que sigue al SEGUNDO separador (el propio nombre
 * puede contener el separador, asi que no se puede partir por todos). Ya viene normalizado y
 * truncado a MAX_NOMBRE_ATLAS por quien construyo la clase.
 */
function nombreDeLaClase(clase: string): string | null {
  const primero = clase.indexOf('|');
  if (primero < 0) return null;
  const segundo = clase.indexOf('|', primero + 1);
  if (segundo < 0) return null;
  const nombre = clase.slice(segundo + 1);
  return nombre === '' ? null : nombre;
}

/**
 * ¿El nombre accesible pertenece a la FAMILIA del verbo que pidio el usuario? Se reusan los regex de
 * VERBOS_ACCION_BLOQUEADA filtrados por familia (`accion`), que es lo que agrupa "enviar"/"send" y
 * "borrar"/"eliminar"/"delete" como una sola accion del mundo real.
 *
 * Se aplican al NOMBRE ACCESIBLE DEL ELEMENTO, jamas a la descripcion del modelo. El nombre se
 * normaliza con normalizarTexto (minusculas, sin acentos, espacios colapsados), que es la
 * normalizacion con la que se construyeron los patrones y las clases del atlas.
 *
 * El criterio es de CONTENCION, no de igualdad: el aria-label real del boton Enviar de Gmail es
 * "Enviar (Ctrl-Enter)" y un boton puede describir dos cosas a la vez ("Enviar y archivar"). Lo que
 * NO alcanza es un nombre de otra familia ("Eliminar definitivamente") ni uno sin familia
 * ("Archivar"): esos no son la accion que el usuario pidio.
 */
function correspondeALaFamilia(nombreAccesible: string, verboDelObjetivo: string): boolean {
  const familia = VERBOS_ACCION_BLOQUEADA.find((v) => v.verbo === verboDelObjetivo)?.accion;
  if (familia === undefined) return false;
  const texto = normalizarTexto(nombreAccesible);
  if (texto === '') return false;
  return VERBOS_ACCION_BLOQUEADA.some((v) => v.accion === familia && v.patron.test(texto));
}

/**
 * ¿Se puede actuar sobre este elemento? Dos comprobaciones, en este orden:
 *
 *  (a) LA CLASE. El paso declara una clase de elemento, esa clase esta CORROBORADA en el dominio y
 *      -- cuando se pudo leer el DOM -- el elemento que hay ahi lleva el nombre que la clase declara.
 *      Lo ultimo es lo que atrapa la deriva de una receta auto reparada: la clase dice "enviar" y en
 *      el DOM hay un "Eliminar definitivamente" -> 'clase_distinta'.
 *
 *  (b) EL VERBO, solo en el paso IRREVERSIBLE. El nombre accesible del elemento corresponde a la
 *      familia del verbo que el usuario pidio. Sin nombre no hay identidad que comprobar y no se
 *      actua a ciegas -> 'elemento_no_legible'.
 */
export function verificarIdentidadDeElemento(entrada: EntradaDeIdentidad): VeredictoDeIdentidad {
  const { claseDeclarada, nombreAccesible } = entrada;

  // (a) LA CLASE. Un paso sin clase es un elemento que solo se sabe localizar por su posicion en el
  //     DOM: no hay identidad que comparar. Una clase que el dominio no corroboro tampoco la tiene.
  if (claseDeclarada === null) return { tipo: 'bloquear', motivo: 'clase_no_corroborada' };
  if (!entrada.clasesCorroboradas.has(claseDeclarada)) {
    return { tipo: 'bloquear', motivo: 'clase_no_corroborada' };
  }
  if (nombreAccesible !== null) {
    const declarado = nombreDeLaClase(claseDeclarada);
    if (declarado === null) return { tipo: 'bloquear', motivo: 'clase_no_corroborada' };
    // Por PREFIJO: el nombre de la clase viene truncado a MAX_NOMBRE_ATLAS y el aria-label real lleva
    // sufijos que la clase no puede tener ("Enviar" contra "Enviar (Ctrl-Enter)").
    if (!normalizarTexto(nombreAccesible).startsWith(declarado)) {
      return { tipo: 'bloquear', motivo: 'clase_distinta' };
    }
  }

  if (!entrada.esPasoIrreversible) return { tipo: 'permitir' };

  // (b) EL VERBO. Solo el paso que consuma la accion irreversible del objetivo.
  if (nombreAccesible === null) return { tipo: 'bloquear', motivo: 'elemento_no_legible' };
  if (entrada.verboDelObjetivo === null) return { tipo: 'bloquear', motivo: 'verbo_no_corresponde' };
  if (!correspondeALaFamilia(nombreAccesible, entrada.verboDelObjetivo)) {
    return { tipo: 'bloquear', motivo: 'verbo_no_corresponde' };
  }
  return { tipo: 'permitir' };
}
