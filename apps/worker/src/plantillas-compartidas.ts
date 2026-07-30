import { createHmac } from 'node:crypto';
import {
  dominiosClave,
  esPublicable,
  marcadoresClave,
  marcadoresDePasosPublicables,
  type CodigoDeIntencion,
  type MotivoDeNoPublicable,
  type PasoDeReceta,
  type PasoPublicable,
} from '@ledesma-platform/shared';
import { claseDeElemento } from './atlas-sitios.js';
import { VERBOS_ACCION_BLOQUEADA, type AccionIrreversible } from './prompt-tarea-web.js';

/**
 * PLANTILLAS COMPARTIDAS (V041), parte PURA: convierte una receta que el propio origen acaba de
 * aprender en la PLANTILLA ANONIMA que se publica, y deriva el hash de origen con el que se cuentan
 * origenes distintos sin identificar a ninguno.
 *
 * Es la segunda pieza del APRENDIZAJE COLECTIVO. El ATLAS DE SITIOS (V040) aprende COMO se encuentra
 * un control; una plantilla aprende EN QUE ORDEN se operan varios controles para llevar a cabo una
 * INTENCION IRREVERSIBLE. Lo que se publica no es la tarea de nadie: es el procedimiento sin el
 * usuario.
 *
 * Modulo PURO (sin base, sin navegador, sin reloj propio): mismo criterio que atlas-sitios.ts y
 * receta-web.ts. La persistencia vive en el repositorio del backend
 * (PlantillasCompartidasRepository) y la orquestacion en tarea-web.ts.
 *
 * ESTE MODULO SOLO PRODUCE. No tiene ni una funcion que lea una plantilla ajena ni que la convierta
 * en pasos ejecutables: el consumo es un cambio aparte.
 *
 * LOS TRES INVARIANTES, y donde los hace cumplir este archivo:
 *
 *  1. NADA DEL USUARIO SALE DE AQUI. `plantillaDeLaCorrida` no recibe el objetivo, ni la firma, ni la
 *     descripcion, ni los valores de la corrida: recibe los pasos ya promovidos, el conjunto de
 *     dominios y el VERBO que la deteccion determinista saco del texto del usuario. Todo lo que sale
 *     pasa por `esPublicable` (packages/shared), que rechaza la plantilla entera ante cualquier
 *     literal, xpath, ruta, atributo no estructural o clase sin aval.
 *
 *  2. SOLO INTENCIONES IRREVERSIBLES. Sin verbo bloqueado NO hay plantilla, y `codigoDeIntencion`
 *     devuelve null, que el llamador trata como "no se publica nada". El motivo es de seguridad: con
 *     el verbo en null la guardia de accion deja pasar todo sin comparar nada contra la pagina
 *     (tarea-web.ts), asi que una plantilla reversible ajena correria sin una sola comprobacion.
 *
 *  3. HASHES INCOMPARABLES CON LOS DEL ATLAS. La clave se deriva con una etiqueta PROPIA. Ver
 *     `clavePlantillas`: no es un detalle de implementacion, es la decision que impide unir las dos
 *     tablas globales por el hash y reconstruir un patron de uso.
 */

/** Etiqueta de derivacion de la clave HMAC. DISTINTA de la del atlas, y ese es todo el punto. */
const ETIQUETA_DERIVACION = 'plantillas-compartidas/v1';

/** Prefijo del mensaje que se hashea, para que un hash de plantillas no valga en ningun otro contexto. */
const ETIQUETA_ORIGEN = 'plantillas-compartidas:origen:';

/**
 * CODIGO DE INTENCION por FAMILIA de accion irreversible. Record EXHAUSTIVO a proposito: es la unica
 * cosa que ata las TRES copias de la lista de ocho (la union `AccionIrreversible` del worker, el
 * arreglo `CODIGOS_DE_INTENCION` de shared y la lista del CHECK de V041). Agregar una familia a
 * `AccionIrreversible` sin agregarla a `CodigoDeIntencion` deja de compilar por la clave que falta, y
 * al reves por el valor que no existe. Sin este Record las dos listas serian dos copias a mano que
 * pueden divergir en silencio, y una divergencia aqui significa una fila rechazada por el CHECK en
 * produccion sin que nada lo avise en CI.
 */
const CODIGO_POR_ACCION: Readonly<Record<AccionIrreversible, CodigoDeIntencion>> = {
  enviar: 'enviar',
  publicar: 'publicar',
  borrar: 'borrar',
  pagar: 'pagar',
  transferir: 'transferir',
  comprar: 'comprar',
  firmar: 'firmar',
  cancelarSuscripcion: 'cancelarSuscripcion',
};

/**
 * A QUE CODIGO DE INTENCION corresponde el verbo bloqueado de una corrida. `verboBloqueado` es la
 * FORMA CANONICA que devolvio `detectarVerboBloqueado` sobre el texto literal del usuario
 * ("enviar", "send", "cancelar suscripcion"); lo que la plantilla guarda es su FAMILIA, que es lo que
 * agrupa "enviar"/"send" y "borrar"/"eliminar"/"delete" como una sola accion del mundo real.
 *
 * La busqueda es la MISMA que ya hace la barrera de identidad del elemento (barrera-identidad.ts) y
 * sobre la MISMA tabla, para que las dos hablen de la misma familia. Devuelve null cuando no hay
 * verbo (tarea reversible: no se publica) o cuando el verbo no esta en la tabla, que solo puede pasar
 * si alguien lo saco de ahi: falla cerrada.
 *
 * NINGUN MODELO PARTICIPA. Ni aqui ni en `detectarVerboBloqueado`, que es una expresion regular sobre
 * lo que el usuario ya habia escrito. No hay clasificador nuevo y no hay llamada al modelo.
 */
export function codigoDeIntencion(verboBloqueado: string | null): CodigoDeIntencion | null {
  if (verboBloqueado === null) return null;
  const familia = VERBOS_ACCION_BLOQUEADA.find((verbo) => verbo.verbo === verboBloqueado)?.accion;
  return familia === undefined ? null : CODIGO_POR_ACCION[familia];
}

/**
 * CLAVE HMAC de las plantillas compartidas, DERIVADA del secreto de la boveda con una etiqueta
 * propia.
 *
 * POR QUE NO SE REUSA LA CLAVE DEL ATLAS, y es una decision de privacidad, no de estilo: si el mismo
 * owner produjera el MISMO hash en `aprendizaje_sitios` y en `plantillas_compartidas`, quien tuviera
 * acceso a la base podria unir las dos tablas por ese hash y reconstruir un patron de uso ("el origen
 * que produjo esta plantilla es el mismo que produjo estas 40 entradas en estos 6 dominios"). Eso es
 * un cuasi identificador, y lo seria aunque cada tabla por separado no identifique a nadie. Con dos
 * etiquetas de derivacion distintas los dos hashes del mismo owner son INCOMPARABLES y el join no
 * existe.
 *
 * La derivacion es de una sola via, igual que en `claveDelAtlas`: la clave de plantillas no permite
 * reconstruir VAULT_SECRET ni la clave del atlas. Y no hace falta configurar nada nuevo en el
 * despliegue, que es lo que permite que la publicacion quede activa desde el merge; rotar VAULT_SECRET
 * solo hace que los origenes se vuelvan a contar desde cero (peor caso: una plantilla tarda una
 * corrida mas en juntar dos origenes).
 */
export function clavePlantillas(params: { vaultSecret: string }): string {
  return createHmac('sha256', params.vaultSecret).update(ETIQUETA_DERIVACION).digest('hex');
}

/**
 * HASH DE ORIGEN: HMAC-SHA256 del owner con la clave de plantillas. Es un CONTADOR DE DISTINTOS, no
 * un identificador. De una sola via: desde la fila no se vuelve al usuario, y sin la clave (que vive
 * solo en el worker, nunca en la base) no se puede ni confirmar una sospecha comparando hashes.
 */
export function hashDeOrigenDePlantilla(ownerId: string, clave: string): string {
  return createHmac('sha256', clave).update(`${ETIQUETA_ORIGEN}${ownerId}`).digest('hex');
}

/** Una plantilla lista para publicar: su identidad y su procedimiento, y nada mas. */
export interface PlantillaDeLaCorrida {
  /** Conjunto de dominios ordenado, deduplicado y unido con '+'. */
  dominiosClave: string;
  codigoDeIntencion: CodigoDeIntencion;
  /** Conjunto de marcadores exigidos, ordenado y unido con '+', o ''. */
  marcadoresClave: string;
  pasos: PasoPublicable[];
}

export type ResultadoDePlantilla =
  | { publicable: true; plantilla: PlantillaDeLaCorrida }
  | { publicable: false; motivo: MotivoDeNoPublicable | 'sin_intencion_irreversible'; idx: number };

/**
 * LA PLANTILLA de una corrida que acaba de dejar una receta propia. Cuatro pasos, en este orden:
 *
 *  1. la INTENCION. Sin verbo irreversible no hay plantilla, y se corta antes de mirar un solo paso.
 *  2. la CLASE de cada paso, calculada con la MISMA `claseDeElemento` del atlas: si la clase que
 *     escribe el atlas y la que compara la plantilla no fueran la misma funcion, una plantilla podria
 *     declarar una clase que ninguna entrada del atlas va a corroborar nunca.
 *  3. `esPublicable` (packages/shared), la puerta de los siete motivos. Es la MISMA funcion que el
 *     repositorio del backend vuelve a correr antes del insert.
 *  4. la IDENTIDAD, derivada de lo que salio de la puerta y no de lo que entro.
 *
 * `dominios` es el conjunto de dominios de la tarea, el MISMO que recibe `firmaDeObjetivo` al
 * promover la receta (los dominios que el job autorizo). Se usa ese y no "los dominios que los pasos
 * acabaron tocando" para que la clave con la que se publica sea la misma con la que una tarea nueva
 * podra buscar: el consumidor conoce sus sitios autorizados antes de tener ninguna plantilla en la
 * mano, no los que la plantilla va a terminar usando.
 */
export function plantillaDeLaCorrida(entrada: {
  pasos: readonly PasoDeReceta[];
  /** Dominio de la conexion: el de los pasos que no declaran uno propio (multisitio). */
  dominio: string;
  /** Conjunto de dominios de la tarea (los que el job autorizo). */
  dominios: readonly string[];
  /** Forma canonica del verbo irreversible del objetivo, o null si la tarea es reversible. */
  verboBloqueado: string | null;
  /** Clases que el dominio tiene avaladas por origenes independientes. */
  clasesCorroboradas: ReadonlySet<string>;
}): ResultadoDePlantilla {
  const codigo = codigoDeIntencion(entrada.verboBloqueado);
  if (codigo === null) return { publicable: false, motivo: 'sin_intencion_irreversible', idx: -1 };

  const clave = dominiosClave(entrada.dominios);
  if (clave === '') return { publicable: false, motivo: 'sin_identidad_estructural', idx: -1 };

  // La CLASE de cada paso, con la misma funcion que alimenta el atlas. Un paso que no actua sobre un
  // elemento (teclas, esperar, verificar) no tiene clase y `claseDeElemento` ya devuelve null ahi.
  const anotados = entrada.pasos.map((paso) => ({
    ...paso,
    claseDeElemento: claseDeElemento(paso.accion, paso.estrategias),
  }));

  const veredicto = esPublicable(anotados, entrada.dominio, entrada.clasesCorroboradas);
  if (!veredicto.publicable) {
    return { publicable: false, motivo: veredicto.motivo, idx: veredicto.idx };
  }

  return {
    publicable: true,
    plantilla: {
      dominiosClave: clave,
      codigoDeIntencion: codigo,
      // Los marcadores se derivan de los pasos QUE SALIERON de la puerta, no de los que entraron: es
      // lo que garantiza que la clave de identidad diga exactamente lo que la plantilla va a pedir.
      marcadoresClave: marcadoresClave(marcadoresDePasosPublicables(veredicto.pasos)),
      pasos: veredicto.pasos,
    },
  };
}
