import {
  MAX_PASOS_RECETA,
  marcadoresDeParametros,
  ordenarEstrategias,
  parsearRuta,
  tienePasoDeVerificacion,
  type EstrategiaLocalizacion,
  type MarcadorParametro,
  type PasoDeReceta,
  type ValorDePaso,
} from '@ledesma-platform/shared';
import { VALOR_CENSURADO } from './censura.js';
import { estrategiasIndependientesDelValor } from './localizacion.js';
import { claveDeEstrategia } from './promocion-estrategias.js';
import { TOOL_CAMBIAR_DE_SITIO } from './prompt-tarea-web.js';
import {
  extraerMontos,
  extraerParametrosDeclarados,
  normalizarTexto,
  type ParametrosDeclarados,
} from './parametros-objetivo.js';
import type { PasoCensurado } from './trayectoria.js';

/**
 * RECETAS DE TAREA WEB (Fase F, paso 2), parte PURA: la FIRMA que identifica a que objetivo pertenece
 * una receta (D3), la PROMOCION de una trayectoria exitosa a pasos re-ejecutables (D4) y la
 * SUSTITUCION de los parametros concretos antes de ejecutar (D7/D8).
 *
 * NO es la tabla `recipes` de V013 (cadenas de instrucciones de texto para un agente conversacional).
 * Ver la cabecera de packages/shared/src/recetas/contrato.ts.
 *
 * Modulo PURO (sin motor, sin navegador, sin base) para testearlo con trayectorias sinteticas, mismo
 * criterio que trayectoria.ts, censura.ts y verificacion.ts.
 */

/**
 * MARCADOR con el que la firma sustituye a un parametro concreto. Los corchetes angulares no aparecen
 * en un objetivo normalizado (la normalizacion borra la puntuacion), asi que no puede haber colision
 * entre un marcador y texto que el usuario escribio.
 */
function marcador(parametro: MarcadorParametro): string {
  return `<${parametro}>`;
}

/** Puntuacion que la firma descarta: no cambia lo que se pide, solo como se escribio. */
const PUNTUACION = /[.,;:!?"'`()[\]{}<>|/\\*_~#$%^&+=@-]+/g;

/**
 * FIRMA DE UN OBJETIVO (D3): el objetivo normalizado (minusculas, sin acentos, sin puntuacion, con
 * los espacios colapsados) y con los PARAMETROS CONCRETOS sustituidos por marcadores.
 *
 * Es lo que hace que "envia un correo a martin@x.com con asunto Hola" y "envia un correo a
 * ana@y.com con asunto Adios" compartan receta: los dos firman
 * "envia un correo a <destinatario> con asunto <producto>".
 *
 * Reusa el EXTRACTOR DETERMINISTA del PR anterior (parametros-objetivo.ts) a proposito: si la firma
 * usara otro criterio que la verificacion para decidir que es un parametro, se podria promover una
 * receta bajo una firma y ejecutarla sustituyendo otra cosa. Un solo extractor, un solo vocabulario.
 *
 * Los parametros se sustituyen del MAS LARGO al mas corto para que un valor contenido dentro de otro
 * (el "2400" de "2400 MXN") no rompa el reemplazo del que lo contiene.
 */
/**
 * SUFIJO de la firma con el CONJUNTO DE DOMINIOS de la tarea. Ordenado y deduplicado para que el
 * conjunto {tienda, correo} firme igual sin importar por cual se empezo.
 *
 * Vacio con CERO O UN dominio, a proposito: la firma de una tarea de un solo sitio queda EXACTAMENTE
 * como antes de este cambio, asi que lo que el usuario ya tenia aprendido sigue sirviendo. Y no hay
 * colision posible: una tarea de un sitio jamas lleva sufijo y una de dos siempre lo lleva, asi que
 * "envia el correo" en un sitio y "envia el correo" cruzando dos sitios NO comparten receta.
 */
function sufijoDeDominios(dominios: readonly string[]): string {
  const unicos = [...new Set(dominios.map((dominio) => dominio.toLowerCase()))].sort();
  return unicos.length > 1 ? ` @${unicos.join('+')}` : '';
}

export function firmaDeObjetivo(objetivo: string, dominios: readonly string[] = []): string {
  const parametros = extraerParametrosDeclarados(objetivo);
  const sustituciones: Array<{ texto: string; marcador: string }> = [];
  for (const destinatario of parametros.destinatarios) {
    sustituciones.push({ texto: destinatario, marcador: marcador('destinatario') });
  }
  if (parametros.monto !== null) {
    sustituciones.push({ texto: parametros.monto.texto, marcador: marcador('monto') });
  }
  if (parametros.producto !== null) {
    sustituciones.push({ texto: parametros.producto, marcador: marcador('producto') });
  }
  if (parametros.cantidad !== null) {
    sustituciones.push({ texto: String(parametros.cantidad), marcador: marcador('cantidad') });
  }
  if (parametros.asunto !== null) {
    sustituciones.push({ texto: parametros.asunto, marcador: marcador('asunto') });
  }
  if (parametros.cuerpo !== null) {
    sustituciones.push({ texto: parametros.cuerpo, marcador: marcador('cuerpo') });
  }

  let firma = normalizarTexto(objetivo);
  for (const { texto, marcador: reemplazo } of [...sustituciones].sort(
    (a, b) => b.texto.length - a.texto.length,
  )) {
    const normalizado = normalizarTexto(texto);
    if (normalizado === '') continue;
    firma = firma.split(normalizado).join(reemplazo);
  }
  // La puntuacion se retira DESPUES de sustituir (los correos y los montos la llevan dentro) y los
  // marcadores se vuelven a poner porque sus corchetes tambien son puntuacion.
  firma = firma.replace(PUNTUACION, ' ');
  for (const { marcador: reemplazo } of sustituciones) {
    const desnudo = reemplazo.slice(1, -1);
    firma = firma.split(` ${desnudo} `).join(` ${reemplazo} `);
  }
  return `${firma.replace(/\s+/g, ' ').trim()}${sufijoDeDominios(dominios)}`;
}

/**
 * PARAMETROS DE UNA CORRIDA, ya resueltos a texto: lo que la receta teclea en cada paso de escritura.
 * Un parametro que el objetivo de ESTA corrida no declaro queda ausente y la receta NO se puede
 * ejecutar (ver `sustituirParametros`): tecleariamos un dato de otra tarea.
 */
export type ValoresDeParametros = Partial<Record<MarcadorParametro, string>>;

/** Los parametros declarados, como texto listo para teclear. */
export function valoresDeParametros(parametros: ParametrosDeclarados): ValoresDeParametros {
  const valores: ValoresDeParametros = {};
  // Un solo destinatario es el caso que una receta sabe repetir: con varios, cada uno va a un campo
  // distinto y la receta aprendida sobre uno no dice a cual. Se deja ausente (la receta no aplica).
  const destinatario = parametros.destinatarios.length === 1 ? parametros.destinatarios[0] : undefined;
  if (destinatario !== undefined) valores.destinatario = destinatario;
  if (parametros.monto !== null) valores.monto = parametros.monto.texto;
  if (parametros.producto !== null) valores.producto = parametros.producto;
  if (parametros.cantidad !== null) valores.cantidad = String(parametros.cantidad);
  if (parametros.asunto !== null) valores.asunto = parametros.asunto;
  if (parametros.cuerpo !== null) valores.cuerpo = parametros.cuerpo;
  return valores;
}

/**
 * LOS MISMOS PARAMETROS, en la forma que consume la VERIFICACION DETERMINISTA (CAMBIO 3). Cuando los
 * datos de la corrida no salieron del extractor sino de la eleccion entre tareas ya ensenadas, tienen
 * que pasar por la MISMA comparacion contra la pagina que cualquier otra corrida: para eso hay que
 * devolverlos a la forma que `verificarAccion` espera.
 *
 * FALLA CERRADA: devuelve null si un valor no se puede interpretar como lo que dice ser (un monto que
 * no es un monto, una cantidad que no es un entero positivo). Sin poder comparar ese dato, la tarea no
 * se ejecuta por este camino y corre con el motor, que verifica igual.
 *
 * Los valores ya vienen anclados al texto del usuario (`valorAncladoAlTexto`, eleccion-tarea.ts): esta
 * funcion NO es la que decide si son legitimos, solo los traduce.
 */
export function parametrosDeclaradosDesdeValores(
  valores: ValoresDeParametros,
): ParametrosDeclarados | null {
  const montos = valores.monto === undefined ? [] : extraerMontos(valores.monto);
  const monto = montos.length === 1 ? (montos[0] ?? null) : null;
  if (valores.monto !== undefined && monto === null) return null;

  let cantidad: number | null = null;
  if (valores.cantidad !== undefined) {
    const numero = Number(valores.cantidad.trim());
    if (!Number.isInteger(numero) || numero <= 0) return null;
    cantidad = numero;
  }

  return {
    destinatarios: valores.destinatario === undefined ? [] : [valores.destinatario.toLowerCase()],
    monto,
    producto: valores.producto ?? null,
    cantidad,
    asunto: valores.asunto ?? null,
    cuerpo: valores.cuerpo ?? null,
  };
}

/** Un paso listo para ejecutar: el paso de la receta con su valor ya resuelto a texto. */
export interface PasoSustituido {
  paso: PasoDeReceta;
  /** Texto a teclear en un paso 'escribir'. null en el resto de las acciones. */
  texto: string | null;
}

/**
 * SUSTITUYE los parametros de la corrida en los pasos de la receta (D7). Devuelve null si ALGUN paso
 * de escritura referencia un parametro que el objetivo de esta corrida no declaro: ejecutar la receta
 * a medias, o con el valor de otra tarea, seria hacer algo distinto a lo pedido. Falla cerrada: el
 * llamador cae al camino normal con el motor.
 */
export function sustituirParametros(
  pasos: PasoDeReceta[],
  valores: ValoresDeParametros,
): PasoSustituido[] | null {
  const sustituidos: PasoSustituido[] = [];
  for (const paso of pasos) {
    if (paso.accion !== 'escribir') {
      sustituidos.push({ paso, texto: null });
      continue;
    }
    const valor = paso.valor;
    if (valor === null) return null;
    if (valor.tipo === 'literal') {
      sustituidos.push({ paso, texto: valor.texto });
      continue;
    }
    const texto = valores[valor.parametro];
    if (texto === undefined || texto === '') return null;
    sustituidos.push({ paso, texto });
  }
  return sustituidos;
}

/**
 * Metodos de Playwright (los que registra la traza del motor) mapeados a la accion determinista que
 * los repite. Lo que no esta aqui NO se promueve: `select` de un combo nativo, arrastres y demas
 * necesitan primitivas que este ejecutor no tiene, y prometer que los repite seria mentir.
 */
const ACCION_POR_METODO: Readonly<Record<string, 'click' | 'escribir'>> = {
  click: 'click',
  dblclick: 'click',
  check: 'click',
  uncheck: 'click',
  tap: 'click',
  fill: 'escribir',
  type: 'escribir',
  setValue: 'escribir',
};

/**
 * Tipos de accion de la traza que NO cambian la pagina: se saltan al promover, no la invalidan.
 *
 * El CAMBIO DE SITIO entra aqui a proposito: no es un paso que haya que repetir, es un cambio de
 * tramo. Lo que la receta guarda de el es el `dominio` de cada paso; el ejecutor cambia de sesion
 * cuando el dominio del paso siguiente es otro. Promoverlo como paso ademas duplicaria la
 * informacion y abriria la puerta a una receta con un cambio de sitio "suelto".
 */
const TIPOS_SIN_EFECTO = new Set([
  'extract',
  'ariatree',
  'ariaTree',
  'screenshot',
  'think',
  'done',
  'search',
  'navback',
  'scroll',
  TOOL_CAMBIAR_DE_SITIO,
]);

/**
 * Tools de LLENADO DE FORMULARIO de Stagehand: 'fillForm' (resuelve cada campo con selector) y
 * 'fillFormVision' (variante por vision, sin ningun selector). Su accion de CABECERA no actua sobre
 * un elemento concreto, y el registro no conserva que campos lleno ni con que valores (la whitelist
 * de trayectoria.ts no copia `fields`). Los campos que SI quedaron registrados con localizacion
 * llegan como acciones ADYACENTES (los act sinteticos de fillForm, o los act con los que el motor
 * completo los mismos campos despues), y ESAS son las que se promueven a pasos 'escribir'.
 *
 * La cabecera, por tanto, se DESCARTA, pero de forma CONDICIONADA (caso real de produccion, jul
 * 2026: un fillFormVision en el paso 4 abortaba la conversion entera con "sin ninguna estrategia de
 * localizacion" aunque los tres datos del objetivo quedaban cubiertos por acts posteriores con
 * selector): la promocion solo la omite si TODOS los datos declarados del objetivo terminan
 * cubiertos por algun paso de escritura de la receta. Si un dato quedaria sin cubrir, la conversion
 * falla con motivo especifico (ver promoverTrayectoria) en vez de producir una receta que hace
 * menos de lo aprendido.
 */
const TIPOS_LLENADO_DE_FORMULARIO = new Set(['fillForm', 'fillFormVision']);

/**
 * Tipo del paso SINTETICO que deja la verificacion determinista en la traza
 * (construirPasoDeVerificacion, verificacion.ts). Se promueve como paso 'verificar': marca el punto
 * exacto del flujo donde el sistema comparo antes de ejecutar la accion irreversible (D7).
 */
const TIPO_VERIFICACION = 'verificacion';

/** ¿El texto de este argumento es un valor que la censura ya marco como sensible? */
function esCensurado(texto: string): boolean {
  return texto.includes(VALOR_CENSURADO);
}

/** Los valores CONCRETOS de esta corrida, que no pueden quedar dentro de ninguna localizacion. */
function valoresConcretos(valores: ValoresDeParametros): string[] {
  return Object.values(valores).filter((valor): valor is string => valor !== undefined);
}

/**
 * A que MARCADOR corresponde un valor tecleado, comparandolo contra los parametros que el objetivo
 * declaro. Devuelve null si no corresponde a ninguno: ese paso guardara un literal (si el valor no es
 * sensible) o no se promovera (si lo es).
 */
function marcadorDelValor(valor: string, valores: ValoresDeParametros): MarcadorParametro | null {
  const normalizado = normalizarTexto(valor);
  if (normalizado === '') return null;
  for (const parametro of [
    'destinatario',
    'monto',
    'producto',
    'cantidad',
    'asunto',
    'cuerpo',
  ] as const) {
    const declarado = valores[parametro];
    if (declarado !== undefined && normalizarTexto(declarado) === normalizado) return parametro;
  }
  return null;
}

/** El valor que un paso de escritura guarda: marcador si corresponde a un parametro, si no literal. */
function valorDePaso(texto: string, valores: ValoresDeParametros): ValorDePaso | null {
  const parametro = marcadorDelValor(texto, valores);
  if (parametro !== null) return { tipo: 'parametro', parametro };
  // D8: un valor que la censura marco como sensible JAMAS se guarda como literal. Sin marcador al
  // que atarlo, el paso no es promovible y la receta entera se descarta.
  if (esCensurado(texto)) return null;
  return { tipo: 'literal', texto };
}

/**
 * Un paso de la trayectoria como paso de receta, o null si NO es re-ejecutable. `null` con
 * `omitible: true` significa "este paso no hace falta para repetir la tarea" (una lectura, un
 * screenshot); con `omitible: false`, "esta tarea no se puede repetir sin el modelo".
 */
type Conversion =
  | { promovido: PasoDeReceta }
  | { omitible: true; exigeCobertura?: boolean }
  | { omitible: false; motivo: string };

/** Ruta relativa de una URL de la traza, si pertenece al dominio de la receta. */
function rutaDelPaso(url: string | null, dominio: string): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== dominio.toLowerCase()) return null;
    return parsearRuta(parsed.pathname === '' ? '/' : parsed.pathname);
  } catch {
    return null;
  }
}

function convertirPaso(
  paso: PasoCensurado,
  dominioDeLaReceta: string,
  valores: ValoresDeParametros,
  idx: number,
): Conversion {
  const tipo = paso.accion.tipo;
  if (TIPOS_SIN_EFECTO.has(tipo)) return { omitible: true };

  // SITIO del paso (multisitio): el que el handler estampo al cerrar el tramo. Se guarda SOLO cuando
  // difiere del dominio de la receta, para que una receta de un solo sitio quede identica a las que
  // ya existen (dominio null en todos sus pasos).
  const dominioDelPaso = paso.dominio ?? dominioDeLaReceta;
  const base = {
    idx,
    dominio: dominioDelPaso === dominioDeLaReceta ? null : dominioDelPaso,
    valor: null,
    teclas: null,
    ruta: null,
    esperaMs: null,
  } as const;

  // El paso sintetico de la verificacion determinista se promueve como tal: la receta aprende DONDE
  // hay que volver a comparar antes de ejecutar la accion irreversible (D7).
  if (tipo === TIPO_VERIFICACION) {
    return { promovido: { ...base, accion: 'verificar', estrategias: [] } };
  }

  if (tipo === 'goto' || tipo === 'navigate') {
    const ruta = rutaDelPaso(paso.url, dominioDelPaso);
    // Una navegacion fuera del dominio DEL PASO no se promueve NUNCA: una receta solo sabe operar
    // dentro de los sitios que el usuario conecto y que la tarea autorizo.
    if (ruta === null) return { omitible: false, motivo: 'navegacion fuera del dominio' };
    return { promovido: { ...base, accion: 'navegar', estrategias: [], ruta } };
  }

  if (tipo === 'keys') {
    const teclas = paso.accion.argumentos[0];
    if (teclas === undefined) return { omitible: false, motivo: 'pulsacion sin teclas registradas' };
    return { promovido: { ...base, accion: 'teclas', estrategias: [], teclas } };
  }

  // El resto exige un elemento: sin estrategias de localizacion no hay forma de repetirlo (D4). Las
  // que DEPENDEN de un dato concreto de esta corrida se descartan antes de contarlas: localizar por
  // el valor tecleado no sirve con otro valor, y ademas dejaria ese dato persistido dentro de la
  // localizacion, que es exactamente lo que un paso parametrizado no puede hacer (D8).
  const estrategias = estrategiasIndependientesDelValor(
    ordenarEstrategias(paso.estrategias ?? []),
    valoresConcretos(valores),
  );

  // LLENADO DE FORMULARIO (fillForm / fillFormVision): si este registro trae la escritura de UN
  // campo localizable (estrategias, metodo de tecleo y valor), se DESCOMPONE como un paso 'escribir'
  // normal. Si no trae nada de eso (el caso persistido: cabecera sin selector, sin metodo y sin
  // argumentos), se descarta de forma CONDICIONADA: la promocion verifica al final que los datos del
  // objetivo quedaron cubiertos por otros pasos (ver TIPOS_LLENADO_DE_FORMULARIO).
  if (TIPOS_LLENADO_DE_FORMULARIO.has(tipo)) {
    const accionDeCampo =
      paso.accion.metodo === null ? undefined : ACCION_POR_METODO[paso.accion.metodo];
    const texto = paso.accion.argumentos.join(' ').trim();
    if (estrategias.length > 0 && accionDeCampo === 'escribir' && texto !== '') {
      const valor = valorDePaso(texto, valores);
      if (valor === null) {
        return { omitible: false, motivo: 'escritura de un valor sensible sin parametro al que atarlo' };
      }
      return { promovido: { ...base, accion: 'escribir', estrategias, valor } };
    }
    return { omitible: true, exigeCobertura: true };
  }

  if (estrategias.length === 0) {
    return { omitible: false, motivo: `paso ${tipo} sin ninguna estrategia de localizacion` };
  }

  const accion = paso.accion.metodo === null ? undefined : ACCION_POR_METODO[paso.accion.metodo];
  if (accion === undefined) {
    return { omitible: false, motivo: `metodo no re-ejecutable: ${paso.accion.metodo ?? 'ninguno'}` };
  }
  if (accion === 'click') {
    return { promovido: { ...base, accion: 'click', estrategias } };
  }

  const texto = paso.accion.argumentos.join(' ').trim();
  if (texto === '') return { omitible: false, motivo: 'escritura sin valor registrado' };
  const valor = valorDePaso(texto, valores);
  if (valor === null) {
    return { omitible: false, motivo: 'escritura de un valor sensible sin parametro al que atarlo' };
  }
  return { promovido: { ...base, accion: 'escribir', estrategias, valor } };
}

/** Por que una trayectoria NO se promovio (diagnostico interno; nunca se le muestra al usuario). */
export interface PromocionRechazada {
  promovida: false;
  motivo: string;
}

export interface PromocionAceptada {
  promovida: true;
  pasos: PasoDeReceta[];
}

export type ResultadoDePromocion = PromocionAceptada | PromocionRechazada;

/**
 * PROMUEVE una trayectoria a los pasos de una receta (D4). Solo se promueve si TODOS los pasos con
 * efecto sobre la pagina son re-ejecutables y tienen al menos una estrategia de localizacion valida;
 * un solo paso que no lo sea descarta la trayectoria entera (una receta a la que le falta un paso
 * hace una tarea distinta de la aprendida).
 *
 * Los pasos que el motor ejecuto para MIRAR (extract, ariaTree, screenshot, think, done) se omiten:
 * existian para informar al modelo, que en la ejecucion determinista no participa.
 */
export function promoverTrayectoria(entrada: {
  pasos: PasoCensurado[];
  dominio: string;
  objetivo: string;
  /** Desenlace de la trayectoria: solo 'exitosa' promueve (D4). */
  estado: string;
  /**
   * El objetivo contiene un verbo de accion bloqueada, asi que la receta DEBE traer su paso
   * `verificar`. Sin el, la receta se ejecutaria sin comparar nada antes de la accion irreversible;
   * mejor no tenerla (la tarea corre por el camino normal, que si verifica).
   */
  exigeVerificacion: boolean;
}): ResultadoDePromocion {
  if (entrada.estado !== 'exitosa') {
    return { promovida: false, motivo: `la trayectoria termino ${entrada.estado}` };
  }
  const valores = valoresDeParametros(extraerParametrosDeclarados(entrada.objetivo));
  const pasos: PasoDeReceta[] = [];
  const llenadosSinRegistro: string[] = [];
  for (const paso of entrada.pasos) {
    if (paso.exito === false) {
      return { promovida: false, motivo: 'la trayectoria contiene un paso fallido' };
    }
    const conversion = convertirPaso(paso, entrada.dominio, valores, pasos.length);
    if ('promovido' in conversion) {
      pasos.push(conversion.promovido);
      continue;
    }
    if (!conversion.omitible) return { promovida: false, motivo: conversion.motivo };
    if (conversion.exigeCobertura === true) llenadosSinRegistro.push(paso.accion.tipo);
  }
  // COBERTURA de un llenado de formulario sin registro de campos (TIPOS_LLENADO_DE_FORMULARIO): la
  // cabecera descartada solo es inocua si cada dato que el objetivo declara termina tecleado por
  // algun paso 'escribir' de la receta. Sin datos declarados no hay contra que verificar, asi que
  // tampoco se puede afirmar que la receta repita lo aprendido: se rechaza con motivo especifico.
  if (llenadosSinRegistro.length > 0) {
    const tipoDeLlenado = llenadosSinRegistro[0] ?? 'fillForm';
    const declarados = Object.keys(valores) as MarcadorParametro[];
    if (declarados.length === 0) {
      return {
        promovida: false,
        motivo: `paso ${tipoDeLlenado} de llenado sin campos registrados y el objetivo no declara datos con los que verificar la cobertura`,
      };
    }
    const cubiertos = new Set(marcadoresDeParametros(pasos));
    const faltantes = declarados.filter((parametro) => !cubiertos.has(parametro));
    if (faltantes.length > 0) {
      return {
        promovida: false,
        motivo: `paso ${tipoDeLlenado} de llenado sin campos registrados: ${faltantes.join(', ')} sin ningun otro paso que lo cubra`,
      };
    }
  }
  if (pasos.length === 0) {
    return { promovida: false, motivo: 'la trayectoria no dejo ningun paso re-ejecutable' };
  }
  if (pasos.length > MAX_PASOS_RECETA) {
    return { promovida: false, motivo: 'la trayectoria excede el tope de pasos de una receta' };
  }
  if (entrada.exigeVerificacion && !tienePasoDeVerificacion(pasos)) {
    return {
      promovida: false,
      motivo: 'el objetivo pide una accion irreversible y la trayectoria no dejo constancia de la verificacion',
    };
  }
  return { promovida: true, pasos };
}

/**
 * Reemplaza las estrategias del paso `idx` por las que devolvio la escalada (AUTO REPARACION, D5).
 * Devuelve una copia: los pasos de la receta en memoria no se mutan a mitad de una corrida.
 *
 * `tecleado` es el texto que ESE paso acaba de escribir en la pagina, cuando es un paso de escritura.
 * Se descartan las estrategias que dependan de el: las nuevas se leen del DOM DESPUES de escribir, o
 * sea con el campo ya lleno, asi que el dato concreto de esta corrida aparece dentro de ellas. Sin
 * este filtro, reparar una receta le guardaria el valor del usuario en la localizacion -- y ademas la
 * dejaria localizando por un dato que la proxima corrida no va a tener.
 *
 * LA PRIMARIA VIGENTE SE RESPETA (auto reparacion, V038): si la lista fresca trae una estrategia con
 * la MISMA CLAVE que la primaria actual del paso, esa queda de primaria aunque el orden canonico
 * dijera otra cosa. Sin esto, cada corrida exitosa desharia una promocion (el reemplazo canonico
 * volveria a poner de primaria el atributo dinamico que la promocion acababa de bajar) y la receta
 * oscilaria entre mejorar y romperse.
 */
export function repararEstrategias(
  pasos: PasoDeReceta[],
  idx: number,
  estrategias: EstrategiaLocalizacion[],
  tecleado: string | null = null,
): PasoDeReceta[] {
  const limpias = ordenarEstrategias(
    estrategiasIndependientesDelValor(estrategias, tecleado === null ? [] : [tecleado]),
  );
  // Sin ninguna estrategia utilizable no hay reparacion posible: se conserva la que la receta tenia.
  if (limpias.length === 0) return pasos;
  return pasos.map((paso) => {
    if (paso.idx !== idx) return paso;
    return { ...paso, estrategias: conLaPrimariaVigentePrimero(paso.estrategias, limpias) };
  });
}

/** La lista fresca, con la estrategia que comparte clave con la primaria vigente puesta primero. */
function conLaPrimariaVigentePrimero(
  actuales: EstrategiaLocalizacion[],
  frescas: EstrategiaLocalizacion[],
): EstrategiaLocalizacion[] {
  const primaria = actuales[0];
  if (primaria === undefined) return frescas;
  const clave = claveDeEstrategia(primaria);
  const indice = frescas.findIndex((estrategia) => claveDeEstrategia(estrategia) === clave);
  if (indice <= 0) return frescas;
  const elegida = frescas[indice];
  if (elegida === undefined) return frescas;
  return [elegida, ...frescas.filter((_, i) => i !== indice)];
}

/**
 * D6: ¿mas de la MITAD de los pasos requirio escalada? Se compara contra el total de pasos de la
 * receta (no contra los ejecutados): una receta que se rompio en el paso 2 de 10 y escalo los dos no
 * es una receta obsoleta, es una corrida que fallo pronto.
 */
export function superaElLimiteDeEscaladas(escalados: number, totalDePasos: number): boolean {
  return totalDePasos > 0 && escalados * 2 > totalDePasos;
}
