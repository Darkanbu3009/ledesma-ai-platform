import { createHmac } from 'node:crypto';
import {
  actuaSobreElemento,
  dominiosClave,
  esCodigoDeIntencion,
  esDominioDePaso,
  esMarcadorParametro,
  esPublicable,
  marcadorDeRanura,
  marcadoresClave,
  marcadoresDePasosPublicables,
  nombreDeLaClase,
  parsearPasosPublicables,
  tienePasoDeVerificacion,
  type CodigoDeIntencion,
  type MarcadorParametro,
  type MotivoDeNoPublicable,
  type PasoDeReceta,
  type PasoPublicable,
} from '@ledesma-platform/shared';
import { claseDeElemento } from './atlas-sitios.js';
import { VERBOS_ACCION_BLOQUEADA, type AccionIrreversible } from './prompt-tarea-web.js';
import type { ValoresDeParametros } from './receta-web.js';

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
 * DOS MITADES, y la frontera entre ellas es la misma en los dos sentidos. La de ARRIBA produce la
 * plantilla que se publica; la de ABAJO (CONSUMO) decide si una plantilla AJENA se le puede ofrecer a
 * otro usuario y la convierte en pasos ejecutables. Las dos comparten `claseDeElemento`, el contrato
 * de `packages/shared` y la tabla de codigos de intencion: lo que una escribe es exactamente lo que
 * la otra sabe leer, y ninguna de las dos toca la base ni el navegador.
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

// --- CONSUMO -------------------------------------------------------------------------------------

/**
 * SIN CHECKPOINT DE APROBACION HUMANA, por decision de producto: el consentimiento vive en los
 * documentos legales que el usuario acepto al conectar sitios, y la proteccion en runtime es TECNICA
 * (las puertas de `plantillaAplicable`, la barrera de identidad en modo activa, la verificacion
 * determinista y el retiro automatico). Que estados son SERVIBLES lo resuelve la query
 * (`buscarServible`, apps/backend/src/plantillas-compartidas): 'retirada' no sale nunca. Una
 * plantilla servible que ademas pasa `plantillaAplicable` se ejecuta DIRECTO; la transparencia es
 * obligatoria y viaja en el resultado del job y en la tarjeta de /actividad.
 */

/** La CLAVE de tres columnas con la que un consumidor busca su plantilla. */
export interface IdentidadDePlantilla {
  dominiosClave: string;
  codigoDeIntencion: CodigoDeIntencion;
  /** El conjunto EXACTO que el objetivo del consumidor declara. Es lo que se busco, para el log. */
  marcadoresClave: string;
  /** Ese conjunto Y TODOS SUS SUBCONJUNTOS: las claves que una plantilla puede tener para aplicar. */
  marcadoresPosibles: string[];
}

/**
 * TOPE REAL de claves que un consumidor puede generar: los subconjuntos de un conjunto de SEIS, que
 * son los seis marcadores del contrato de recetas (`MARCADORES`, packages/shared). 2^6 = 64, y es una
 * cota del VOCABULARIO CERRADO, no un limite configurable: no hay objetivo, por raro que sea, que
 * produzca una lista mas larga.
 */
export const MAX_CLAVES_DE_MARCADORES = 64;

/**
 * LAS CLAVES DE MARCADORES que este consumidor puede consumir: la de su propio conjunto y la de
 * todos sus subconjuntos, cada una en el formato de la columna `marcadores_clave`.
 *
 * POR QUE EXISTE, y es la mitad del FIX de la CONTENCION: la relacion verdadera entre la plantilla y
 * el consumidor no es la igualdad sino la CONTENCION. La plantilla aplica si los marcadores QUE ELLA
 * EXIGE son un subconjunto de los que el consumidor declara; un dato de mas del consumidor (un
 * objetivo que ademas menciona un monto) no puede impedir que se encuentre. Comparando por igualdad,
 * `asunto+cuerpo+destinatario+monto` no casaba con `asunto+cuerpo+destinatario` aunque la plantilla
 * solo necesitara un subconjunto de lo que el consumidor traia.
 *
 * POR QUE ASI Y NO CON UN OPERADOR DE CONJUNTOS EN LA BASE: generando aqui los subconjuntos, la
 * consulta sigue siendo IGUALDAD sobre las mismas tres columnas del indice unico de V041 (un `in` es
 * igualdad contra una lista), asi que no hace falta migracion, ni columna nueva, ni un segundo indice.
 *
 * LO QUE NO CAMBIA: una plantilla que exige un marcador que el consumidor NO tiene sigue sin aplicar.
 * No esta entre estas claves, y si por algun camino llegara, `plantillaAplicable` la rechaza igual con
 * `dato_sin_declarar`.
 */
export function clavesDeMarcadoresContenidos(marcadores: readonly MarcadorParametro[]): string[] {
  // El filtro acota el largo de la lista a 2^6 pase lo que pase: el conjunto de entrada llega de un
  // `Object.keys` con un cast, y de esta funcion depende que la consulta no crezca sin techo.
  const unicos = [...new Set(marcadores)].filter(esMarcadorParametro).sort();
  let subconjuntos: MarcadorParametro[][] = [[]];
  for (const marcador of unicos) {
    subconjuntos = [...subconjuntos, ...subconjuntos.map((previo) => [...previo, marcador])];
  }
  return subconjuntos.map((subconjunto) => marcadoresClave(subconjunto)).sort();
}

/**
 * LA IDENTIDAD QUE ESTA TAREA BUSCARIA, calculada con lo que el consumidor ya tiene ANTES de mirar
 * ninguna fila: sus dominios autorizados, el verbo irreversible que la deteccion determinista saco de
 * su propio texto y los datos que su propio objetivo declara.
 *
 * ES UN WHERE DE TRES COLUMNAS Y NADA MAS, y esa es la decision de diseno completa: no hay modelo,
 * no hay texto libre en ninguno de los tres componentes (ocho codigos cerrados, seis marcadores
 * cerrados y los hostnames que el propio usuario conecto) y el unico orden que existe es el desempate
 * determinista de la consulta. Por eso el consumo no toca el prompt del elector ni su catalogo: una
 * plantilla no compite con las tareas propias, se busca por igualdad -- contra el conjunto declarado y
 * contra sus subconjuntos -- despues de que las dos vias propias no encontraron nada.
 *
 * Devuelve null -- y no hay busqueda -- cuando la tarea no pide ninguna accion irreversible (sin
 * codigo de intencion no hay plantilla que buscar: ver la cabecera) o cuando no hay dominios.
 */
export function identidadDeConsumo(entrada: {
  dominios: readonly string[];
  verboBloqueado: string | null;
  /** Marcadores que el objetivo del consumidor DECLARA (valoresDeParametros, receta-web.ts). */
  marcadores: readonly MarcadorParametro[];
}): IdentidadDePlantilla | null {
  const codigo = codigoDeIntencion(entrada.verboBloqueado);
  if (codigo === null) return null;
  const clave = dominiosClave(entrada.dominios);
  if (clave === '') return null;
  return {
    dominiosClave: clave,
    codigoDeIntencion: codigo,
    marcadoresClave: marcadoresClave(entrada.marcadores),
    marcadoresPosibles: clavesDeMarcadoresContenidos(entrada.marcadores),
  };
}

/**
 * POR QUE una plantilla ajena NO se le puede ofrecer a este consumidor. Conjunto CERRADO, cada motivo
 * rechaza la plantilla COMPLETA y en todos los casos la tarea sigue por el motor libre. Es el
 * vocabulario que viaja al campo de diagnostico del resultado del job, con el mismo criterio que
 * `VeredictoDePlantilla` (tarea-web.ts): ni un dato del usuario, del sitio ni de la tabla.
 */
export type MotivoDeNoAplicable =
  /** Los pasos de la fila no validan contra el contrato de plantillas. */
  | 'contrato_invalido'
  /** Un paso corre en un dominio que ESTA tarea no autorizo, o distinto del de la conexion. */
  | 'dominio_no_autorizado'
  /** Un paso que actua sobre un elemento declara una clase que el atlas no corroboro AQUI. */
  | 'clase_no_corroborada'
  /** La clase que el paso DECLARA no es la que producen sus propias estrategias. */
  | 'clase_no_coincide'
  /** Un dato que la plantilla teclea no esta declarado en el objetivo del consumidor. */
  | 'dato_sin_declarar'
  /** El objetivo pide una accion irreversible y la plantilla no trae su paso `verificar`. */
  | 'sin_verificacion'
  /**
   * BLINDAJE ESTRUCTURAL (sin checkpoint humano): la plantilla no tiene EXACTAMENTE un click de la
   * familia del verbo como ULTIMO paso, con `verificar` inmediatamente antes. Un click de la familia
   * de mas, un paso posterior al click final, o un `verificar` que no sea el paso previo, caen aqui.
   */
  | 'estructura_no_permitida';

export type ResultadoDeAplicabilidad =
  | { aplica: true; pasos: PasoDeReceta[]; marcadores: MarcadorParametro[] }
  | { aplica: false; motivo: MotivoDeNoAplicable; idx: number };

/** El marcador con el que se llena un paso de escritura de plantilla. null = el paso no dice cual. */
function marcadorDelPaso(valor: PasoPublicable['valor']): MarcadorParametro | null {
  if (valor === null) return null;
  return valor.tipo === 'parametro' ? valor.parametro : marcadorDeRanura(valor.clase);
}

/**
 * ¿La clase de este paso pertenece a la FAMILIA del verbo del objetivo? Es la MISMA pregunta que la
 * barrera de identidad le hace al nombre accesible del elemento (`correspondeALaFamilia`,
 * barrera-identidad.ts), aplicada aqui al NOMBRE que la clase declara: los regex de
 * VERBOS_ACCION_BLOQUEADA filtrados por familia, sobre un nombre que ya viene normalizado (minusculas,
 * sin acentos) porque asi lo construye `claseDeElemento`.
 *
 * ES LO UNICO QUE EL CONTRATO PERMITE DISTINGUIR HOY: un paso `click` no lleva ninguna marca de "soy
 * de foco" o "soy de accion", asi que el click IRREVERSIBLE se reconoce por su clase (la familia del
 * verbo) y todo click cuya clase NO es de la familia se trata como click de preparacion. El LIMITE,
 * documentado a proposito: un click de foco cuyo nombre accesible casara con la familia contaria como
 * click de accion (falla cerrada: la plantilla se rechaza), y un click irreversible de OTRA familia
 * ("crear filtro") no se distingue de uno de foco por estructura; a ese lo contienen la clase
 * corroborada del atlas del consumidor y la barrera de identidad, igual que hasta hoy.
 */
function claseDeLaFamiliaDelVerbo(clase: string | null, verboBloqueado: string | null): boolean {
  if (clase === null || verboBloqueado === null) return false;
  const familia = VERBOS_ACCION_BLOQUEADA.find((v) => v.verbo === verboBloqueado)?.accion;
  if (familia === undefined) return false;
  const nombre = nombreDeLaClase(clase);
  if (nombre === null) return false;
  return VERBOS_ACCION_BLOQUEADA.some((v) => v.accion === familia && v.patron.test(nombre));
}

/**
 * D1: EL BLINDAJE ESTRUCTURAL que sustituye al checkpoint humano. FALLA CERRADA, devuelve el `idx`
 * del paso que viola la regla (o -1 cuando falta la estructura entera):
 *
 *  a) La plantilla contiene EXACTAMENTE UN click cuya clase pertenece a la familia del verbo de la
 *     intencion (el click irreversible), y es el ULTIMO paso: cualquier click de la familia de mas, y
 *     cualquier paso POSTERIOR al click final, invalidan la plantilla.
 *  b) El paso `verificar` es el INMEDIATAMENTE ANTERIOR al click final (que exista lo exige ya
 *     `sin_verificacion`; aqui se exige DONDE).
 *
 * Devuelve null cuando la estructura es la permitida.
 */
function violacionDeEstructura(
  pasos: readonly PasoPublicable[],
  verboBloqueado: string | null,
): number | null {
  const deFamilia = pasos.filter(
    (paso) => paso.accion === 'click' && claseDeLaFamiliaDelVerbo(paso.claseDeElemento, verboBloqueado),
  );
  const final = deFamilia[0];
  // Sin click de la familia no hay click irreversible reconocible: la estructura no es la permitida.
  if (final === undefined) return -1;
  // Un SEGUNDO click de la familia invalida, y se nombra a el.
  if (deFamilia.length > 1) return deFamilia[1]?.idx ?? -1;
  // El click irreversible tiene que ser el ULTIMO paso: se nombra al primer paso posterior.
  const posterior = pasos[final.idx + 1];
  if (posterior !== undefined) return posterior.idx;
  // `verificar` inmediatamente antes del click final. Que exista en OTRO lugar no alcanza: entre la
  // comparacion contra la pagina y el click no puede colarse ningun otro paso.
  const previo = final.idx > 0 ? pasos[final.idx - 1] : undefined;
  if (previo === undefined || previo.accion !== 'verificar') return final.idx;
  return null;
}

/**
 * ¿SE PUEDE OFRECER esta plantilla ajena a ESTE consumidor, y con que pasos? TODO falla cerrado: ante
 * cualquiera de los seis motivos la plantilla NO aplica, la tarea sigue por el motor libre (que era la
 * linea base) y el motivo queda en el diagnostico. No hay ninguna rama que recorte, complete o adivine
 * para poder ejecutar igual.
 *
 * LAS CINCO PUERTAS, en este orden:
 *
 *  1. EL CONTRATO. `parsearPasosPublicables` es el MISMO parser que corre el repositorio antes del
 *     insert. Una fila manipulada en la base no llega al navegador de nadie.
 *  2. EL DOMINIO. Cada paso dice donde corre y ese dominio tiene que ser el de la conexion sobre la
 *     que se va a ejecutar. Una plantilla que nombre otro dominio -- aunque la tarea lo autorice -- no
 *     aplica en este cambio: el checkpoint guarda UNA sesion y el consumo multisitio necesita abrir
 *     una por sitio DESPUES de la decision humana, que es un mecanismo distinto.
 *  3. LA CLASE, en TODOS los pasos que tocan el DOM y no solo en el irreversible. Es la barrera de
 *     identidad adelantada al momento de decidir, y el motivo es el paso EXTRA INTERCALADO: un paso
 *     que crea un filtro de correo que reenvia todo a la direccion de un atacante es irreversible EN
 *     EFECTO y completamente invisible para VERBOS_ACCION_BLOQUEADA (no existe el verbo "filtrar" ni
 *     "reenviar siempre"), asi que no consume cupo, no dispara la verificacion determinista y el
 *     checkpoint que el usuario aprobo habla de otra cosa. Lo unico que lo contiene es exigir que cada
 *     paso apunte a un control que el atlas ya corroboro EN ESTE DOMINIO PARA ESTE CONSUMIDOR.
 *     Se comprueban DOS cosas y no una: que la clase este corroborada, y que la clase DECLARADA sea la
 *     que producen las propias estrategias del paso (`claseDeElemento`, la misma funcion del atlas).
 *     Sin lo segundo, una fila podria declarar una clase inocente y llevar estrategias que apuntan a
 *     otro control: la primera comprobacion pasaria y el paso actuaria sobre lo que nadie corroboro.
 *  4. LOS DATOS. Cada paso de escritura resuelve su marcador (el del parametro, o el de la ranura por
 *     su clase) y ese dato tiene que estar DECLARADO en el objetivo del consumidor. Un dato que falta
 *     no se completa ni se hereda: la plantilla no aplica.
 *  5. LA VERIFICACION. Misma exigencia que `recetaAplicable` (ejecutor-receta.ts) y por el mismo
 *     motivo: sin el paso `verificar`, ejecutar se saltaria la comparacion contra la pagina.
 *  6. LA ESTRUCTURA (D1, sin checkpoint humano). Exactamente UN click de la familia del verbo (el
 *     click irreversible), como ULTIMO paso y con `verificar` inmediatamente antes. Un click de la
 *     familia de mas, o cualquier paso despues del click final, rechazan con
 *     `estructura_no_permitida` (ver `violacionDeEstructura`).
 *
 * Lo que devuelve son PASOS DE RECETA, que es lo que el ejecutor determinista sabe correr: la ranura
 * se convierte en el marcador que la llena y la clase se queda fuera (la barrera la vuelve a derivar
 * de las estrategias en cada paso, que es la fuente que no se puede falsear).
 */
export function plantillaAplicable(entrada: {
  /** Los pasos CRUDOS tal como vuelven del jsonb. Se parsean aqui: la entrada no se presume valida. */
  pasos: unknown;
  /** Dominio de la conexion sobre la que se ejecutaria. */
  dominio: string;
  /** Datos que el objetivo del consumidor declara, ya resueltos a texto. */
  valores: ValoresDeParametros;
  /** Verbo irreversible del objetivo del consumidor. */
  verboBloqueado: string | null;
  /** Clases que el atlas tiene CORROBORADAS para ese dominio y para este origen. */
  clasesCorroboradas: ReadonlySet<string>;
}): ResultadoDeAplicabilidad {
  const pasos = parsearPasosPublicables(entrada.pasos);
  if (pasos === null) return { aplica: false, motivo: 'contrato_invalido', idx: -1 };

  const dominio = entrada.dominio.trim().toLowerCase();
  const marcadores = new Set<MarcadorParametro>();
  const deReceta: PasoDeReceta[] = [];

  for (const paso of pasos) {
    if (paso.dominio !== dominio) {
      return { aplica: false, motivo: 'dominio_no_autorizado', idx: paso.idx };
    }

    if (actuaSobreElemento(paso.accion)) {
      const declarada = paso.claseDeElemento;
      if (declarada === null || !entrada.clasesCorroboradas.has(declarada)) {
        return { aplica: false, motivo: 'clase_no_corroborada', idx: paso.idx };
      }
      // La MISMA `claseDeElemento` del atlas sobre las estrategias que la plantilla lleva: si no
      // reproduce la clase declarada, el paso esta hablando de un control y apuntando a otro.
      if (claseDeElemento(paso.accion, paso.estrategias) !== declarada) {
        return { aplica: false, motivo: 'clase_no_coincide', idx: paso.idx };
      }
    }

    let valor: PasoDeReceta['valor'] = null;
    if (paso.accion === 'escribir') {
      const marcador = marcadorDelPaso(paso.valor);
      // Una escritura sin marcador al que atarla no dice que teclear: el contrato ya lo rechaza, y
      // aqui se vuelve a mirar porque de esto depende que la plantilla no ejecute a medias.
      if (marcador === null) return { aplica: false, motivo: 'contrato_invalido', idx: paso.idx };
      const texto = entrada.valores[marcador];
      if (texto === undefined || texto === '') {
        return { aplica: false, motivo: 'dato_sin_declarar', idx: paso.idx };
      }
      marcadores.add(marcador);
      valor = { tipo: 'parametro', parametro: marcador };
    }

    deReceta.push({
      idx: deReceta.length,
      accion: paso.accion,
      dominio: paso.dominio,
      estrategias: [...paso.estrategias],
      valor,
      teclas: paso.teclas,
      // Una plantilla no lleva rutas (no existe la accion 'navegar' en su contrato): el paso jamas
      // puede sacar la sesion del usuario de su sitio.
      ruta: null,
      esperaMs: paso.esperaMs,
    });
  }

  if (entrada.verboBloqueado !== null && !tienePasoDeVerificacion(deReceta)) {
    return { aplica: false, motivo: 'sin_verificacion', idx: -1 };
  }
  // D1: EL BLINDAJE ESTRUCTURAL, la ultima puerta y la que sustituye al checkpoint humano: un solo
  // click de la familia del verbo, ultimo paso, con `verificar` pegado antes. Corre sobre los pasos
  // del CONTRATO (los parseados), que es donde vive la clase declarada.
  if (entrada.verboBloqueado !== null) {
    const violacion = violacionDeEstructura(pasos, entrada.verboBloqueado);
    if (violacion !== null) {
      return { aplica: false, motivo: 'estructura_no_permitida', idx: violacion };
    }
  }
  return { aplica: true, pasos: deReceta, marcadores: [...marcadores].sort() };
}

/**
 * MOTIVO LEGADO de `aprobaciones_web` (V027): el checkpoint con el que se le OFRECIA al usuario un
 * procedimiento que descubrio OTRA cuenta. El checkpoint de plantillas YA NO SE CREA (el consumo
 * ejecuta directo), pero el codigo de lectura se conserva para las filas que quedaron persistidas
 * antes del cambio: la consola y el correo de aprobaciones las siguen mostrando, y el gate de
 * reanudacion las detecta para NO tratarlas como un checkpoint clasico. Viaja como PREFIJO de
 * `descripcion` porque `accion_tipo` tiene un CHECK cerrado de dos valores; el precedente exacto es
 * INSTRUCCION_CANCELADA_POR_USUARIO (aprobaciones-repository.ts), que ya usa una columna de texto como
 * marca de maquina.
 *
 * NO TOCA NINGUN MOTIVO EXISTENTE: una aprobacion cuya descripcion no empieza con este prefijo se lee
 * y se decide exactamente como hasta hoy.
 */
export const MOTIVO_PLANTILLA_COMPARTIDA = 'plantilla_compartida';

/**
 * LO QUE SE LE MUESTRA AL USUARIO, en forma de CODIGO y no de frase. Los tres componentes son
 * vocabulario CERRADO de la plataforma (uno de los ocho codigos de intencion, un subconjunto de los
 * seis marcadores y un hostname que el propio usuario conecto): NI UN CARACTER sale de
 * `plantillas_compartidas`. La frase la redacta quien muestra -- la consola en el idioma del usuario,
 * el correo en espanol -- desde este codigo.
 *
 * Es la unica forma de que el texto del checkpoint no pueda ser un canal: en la tabla no hay un solo
 * texto libre, y aunque lo hubiera, por aqui no pasaria.
 */
export interface OfrecimientoDePlantilla {
  codigoDeIntencion: CodigoDeIntencion;
  marcadores: MarcadorParametro[];
  dominio: string;
}

export function descripcionDeOfrecimiento(ofrecimiento: OfrecimientoDePlantilla): string {
  return [
    MOTIVO_PLANTILLA_COMPARTIDA,
    ofrecimiento.codigoDeIntencion,
    marcadoresClave(ofrecimiento.marcadores),
    ofrecimiento.dominio,
  ].join(':');
}

/**
 * LEE la descripcion de una aprobacion y dice si es un ofrecimiento de plantilla. Devuelve null ante
 * cualquier otra cosa -- incluida una descripcion que empiece con el prefijo pero no valide entera --
 * y con eso la aprobacion vuelve a ser una aprobacion normal de las de siempre. Falla cerrada: un
 * codigo que no sea uno de los ocho, o un marcador que no sea uno de los seis, no se interpretan.
 */
export function parsearOfrecimiento(descripcion: string): OfrecimientoDePlantilla | null {
  const partes = descripcion.split(':');
  if (partes.length !== 4 || partes[0] !== MOTIVO_PLANTILLA_COMPARTIDA) return null;
  const codigo = partes[1] ?? '';
  if (!esCodigoDeIntencion(codigo)) return null;
  const crudos = (partes[2] ?? '').split('+').filter((marcador) => marcador !== '');
  if (!crudos.every(esMarcadorParametro)) return null;
  const dominio = (partes[3] ?? '').trim().toLowerCase();
  if (!esDominioDePaso(dominio)) return null;
  return { codigoDeIntencion: codigo, marcadores: crudos as MarcadorParametro[], dominio };
}

/**
 * TIPO DE ACCION del checkpoint (`aprobaciones_web.accion_tipo`, dos valores cerrados desde V027).
 * Es INFORMATIVO para el humano y no cambia ninguna garantia: los dos tipos exigen exactamente el
 * mismo checkpoint. Se deriva del codigo de intencion con el mismo criterio que PISTAS_FINANCIERAS
 * (aprobaciones.ts), que ya cuenta la suscripcion como dinero.
 */
const INTENCIONES_FINANCIERAS: ReadonlySet<CodigoDeIntencion> = new Set<CodigoDeIntencion>([
  'pagar',
  'transferir',
  'comprar',
  'cancelarSuscripcion',
]);

export function accionTipoDeIntencion(codigo: CodigoDeIntencion): 'irreversible' | 'financiera' {
  return INTENCIONES_FINANCIERAS.has(codigo) ? 'financiera' : 'irreversible';
}

/** Como se nombra en espanol cada codigo de intencion. Tabla cerrada: no hay texto de nadie aqui. */
const ACCION_EN_ESPANOL: Readonly<Record<CodigoDeIntencion, string>> = {
  enviar: 'enviar algo',
  publicar: 'publicar algo',
  borrar: 'borrar algo',
  pagar: 'hacer un pago',
  transferir: 'hacer una transferencia',
  comprar: 'hacer una compra',
  firmar: 'firmar algo',
  cancelarSuscripcion: 'cancelar una suscripcion',
};

/** Como se nombra en espanol cada dato. Tabla cerrada, los seis marcadores del contrato. */
const DATO_EN_ESPANOL: Readonly<Record<MarcadorParametro, string>> = {
  destinatario: 'destinatario',
  monto: 'monto',
  producto: 'producto',
  cantidad: 'cantidad',
  asunto: 'asunto',
  cuerpo: 'cuerpo',
};

/**
 * LA FRASE EN ESPANOL del ofrecimiento, para el correo (el unico canal del worker, que no conoce el
 * idioma del usuario; la consola arma la suya con sus propias claves de i18n). Se REDACTA aqui, desde
 * el codigo: no se muestra ni se reenvia nada de la tabla.
 *
 * Dice explicitamente que pasa si se rechaza, porque es lo que evita el malentendido caro: rechazar
 * NO cancela la tarea, descarta el procedimiento ajeno y la tarea sigue como siempre.
 */
export function textoDelOfrecimientoEs(ofrecimiento: OfrecimientoDePlantilla): string {
  const datos = ofrecimiento.marcadores.map((marcador) => DATO_EN_ESPANOL[marcador]).join(', ');
  const conDatos = datos === '' ? '' : `, con tus datos (${datos})`;
  return (
    `Usar en ${ofrecimiento.dominio} un procedimiento para ${ACCION_EN_ESPANOL[ofrecimiento.codigoDeIntencion]} ` +
    `que descubrio otra cuenta${conDatos}. Nada de la otra cuenta viaja contigo. ` +
    'Si lo rechazas, tu agente hace la tarea por su cuenta, como siempre.'
  );
}
