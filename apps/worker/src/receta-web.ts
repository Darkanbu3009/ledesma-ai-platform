import {
  MAX_ESTRATEGIAS_POR_PASO,
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
import { describenElMismoCampo } from './percepcion.js';
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
 * TOKEN INTERMEDIO que marca la POSICION de un valor mientras la firma todavia tiene puntuacion por
 * retirar. Solo letras y digitos: sobrevive al barrido de PUNTUACION intacto, asi que el marcador
 * definitivo se pone al final por su token y NUNCA hay que reconocerlo por su nombre.
 *
 * POR QUE EXISTE (bug real de produccion, receta ad0731c8): la firma insertaba `<asunto>` ANTES de
 * retirar la puntuacion, los corchetes se iban con ella (son puntuacion) y despues se reponian
 * buscando la palabra desnuda rodeada de espacios. Esa busqueda no distingue el VALOR sustituido de
 * la palabra con la que el usuario NOMBRA el campo, y ademas la sustitucion dejaba dobles espacios
 * al comerse las comillas, asi que cada dato producia DOS marcadores: "con el asunto X" firmaba
 * "con el <asunto> <asunto>" y "el siguiente cuerpo del mensaje Y" firmaba "el siguiente <cuerpo>
 * del mensaje <cuerpo>". La firma quedaba sin la palabra del rotulo y con un marcador de mas.
 */
function tokenDeValor(indice: number): string {
  return `zz${indice}valorzz`;
}

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
  // Cada valor deja UN token sin puntuacion en SU posicion. Un valor que no aparece en el texto
  // normalizado no deja token, y por tanto tampoco deja marcador: la firma solo marca lo que hay.
  const tokens: Array<{ token: string; marcador: string }> = [];
  for (const { texto, marcador: reemplazo } of [...sustituciones].sort(
    (a, b) => b.texto.length - a.texto.length,
  )) {
    const normalizado = normalizarTexto(texto);
    if (normalizado === '' || !firma.includes(normalizado)) continue;
    const token = tokenDeValor(tokens.length);
    tokens.push({ token, marcador: reemplazo });
    firma = firma.split(normalizado).join(` ${token} `);
  }
  // La puntuacion se retira DESPUES de sustituir (los correos y los montos la llevan dentro). Los
  // tokens la atraviesan enteros y recien entonces se cambian por su marcador: la palabra con la que
  // el objetivo nombra al campo ("asunto", "cuerpo") queda como texto y jamas se convierte en uno.
  firma = firma.replace(PUNTUACION, ' ');
  for (const { token, marcador: reemplazo } of tokens) {
    firma = firma.split(token).join(reemplazo);
  }
  return `${firma.replace(/\s+/g, ' ').trim()}${sufijoDeDominios(dominios)}`;
}

/**
 * DESCRIPCION GENERALIZADA de una tarea aprendida (FIX seleccion, 28 jul 2026): el objetivo de la
 * corrida origen con los VALORES que se parametrizaron sustituidos por sus nombres de parametro
 * ("envia un correo a <destinatario> con asunto <asunto>"). Es lo que se persiste como `descripcion`
 * (V037) al promover una trayectoria, y lo que el selector de tareas (eleccion-tarea.ts) le muestra
 * al modelo.
 *
 * POR QUE, medido en produccion (28 jul 2026): la descripcion se guardaba con los valores LITERALES
 * de la corrida origen (asunto "Trayectoria fresca" y su cuerpo completo). Al pedir despues el mismo
 * tipo de correo con datos distintos, el modelo selector comparo la peticion nueva contra esa
 * descripcion hiperespecifica, la descarto, y la tarea corrio entera por el motor libre. Con los
 * valores sustituidos, la descripcion dice QUE hace la tarea y no CON QUE datos se aprendio.
 *
 * El MISMO extractor determinista de la firma decide que es un valor (un solo vocabulario); a
 * diferencia de la firma, aqui se conservan mayusculas y puntuacion: es un texto para reconocer,
 * no una clave de busqueda. La sustitucion es sobre texto que el propio usuario escribio: no se
 * redacta nada nuevo.
 */
export function descripcionGeneralizada(objetivo: string): string {
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
  let descripcion = objetivo;
  // Del mas largo al mas corto, igual que la firma: un valor contenido dentro de otro no rompe el
  // reemplazo del que lo contiene. La busqueda ignora mayusculas (el extractor normaliza los
  // correos a minusculas y el usuario pudo escribirlos de otra forma).
  for (const { texto, marcador: reemplazo } of [...sustituciones].sort(
    (a, b) => b.texto.length - a.texto.length,
  )) {
    descripcion = reemplazarSinMayusculas(descripcion, texto, reemplazo);
  }
  return descripcion.replace(/\s+/g, ' ').trim();
}

/** Reemplaza TODAS las apariciones de `buscado` (comparacion sin mayusculas) por `reemplazo`. */
function reemplazarSinMayusculas(texto: string, buscado: string, reemplazo: string): string {
  const objetivo = buscado.toLowerCase();
  if (objetivo === '') return texto;
  const partes: string[] = [];
  let resto = texto;
  for (;;) {
    const indice = resto.toLowerCase().indexOf(objetivo);
    if (indice === -1) break;
    partes.push(resto.slice(0, indice), reemplazo);
    resto = resto.slice(indice + objetivo.length);
  }
  partes.push(resto);
  return partes.join('');
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
 * `clickSinLocalizacion` marca un click de FOCO descartado de forma condicionada: la promocion
 * verifica al final que una escritura posterior con estrategias cubre su efecto.
 */
type Conversion =
  | { promovido: PasoDeReceta }
  | { omitible: true; exigeCobertura?: boolean; clickSinLocalizacion?: boolean }
  | { omitible: false; motivo: string };

/** Estrategias del paso que la receta puede usar: ordenadas y sin las que dependen del valor (D8). */
function estrategiasUtilizables(
  paso: PasoCensurado,
  valores: ValoresDeParametros,
): EstrategiaLocalizacion[] {
  return estrategiasIndependientesDelValor(
    ordenarEstrategias(paso.estrategias ?? []),
    valoresConcretos(valores),
  );
}

/** Tope del descriptor de un paso dentro de un motivo de rechazo. */
const MAX_DESCRIPTOR_MOTIVO = 80;

/**
 * DESCRIPTOR de un paso para los motivos de rechazo (FIX B): metodo (o tipo) mas la instruccion que
 * el modelo registro, acotado. La instruccion ya viene censurada desde la traza (trayectoria.ts), asi
 * que el motivo no filtra valores del usuario que la traza no muestre ya.
 */
function descriptorDePaso(paso: PasoCensurado): string {
  const cabeza = paso.accion.metodo ?? paso.accion.tipo;
  const instruccion = paso.accion.instruccion?.trim() ?? '';
  // Sin duplicar la cabeza cuando la instruccion ya empieza con ella ("type the message...").
  const texto =
    instruccion === ''
      ? cabeza
      : instruccion.toLowerCase().startsWith(cabeza.toLowerCase())
        ? instruccion
        : `${cabeza} ${instruccion}`;
  return texto.length > MAX_DESCRIPTOR_MOTIVO ? `${texto.slice(0, MAX_DESCRIPTOR_MOTIVO)}...` : texto;
}

/**
 * VERBOS con los que un act del motor declara, AL COMIENZO de su descripcion, que escribio un texto
 * en un campo. Solo el comienzo cuenta: "type 'x' into the body" es una escritura; "click the textbox
 * donde se escribe el cuerpo" no lo es.
 */
const VERBO_DE_ESCRITURA_AL_INICIO =
  /^(?:type|fill|enter|write|escrib(?:e|ir)|teclea(?:r)?|ingresa(?:r)?)\b/i;

/** Primer texto ENTRECOMILLADO de una descripcion: lo que ese act declara haber tecleado. */
const PATRON_TEXTO_ENTRECOMILLADO = /["'«]([^"'«»\n]{1,512})["'»]/;

/**
 * EL TEXTO QUE UN ACT DE VISION DECLARA HABER TECLEADO (FIX paso 16, caso real de produccion del 28
 * jul 2026, trayectoria de las 18:47): el cuerpo del correo quedo registrado como un act
 * "type 'Este correo lo envio...' into the element with aria-label "Cuerpo del mensaje"". Stagehand
 * resolvio ese act POR VISION, asi que la fila persistida no trae playwrightArguments y queda SIN
 * metodo, SIN argumentos y SIN selector. Con esa forma, la promocion lo clasificaba como CLICK DE
 * FOCO y rechazaba la trayectoria entera ("el click del paso 16 ... y ninguna escritura posterior lo
 * cubre"), cuando en realidad era la escritura del cuerpo.
 *
 * La UNICA constancia de esa escritura es la descripcion, y de ella sale el texto entrecomillado.
 * Devuelve null en cuanto el paso trae metodo (ese camino no cambia), no empieza por un verbo de
 * escritura o no entrecomilla nada: sin las tres cosas no se afirma que hubo escritura.
 */
export function escrituraDeclaradaEnLaDescripcion(accion: {
  tipo: string;
  instruccion: string | null;
  metodo: string | null;
  argumentos: string[];
}): string | null {
  if (accion.metodo !== null || accion.tipo !== 'act') return null;
  const instruccion = accion.instruccion?.trim() ?? '';
  if (instruccion === '' || !VERBO_DE_ESCRITURA_AL_INICIO.test(instruccion)) return null;
  const texto = instruccion.match(PATRON_TEXTO_ENTRECOMILLADO)?.[1]?.trim() ?? '';
  return texto === '' ? null : texto;
}

/** ¿El paso es una ESCRITURA con dato (metodo de tecleo re-ejecutable y texto registrado)? */
function esEscrituraConDato(paso: PasoCensurado): boolean {
  const metodo = paso.accion.metodo;
  // Act de VISION: sin metodo, la escritura la declara su propia descripcion (ver arriba).
  if (metodo === null) return escrituraDeclaradaEnLaDescripcion(paso.accion) !== null;
  if (ACCION_POR_METODO[metodo] !== 'escribir') return false;
  return paso.accion.argumentos.join(' ').trim() !== '';
}

/**
 * ¿El paso es un CLICK DE FOCO candidato a descartarse? Sin estrategias, sin dato tecleado y con
 * metodo 'click', o SIN metodo siendo un 'act' (caso real de produccion, 28 jul 2026: los acts
 * "click the textbox Cuerpo del mensaje" y "click the message body area" persisten SIN
 * playwrightArguments cuando Stagehand los resolvio por vision, asi que su fila no trae metodo ni
 * selector; la regla del PR 258 exigia metodo 'click' y por eso nunca los descarto).
 */
function esClickDeFocoSinLocalizacion(paso: PasoCensurado): boolean {
  if (paso.accion.argumentos.join(' ').trim() !== '' || paso.valorCensurado !== null) return false;
  // Un act de vision que declara haber ESCRITO no es un click de foco: es la escritura del campo.
  if (escrituraDeclaradaEnLaDescripcion(paso.accion) !== null) return false;
  return (
    paso.accion.metodo === 'click' || (paso.accion.metodo === null && paso.accion.tipo === 'act')
  );
}

/**
 * DERIVACION CRUZADA (FIX A, caso real de produccion, 28 jul 2026): un paso de ESCRITURA con dato y
 * sin ninguna estrategia adopta el localizador de un paso ADYACENTE (click o escritura) que apunte
 * al MISMO campo. El mismo campo se reconoce por selector identico o por descripcion equivalente
 * (tabla de equivalencias de campos de percepcion.ts). Caso concreto: la trayectoria de 19 pasos
 * traia el type del cuerpo sin selector seguido del click del cuerpo CON selector; la receta escribe
 * el cuerpo con el selector de ese click. Si ningun adyacente cubre el campo, el paso queda como
 * estaba y la conversion lo rechaza con su indice y descripcion.
 */
function adoptarEstrategiasDeCampoAdyacente(
  pasos: PasoCensurado[],
  valores: ValoresDeParametros,
): PasoCensurado[] {
  return pasos.map((paso, indice) => {
    // Con una estrategia ANCLADA al DOM (atributo o xpath, salidas del selector) no se adopta nada.
    // Las derivadas de la descripcion (rol, texto) no bloquean la adopcion: el localizador del
    // adyacente que apunto de verdad al campo es mas fuerte, y ambas listas se FUSIONAN.
    const propias = estrategiasUtilizables(paso, valores);
    const tieneAncla = propias.some((e) => e.tipo === 'atributo' || e.tipo === 'xpath');
    if (!esEscrituraConDato(paso) || tieneAncla) return paso;
    const donante =
      donanteDelMismoCampo(pasos, indice, -1, paso, valores) ??
      donanteDelMismoCampo(pasos, indice, 1, paso, valores);
    if (donante === null) return paso;
    return {
      ...paso,
      estrategias: [...donante.estrategias, ...propias].slice(0, MAX_ESTRATEGIAS_POR_PASO),
    };
  });
}

/**
 * El paso ADYACENTE en una direccion que puede DONAR su localizador: el primer paso con accion sobre
 * un elemento (los que solo miran se saltan), siempre que sea un click o una escritura con
 * estrategias utilizables y del MISMO campo. El paso sintetico de verificacion y las navegaciones
 * cortan la busqueda: adoptar un localizador cruzando la verificacion (o un cambio de pagina) podria
 * atar la escritura al elemento de la accion irreversible.
 */
function donanteDelMismoCampo(
  pasos: PasoCensurado[],
  indice: number,
  direccion: -1 | 1,
  receptor: PasoCensurado,
  valores: ValoresDeParametros,
): PasoCensurado | null {
  for (let i = indice + direccion; i >= 0 && i < pasos.length; i += direccion) {
    const candidato = pasos[i];
    if (candidato === undefined) return null;
    const tipo = candidato.accion.tipo;
    if (TIPOS_SIN_EFECTO.has(tipo)) continue;
    const metodo = candidato.accion.metodo;
    if (metodo === null || ACCION_POR_METODO[metodo] === undefined) return null;
    if (!apuntaAlMismoCampo(receptor, candidato)) return null;
    const estrategias = estrategiasUtilizables(candidato, valores);
    return estrategias.length > 0 ? { ...candidato, estrategias } : null;
  }
  return null;
}

/** ¿El paso es una PULSACION DE TECLA registrada como act del motor (metodo 'press')? */
function esPulsacionDeTecla(paso: PasoCensurado): boolean {
  return paso.accion.metodo === 'press';
}

/**
 * HERENCIA DE LOCALIZADOR EN LAS PULSACIONES (FIX teclas, caso real de produccion del 28 jul 2026):
 * una pulsacion que sigue a una escritura opera sobre el campo QUE ACABA DE RECIBIR EL TEXTO, asi que
 * hereda TODAS las estrategias de esa escritura (atributo, rol, texto y xpath) y no solo el xpath que
 * la traza le dejo. La receta 2017cfba fallaba justo ahi: su paso de teclas quedo con una sola
 * estrategia, el xpath absoluto del compose de la corrida origen (div[32]), que en sesion fresca no
 * resuelve; el paso escalaba al motor y la corrida moria en 13 segundos.
 *
 * Las propias del paso se conservan DETRAS de las heredadas (el orden canonico las reordena despues) y
 * la lista se deduplica y se acota. Es la RED de la correccion, no la principal: el ejecutor pulsa
 * sobre el foco cuando la pulsacion sigue a una escritura exitosa (ejecutor-receta.ts), que es la
 * semantica real del teclado y no necesita localizador ninguno.
 */
function heredarEstrategiasEnPulsaciones(
  pasos: PasoCensurado[],
  valores: ValoresDeParametros,
): PasoCensurado[] {
  let escrituraPrevia: PasoCensurado | null = null;
  return pasos.map((paso) => {
    if (TIPOS_SIN_EFECTO.has(paso.accion.tipo)) return paso;
    if (esEscrituraConDato(paso)) {
      escrituraPrevia = paso;
      return paso;
    }
    if (!esPulsacionDeTecla(paso)) {
      escrituraPrevia = null;
      return paso;
    }
    if (escrituraPrevia === null) return paso;
    const heredadas = estrategiasUtilizables(escrituraPrevia, valores);
    const propias = estrategiasUtilizables(paso, valores);
    const vistas = new Set<string>();
    const estrategias: EstrategiaLocalizacion[] = [];
    for (const estrategia of [...heredadas, ...propias]) {
      const clave = claveDeEstrategia(estrategia);
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      estrategias.push(estrategia);
    }
    return { ...paso, estrategias: estrategias.slice(0, MAX_ESTRATEGIAS_POR_PASO) };
  });
}

/** ¿Los dos pasos apuntan al MISMO campo? Selector identico, o descripciones del mismo campo. */
function apuntaAlMismoCampo(a: PasoCensurado, b: PasoCensurado): boolean {
  if (a.selector !== null && b.selector !== null && a.selector === b.selector) return true;
  return describenElMismoCampo(a.accion.instruccion, b.accion.instruccion);
}

/**
 * DESTILACION ESTRICTA (FIX destilacion, 28 jul 2026): de la trayectoria se conserva el ULTIMO
 * camino continuo y exitoso hacia el objetivo, no los intentos previos ni los desvios. Caso real:
 * la receta 79622fdb quedo con 21 pasos porque los desvios de la corrida origen (pantalla completa,
 * minimizar, expandir, re-clicks y re-escrituras de campos ya llenos) traian selector, y el filtro
 * solo descartaba clicks SIN estrategias. Este filtro descarta, tengan selector o no:
 *  1. pasos sobre los CONTROLES DE LA CABECERA del compose (pantalla completa, minimizar, expandir):
 *     conmutan la vista, no acercan al objetivo, y ninguna receta debe repetirlos;
 *  2. CLICKS sin dato sobre un campo que una ESCRITURA POSTERIOR con estrategias ya cubre (el
 *     ejecutor determinista enfoca el localizador de esa escritura antes de teclear);
 *  3. ESCRITURAS sobre un campo que una escritura POSTERIOR con estrategias vuelve a llenar: el
 *     efecto de la primera quedo anulado por el desvio y solo la ultima es el camino que llego.
 */
const CONTROLES_DE_CABECERA_DE_COMPOSE: readonly string[] = [
  'pantalla completa',
  'full screen',
  'fullscreen',
  'minimizar',
  'minimize',
  'expandir',
  'expand the compose',
  'expand compose',
  'maximizar',
  'maximize',
  'contraer',
  'collapse',
  'pop-out',
  'salir de pantalla',
  'exit full',
];

/** ¿El paso es un CLICK (con o sin selector) y sin dato tecleado? */
function esClickSinDato(paso: PasoCensurado): boolean {
  if (paso.accion.argumentos.join(' ').trim() !== '' || paso.valorCensurado !== null) return false;
  if (escrituraDeclaradaEnLaDescripcion(paso.accion) !== null) return false;
  const metodo = paso.accion.metodo;
  if (metodo !== null) return ACCION_POR_METODO[metodo] === 'click';
  return paso.accion.tipo === 'act';
}

/**
 * ¿El paso actua sobre un CONTROL DE LA CABECERA del compose? Se decide con la instruccion del
 * modelo y con los valores de atributo de sus estrategias (el aria-label del control), normalizados.
 * Solo aplica a clicks sin dato: una escritura jamas se descarta por esta regla.
 */
function esControlDeCabeceraDeCompose(paso: PasoCensurado): boolean {
  if (!esClickSinDato(paso)) return false;
  const textos = [
    paso.accion.instruccion ?? '',
    ...(paso.estrategias ?? []).map((e) => (e.tipo === 'atributo' ? e.valor : '')),
  ];
  const texto = normalizarTexto(textos.join(' '));
  return CONTROLES_DE_CABECERA_DE_COMPOSE.some((control) => texto.includes(control));
}

/** ¿Alguna ESCRITURA posterior con estrategias utilizables cubre el MISMO campo que este paso? */
function escrituraPosteriorCubreElCampo(
  pasos: readonly PasoCensurado[],
  indice: number,
  valores: ValoresDeParametros,
): boolean {
  const paso = pasos[indice];
  if (paso === undefined) return false;
  for (let i = indice + 1; i < pasos.length; i++) {
    const posterior = pasos[i];
    if (posterior === undefined) break;
    if (!esEscrituraConDato(posterior)) continue;
    if (estrategiasUtilizables(posterior, valores).length === 0) continue;
    if (apuntaAlMismoCampo(paso, posterior)) return true;
  }
  return false;
}

/** Aplica la destilacion estricta: devuelve los pasos SIN los desvios documentados arriba. */
function descartarDesviosDeLaTrayectoria(
  pasos: PasoCensurado[],
  valores: ValoresDeParametros,
): PasoCensurado[] {
  return pasos.filter((paso, indice) => {
    // Un paso FALLIDO nunca se destila fuera: la politica sobre pasos fallidos (rechazar la
    // trayectoria, o haberlos pre-filtrado con consentimiento) es del llamador, no de este filtro.
    if (paso.exito === false) return true;
    if (esControlDeCabeceraDeCompose(paso)) return false;
    if (
      (esClickSinDato(paso) || esEscrituraConDato(paso)) &&
      escrituraPosteriorCubreElCampo(pasos, indice, valores)
    ) {
      return false;
    }
    return true;
  });
}

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
  const estrategias = estrategiasUtilizables(paso, valores);

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

  // PULSACION DE TECLA registrada como act del motor (metodo 'press'; caso real de produccion, jul
  // 2026: "press Tab key to confirm the recipient"). Es el MISMO gesto que ya saben repetir las
  // recetas grabadas al confirmar un chip (grabacion.ts: paso 'teclas' que pulsa sobre el foco) y
  // que los pasos 'keys' de arriba: se promueve como paso 'teclas' conservando la tecla y su
  // posicion. Sus estrategias son las HEREDADAS de la escritura previa mas las suyas propias
  // (heredarEstrategiasEnPulsaciones), nunca el xpath solo; y el ejecutor pulsa sobre el FOCO cuando
  // el paso sigue a una escritura exitosa, que es la semantica real del teclado.
  if (paso.accion.metodo === 'press') {
    const teclas = paso.accion.argumentos[0]?.trim();
    if (teclas === undefined || teclas === '') {
      return { omitible: false, motivo: 'pulsacion sin teclas registradas' };
    }
    return { promovido: { ...base, accion: 'teclas', estrategias, teclas } };
  }

  if (estrategias.length === 0) {
    // CLICK DE FOCO (caso real de produccion, jul 2026: acts "click the textbox Cuerpo del mensaje"
    // y "click the message body area" sin selector abortaban la conversion de una trayectoria
    // exitosa de 44 pasos). Un click sin estrategias y SIN dato solo pone el foco: el ejecutor
    // determinista ya hace click sobre el localizador del paso de escritura antes de teclear
    // (browserbase.ts, ejecutarPasoDeterminista), asi que un click de foco previo a una escritura
    // con selector es redundante. Cubre tambien el act SIN metodo (resuelto por vision, sin
    // playwrightArguments persistidos), que es la forma real con la que esos clicks llegaron de la
    // base. Se descarta de forma CONDICIONADA: la promocion verifica al final que una escritura
    // posterior lo cubre (ver promoverTrayectoria); un click sin estrategias al que ninguna
    // escritura sigue (un envio, una navegacion por click) si bloquea, con el paso exacto.
    if (esClickDeFocoSinLocalizacion(paso)) {
      return { omitible: true, clickSinLocalizacion: true };
    }
    // ESCRITURA con dato sin localizacion: la derivacion cruzada (FIX A) ya intento adoptar el
    // localizador de un paso adyacente del mismo campo antes de llegar aqui. Sin adyacente que lo
    // cubra, el rechazo procede con el indice y la descripcion del paso que bloqueo (FIX B).
    if (esEscrituraConDato(paso)) {
      return {
        omitible: false,
        motivo: `paso ${paso.idx}: ${descriptorDePaso(paso)}, sin estrategia y sin paso adyacente que cubra el campo`,
      };
    }
    return {
      omitible: false,
      motivo: `paso ${paso.idx}: ${descriptorDePaso(paso)}, sin ninguna estrategia de localizacion`,
    };
  }

  // ESCRITURA DECLARADA POR UN ACT DE VISION (FIX paso 16): sin metodo ni argumentos, el texto
  // tecleado solo consta en la descripcion. Se promueve SOLO si ese texto es EXACTAMENTE un dato que
  // el objetivo declaro, para que el paso viaje como MARCADOR y cada corrida lo resuelva con los
  // suyos. Un texto que no corresponde a ningun parametro NO se guarda como literal: la descripcion
  // es el relato del modelo, no las pulsaciones, y persistir de ahi un literal (parafraseado o
  // recortado) haria que la receta escriba algo distinto de lo aprendido.
  const declarada = escrituraDeclaradaEnLaDescripcion(paso.accion);
  if (paso.accion.metodo === null && declarada !== null) {
    const parametro = marcadorDelValor(declarada, valores);
    if (parametro === null) {
      return {
        omitible: false,
        motivo: `paso ${paso.idx}: ${descriptorDePaso(paso)}, escribio un texto que el objetivo de la corrida no declara`,
      };
    }
    return {
      promovido: { ...base, accion: 'escribir', estrategias, valor: { tipo: 'parametro', parametro } },
    };
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
 * hace una tarea distinta de la aprendida). La UNICA excepcion es el click de FOCO sin estrategias
 * cubierto por una escritura posterior (ver convertirPaso): su unico efecto es el que la escritura
 * conservada ya repite.
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
  const clicksSinLocalizacion: Array<{ idx: number; descriptor: string }> = [];
  const escriturasPromovidas: number[] = [];
  // Primero la adopcion (una escritura sin selector toma el localizador del adyacente), despues la
  // herencia de las pulsaciones (que copia las estrategias ya completas de la escritura previa) y al
  // final la destilacion: el orden importa, porque el donante puede ser justo un click que la
  // destilacion descartara por redundante.
  const preparados = heredarEstrategiasEnPulsaciones(
    adoptarEstrategiasDeCampoAdyacente(entrada.pasos, valores),
    valores,
  );
  for (const paso of descartarDesviosDeLaTrayectoria(preparados, valores)) {
    if (paso.exito === false) {
      return { promovida: false, motivo: 'la trayectoria contiene un paso fallido' };
    }
    const conversion = convertirPaso(paso, entrada.dominio, valores, pasos.length);
    if ('promovido' in conversion) {
      if (conversion.promovido.accion === 'escribir') escriturasPromovidas.push(paso.idx);
      pasos.push(conversion.promovido);
      continue;
    }
    if (!conversion.omitible) return { promovida: false, motivo: conversion.motivo };
    if (conversion.exigeCobertura === true) llenadosSinRegistro.push(paso.accion.tipo);
    if (conversion.clickSinLocalizacion === true) {
      clicksSinLocalizacion.push({ idx: paso.idx, descriptor: descriptorDePaso(paso) });
    }
  }
  // COBERTURA de un click de foco descartado (convertirPaso): solo es inocuo si una ESCRITURA
  // POSTERIOR con estrategias lo cubre (el ejecutor enfoca el localizador de esa escritura antes de
  // teclear). Un click sin estrategias al que ninguna escritura sigue puede ser el click con efecto
  // propio (enviar, confirmar): la conversion falla nombrando el paso exacto.
  for (const click of clicksSinLocalizacion) {
    if (!escriturasPromovidas.some((idxEscritura) => idxEscritura > click.idx)) {
      return {
        promovida: false,
        motivo: `el click del paso ${click.idx} (${click.descriptor}) quedo sin ninguna estrategia de localizacion y ninguna escritura posterior lo cubre`,
      };
    }
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
