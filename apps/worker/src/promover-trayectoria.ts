import {
  esAtributoEstable,
  MAX_ESTRATEGIAS_POR_PASO,
  parsePromoverTrayectoriaJobPayload,
  type EstrategiaLocalizacion,
  type Job,
  type PasoDeReceta,
} from '@ledesma-platform/shared';
import { VALOR_CENSURADO } from './censura.js';
import type { TrayectoriaConPasos, PasoTrayectoria } from '@ledesma-platform/backend/trayectorias';
import type { NuevaRecetaWeb, RecetaWeb } from '@ledesma-platform/backend/recetas-web';
import { PermanentExecutionError, PromocionNoRepetibleError } from './errores.js';
import { detectarVerboBloqueado } from './prompt-tarea-web.js';
import {
  descripcionGeneralizada,
  escrituraDeclaradaEnLaDescripcion,
  firmaDeObjetivo,
  promoverTrayectoria,
} from './receta-web.js';
import type { PasoCensurado } from './trayectoria.js';
import type { Logger } from './logger.js';

/**
 * GUARDAR COMO TAREA APRENDIDA (Fase F): la promocion trayectoria -> receta CON CONSENTIMIENTO del
 * usuario, a partir de la trayectoria PERSISTIDA (V030). Es la tercera via de siembra de recetas_web,
 * junto a la promocion automatica (tarea-web.ts, CAMBIO 3) y la grabacion (grabacion.ts, V036).
 *
 * EN QUE SE DIFERENCIA DE LA PROMOCION AUTOMATICA, y por que existe: la automatica corre al cierre de
 * la corrida con las estrategias de localizacion OBSERVADAS EN MEMORIA (observador de pasos, CAMBIO
 * 1), que pasos_trayectoria NO persiste (V030 no tiene columna). Cuando el observador esta apagado
 * (default) esa promocion no deja receta, y el exito queda solo como trayectoria. Este modulo permite
 * al usuario rescatar ese exito DESPUES, desde lo que si quedo en la base: la accion de cada paso, su
 * selector y su valor censurado.
 *
 * LO QUE SE PUEDE DERIVAR DE UNA TRAYECTORIA PERSISTIDA, y lo que no:
 *  - El selector persistido (xpath de Stagehand, a veces con el prefijo 'xpath=') se convierte en la
 *    estrategia 'xpath' del paso. Si el xpath trae predicados de atributo estable (@aria-label, @id,
 *    @name, @data-*), se derivan ADEMAS estrategias 'atributo', que quedan ANTES del xpath (leccion
 *    de los ids dinamicos de Gmail: el orden del contrato prioriza atributo/rol sobre xpath).
 *  - La DESCRIPCION del ACT (accion.instruccion, censurada) nombra el campo en lenguaje natural
 *    ("click the textbox Cuerpo del mensaje", "escribir el destinatario"): de ella se derivan
 *    estrategias 'rol' (nombre accesible matcheado POR PREFIJO por el resolutor, tolerando marcas
 *    invisibles de direccion como las del boton Enviar de Gmail) y 'texto'. Caso real de produccion
 *    (28 jul 2026): la receta e62b0791 quedo con UNA sola estrategia por paso (el xpath absoluto de
 *    la corrida origen, atado a un compose re-renderizado por los desvios) y en sesion fresca no
 *    resolvio nada; con estrategias derivadas de la descripcion la receta sobrevive al cambio de
 *    posicion del DOM.
 *  - La percepcion de campos que corrio durante la corrida NO se persiste (pasos_trayectoria no
 *    tiene columna): sus aria-labels solo llegan aqui indirectamente, cuando el modelo los cito en
 *    la descripcion del ACT. La AUTO REPARACION (D5) sigue enriqueciendo la receta en su primera
 *    re-ejecucion: al escalar un paso se leen del DOM las estrategias frescas y quedan persistidas.
 *  - Un paso que quedo SOLO con xpath se conserva asi (mejor un ultimo recurso que nada) y se
 *    reporta en el resultado de la promocion (`pasosSoloXpath`), para que la fragilidad sea visible.
 *
 * DECISIONES DE FILTRADO (distintas de la promocion automatica, a proposito):
 *  - Los pasos con exito === false se DESCARTAN en lugar de invalidar la trayectoria: el desenlace
 *    global ya fue exitoso, asi que todo paso fallido fue compensado por un reintento que si esta en
 *    la traza. La automatica rechaza porque corre sin consentimiento; aqui el usuario pidio guardar.
 *  - Todo lo demas es EL MISMO contrato: promoverTrayectoria (receta-web.ts) decide que se conserva
 *    (acciones con efecto), que se deriva (parametros a marcadores con el extractor determinista) y
 *    que se descarta (screenshots, extract, ariaTree, think, done). El paso sintetico 'verificacion'
 *    se conserva como paso 'verificar': la receta derivada pasa por la MISMA verificacion
 *    determinista y la MISMA politica del usuario que cualquier otra (D7, sin bypass).
 *
 * Modulo sin motor, sin navegador y sin modelo: la conversion es pura y la persistencia entra por
 * puertos, mismo criterio que grabacion.ts.
 */

/** Prefijo con el que Stagehand entrega sus selectores ('xpath=/html[1]/...'). */
const PREFIJO_XPATH = 'xpath=';

/**
 * Predicado de atributo dentro de un xpath: [@atributo='valor'] o [@atributo="valor"]. Solo captura
 * valores SIN la comilla que los delimita (un valor con comillas mezcladas no matchea y se ignora).
 */
const PATRON_PREDICADO_ATRIBUTO = /\[@([a-zA-Z-]{1,40})=(?:'([^']{1,512})'|"([^"]{1,512})")\]/g;

/**
 * Deriva las estrategias de localizacion de un paso desde su selector persistido. El xpath entra
 * SIEMPRE que tenga forma de xpath; los atributos estables embebidos en sus predicados entran ANTES
 * (ordenados por el contrato: atributo > rol > texto > xpath). Devuelve lista vacia si no hay
 * selector utilizable: ese paso no es re-ejecutable y promoverTrayectoria rechazara la trayectoria.
 */
export function derivarEstrategiasDeSelector(selector: string | null): EstrategiaLocalizacion[] {
  if (selector === null) return [];
  const crudo = selector.trim();
  const xpath = crudo.startsWith(PREFIJO_XPATH) ? crudo.slice(PREFIJO_XPATH.length).trim() : crudo;
  if (xpath === '' || xpath.length > 512 || !/^[/(]/.test(xpath)) return [];

  const estrategias: EstrategiaLocalizacion[] = [];
  for (const match of xpath.matchAll(PATRON_PREDICADO_ATRIBUTO)) {
    const atributo = match[1]?.toLowerCase();
    const valor = match[2] ?? match[3];
    if (atributo === undefined || valor === undefined || valor.trim() === '') continue;
    if (!esAtributoEstable(atributo)) continue;
    if (estrategias.some((e) => e.tipo === 'atributo' && e.atributo === atributo)) continue;
    estrategias.push({ tipo: 'atributo', atributo, valor });
  }
  estrategias.push({ tipo: 'xpath', xpath });
  return estrategias;
}

/** Metodos de la traza cuya descripcion admite derivar la localizacion de un CLICK. */
const METODOS_DE_CLICK_DERIVABLES = new Set(['click', 'dblclick', 'tap']);

/** Metodos de la traza cuya descripcion admite derivar la localizacion de una ESCRITURA. */
const METODOS_DE_ESCRITURA_DERIVABLES = new Set(['fill', 'type', 'setValue']);

/** Palabra de ROL dentro de una descripcion, mapeada al rol accesible que nombra. */
const ROL_POR_PALABRA: Readonly<Record<string, string>> = {
  textbox: 'textbox',
  input: 'textbox',
  field: 'textbox',
  campo: 'textbox',
  casilla: 'textbox',
  box: 'textbox',
  area: 'textbox',
  button: 'button',
  boton: 'button',
  link: 'link',
  enlace: 'link',
  checkbox: 'checkbox',
  combobox: 'combobox',
};

/**
 * Palabras INICIALES de una descripcion que no identifican al elemento (verbos de la accion,
 * preposiciones y articulos). Se retiran solo del comienzo, de forma iterativa: un "de" interno
 * ("opciones de envio") forma parte del nombre y se conserva.
 */
const RELLENO_INICIAL = new Set([
  'click', 'clic', 'clicar', 'clickear', 'press', 'pulsa', 'pulsar', 'presiona', 'presionar',
  'toca', 'tocar', 'tap', 'select', 'selecciona', 'seleccionar', 'open', 'abrir', 'abre',
  'escribe', 'escribir', 'type', 'fill', 'enter', 'write', 'teclea', 'teclear', 'haz', 'hacer',
  'on', 'en', 'in', 'into', 'sobre', 'to', 'at', 'the', 'el', 'la', 'los', 'las', 'un', 'una',
  'a', 'al',
]);

/** Separadores que parten una descripcion de escritura en sus campos ("message into the body"). */
const PATRON_SEPARADOR_DE_CAMPOS = /\b(?:into|dentro)\b/gi;

/**
 * CITA TEXTUAL de un aria-label dentro de la descripcion del ACT ('... with aria-label "Cuerpo del
 * mensaje"'). El modelo copia ahi el atributo tal como lo leyo del DOM, asi que es el nombre
 * accesible LITERAL del elemento: mejor fuente que las palabras con las que describio la accion.
 */
const PATRON_ARIA_LABEL_CITADO = /aria[-\s]?label\s*(?:=|:)?\s*["'«]([^"'«»\n]{2,60})["'»]/i;

/** Palabra de rol nombrada en cualquier parte de la descripcion, o null. */
function rolCitadoEnLaDescripcion(descripcion: string): string | null {
  const palabra = descripcion.match(
    /\b(textbox|input|field|campo|button|boton|link|enlace|checkbox|combobox)\b/i,
  );
  return ROL_POR_PALABRA[(palabra?.[1] ?? '').toLowerCase()] ?? null;
}

/** Tope de estrategias derivadas de UNA descripcion (el resto de la lista lo llena el selector). */
const MAX_ESTRATEGIAS_DE_DESCRIPCION = 3;

/** Tope de longitud de un nombre derivado de una descripcion. */
const MAX_NOMBRE_DERIVADO = 60;

/** Quita del comienzo del texto las palabras de relleno, y de los extremos comillas y puntuacion. */
function limpiarNombreDerivado(texto: string): string {
  let limpio = texto.replace(/["'`]/g, ' ').replace(/\s+/g, ' ').trim();
  for (;;) {
    const primera = limpio.split(' ')[0] ?? '';
    if (primera === '' || !RELLENO_INICIAL.has(primera.toLowerCase())) break;
    limpio = limpio.slice(primera.length).trim();
  }
  return limpio.replace(/[.,;:!?]+$/, '').trim();
}

/** ¿El nombre derivado sirve como estrategia (acotado, con letras y sin marcas de censura)? */
function nombreDerivadoValido(nombre: string): boolean {
  if (nombre.length < 2 || nombre.length > MAX_NOMBRE_DERIVADO) return false;
  if (nombre.includes(VALOR_CENSURADO)) return false;
  return /\p{L}/u.test(nombre);
}

/**
 * DERIVA estrategias 'rol' y 'texto' desde la DESCRIPCION del ACT (FIX estrategias multiples, 28
 * jul 2026). La descripcion nombra el campo en lenguaje natural y es lo unico persistido que
 * sobrevive a un xpath re-renderizado. Cuatro formas, de la mas explicita a la mas laxa:
 *  0. aria-label CITADO textualmente: 'type ... aria-label "Cuerpo del mensaje"' -> atributo
 *     aria-label "Cuerpo del mensaje" (y rol con ese mismo nombre). Es el nombre accesible literal
 *     que el modelo copio del DOM, asi que gana a cualquier nombre adivinado de las palabras;
 *  1. rol nombrado antes del campo: "click the textbox Cuerpo del mensaje" -> rol textbox,
 *     nombre "Cuerpo del mensaje";
 *  2. rol nombrado despues del campo: "click the recipients field" -> rol textbox, "recipients";
 *  3. sin palabra de rol: un click deriva boton mas texto visible ("click en Enviar" -> rol button
 *     "Enviar" y texto "Enviar"); una escritura deriva un textbox por cada campo nombrado
 *     ("type the message into the body" -> "message" y "body").
 * El resolutor matchea el nombre POR PREFIJO del nombre accesible (localizacion.ts), tolerando
 * marcas invisibles de direccion y el plural: "destinatario" encuentra "Destinatarios en Para".
 * Los valores tecleados se retiran de la descripcion ANTES de derivar (jamas se localiza por el
 * dato) y el filtro de dependencia del valor (D8) vuelve a comprobarlo despues.
 */
export function derivarEstrategiasDeDescripcion(accion: {
  tipo: string;
  instruccion: string | null;
  metodo: string | null;
  argumentos: string[];
}): EstrategiaLocalizacion[] {
  const metodo = accion.metodo;
  // Act de VISION que declara la escritura en su propia descripcion (FIX paso 16): sin metodo, sin
  // argumentos y sin selector, la descripcion es lo unico que queda, asi que tambien deriva.
  const declarada = escrituraDeclaradaEnLaDescripcion(accion);
  const esClick = metodo !== null && METODOS_DE_CLICK_DERIVABLES.has(metodo);
  const esEscritura =
    (metodo !== null && METODOS_DE_ESCRITURA_DERIVABLES.has(metodo)) || declarada !== null;
  if ((!esClick && !esEscritura) || accion.instruccion === null) return [];

  // El valor tecleado se borra de la descripcion: ninguna estrategia puede nacer del dato.
  let descripcion = accion.instruccion;
  for (const argumento of [...accion.argumentos, ...(declarada === null ? [] : [declarada])]) {
    if (argumento.trim() === '') continue;
    const escapado = argumento.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    descripcion = descripcion.replace(new RegExp(escapado, 'gi'), ' ');
  }
  descripcion = descripcion.replace(/\s+/g, ' ').trim();
  if (descripcion === '' || descripcion.includes(VALOR_CENSURADO)) return [];

  const estrategias: EstrategiaLocalizacion[] = [];
  const agregar = (estrategia: EstrategiaLocalizacion): void => {
    const clave = JSON.stringify(estrategia);
    if (estrategias.some((previa) => JSON.stringify(previa) === clave)) return;
    if (estrategias.length < MAX_ESTRATEGIAS_DE_DESCRIPCION) estrategias.push(estrategia);
  };

  // ARIA-LABEL CITADO: prioridad MAXIMA y salida inmediata. Es el nombre accesible literal que el
  // modelo copio del DOM, asi que localiza por atributo estable (lo mas fuerte del contrato) y por
  // rol con ese mismo nombre; las formas laxas de abajo, que adivinan el nombre a partir de las
  // palabras de la accion, ya no aportan nada mejor.
  const etiqueta = (descripcion.match(PATRON_ARIA_LABEL_CITADO)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (nombreDerivadoValido(etiqueta)) {
    agregar({ tipo: 'atributo', atributo: 'aria-label', valor: etiqueta });
    agregar({
      tipo: 'rol',
      rol: rolCitadoEnLaDescripcion(descripcion) ?? (esClick ? 'button' : 'textbox'),
      nombre: etiqueta,
    });
    return estrategias;
  }

  // Forma 1: la palabra de rol precede al nombre ("the textbox Cuerpo del mensaje").
  const rolYNombre = descripcion.match(
    /\b(textbox|input|button|boton|link|enlace|checkbox|combobox)\b[\s:]+(.{2,80}?)$/i,
  );
  if (rolYNombre !== null) {
    const rol = ROL_POR_PALABRA[(rolYNombre[1] ?? '').toLowerCase()];
    const nombre = limpiarNombreDerivado(rolYNombre[2] ?? '');
    if (rol !== undefined && nombreDerivadoValido(nombre)) {
      agregar({ tipo: 'rol', rol, nombre });
      if (rol === 'button' && esClick) agregar({ tipo: 'texto', texto: nombre });
      return estrategias;
    }
  }

  // Forma 2: la palabra de rol sigue al nombre ("the recipients field").
  const nombreYRol = limpiarNombreDerivado(descripcion).match(
    /^(.{2,80}?)\s+\b(field|button|box|area|campo|boton|casilla|textbox|input)\b/i,
  );
  if (nombreYRol !== null) {
    const rol = ROL_POR_PALABRA[(nombreYRol[2] ?? '').toLowerCase()];
    const nombre = limpiarNombreDerivado(nombreYRol[1] ?? '');
    if (rol !== undefined && nombreDerivadoValido(nombre)) {
      agregar({ tipo: 'rol', rol, nombre });
      if (rol === 'button' && esClick) agregar({ tipo: 'texto', texto: nombre });
      return estrategias;
    }
  }

  // Forma 3, click: lo que queda tras el relleno es el nombre del control ("click en Enviar").
  if (esClick) {
    const nombre = limpiarNombreDerivado(descripcion);
    if (nombreDerivadoValido(nombre)) {
      agregar({ tipo: 'rol', rol: 'button', nombre });
      agregar({ tipo: 'texto', texto: nombre });
    }
    return estrategias;
  }

  // Forma 3, escritura: cada tramo separado por preposiciones nombra un campo candidato.
  for (const tramo of descripcion.split(PATRON_SEPARADOR_DE_CAMPOS)) {
    const nombre = limpiarNombreDerivado(tramo);
    if (nombreDerivadoValido(nombre)) agregar({ tipo: 'rol', rol: 'textbox', nombre });
  }
  return estrategias;
}

/**
 * Las estrategias COMPLETAS de un paso persistido: los atributos estables embebidos en el xpath,
 * las derivadas de la descripcion del ACT (rol y texto) y el xpath al FINAL, como ultimo recurso.
 */
export function derivarEstrategiasDePaso(
  selector: string | null,
  accion: {
    tipo: string;
    instruccion: string | null;
    metodo: string | null;
    argumentos: string[];
  },
): EstrategiaLocalizacion[] {
  const delSelector = derivarEstrategiasDeSelector(selector);
  const atributos = delSelector.filter((e) => e.tipo === 'atributo');
  const xpath = delSelector.filter((e) => e.tipo === 'xpath');
  const deDescripcion = derivarEstrategiasDeDescripcion(accion);
  return [...atributos, ...deDescripcion, ...xpath].slice(0, MAX_ESTRATEGIAS_POR_PASO);
}

/** La `accion` jsonb de un paso persistido, leida con tolerancia (una fila rara no debe lanzar). */
function accionDeFila(crudo: unknown): PasoCensurado['accion'] {
  const objeto = typeof crudo === 'object' && crudo !== null ? (crudo as Record<string, unknown>) : {};
  const argumentos = Array.isArray(objeto.argumentos)
    ? objeto.argumentos.filter((a): a is string => typeof a === 'string')
    : [];
  return {
    tipo: typeof objeto.tipo === 'string' && objeto.tipo !== '' ? objeto.tipo : 'desconocida',
    instruccion: typeof objeto.instruccion === 'string' ? objeto.instruccion : null,
    metodo: typeof objeto.metodo === 'string' ? objeto.metodo : null,
    argumentos,
  };
}

/**
 * Los pasos PERSISTIDOS de las trayectorias de un job, como los PasoCensurado que la promocion
 * consume. Concatena las trayectorias EN ORDEN (un job con checkpoint de aprobacion tiene la
 * preparacion en la corrida pausada y la ejecucion verificada en la reanudacion; una receta con solo
 * la segunda mitad haria algo distinto de lo aprendido) y DESCARTA los pasos con exito === false
 * (ver cabecera). Los idx se renumeran para que la lista final sea continua.
 */
export function pasosCensuradosDesdeTrayectorias(
  trayectorias: readonly TrayectoriaConPasos[],
): PasoCensurado[] {
  const pasos: PasoCensurado[] = [];
  for (const trayectoria of trayectorias) {
    const ordenados = [...trayectoria.pasos].sort((a, b) => a.idx - b.idx);
    for (const fila of ordenados) {
      if (fila.exito === false) continue;
      pasos.push(pasoCensuradoDesdeFila(fila, pasos.length));
    }
  }
  return pasos;
}

function pasoCensuradoDesdeFila(fila: PasoTrayectoria, idx: number): PasoCensurado {
  const accion = accionDeFila(fila.accion);
  return {
    idx,
    accion,
    selector: fila.selector,
    valorCensurado: fila.valorCensurado,
    url: fila.url,
    exito: true,
    estrategias: derivarEstrategiasDePaso(fila.selector, accion),
    dominio: null,
  };
}

/** Por que una trayectoria persistida no se pudo guardar (diagnostico interno). */
export interface GuardadoRechazado {
  guardable: false;
  motivo: string;
}

export interface GuardadoAceptado {
  guardable: true;
  pasos: PasoDeReceta[];
  firmaObjetivo: string;
  /**
   * Pasos de la receta que quedaron SOLO con la estrategia xpath (ni el selector traia atributos
   * estables ni la descripcion permitio derivar rol o texto). Se conservan (mejor un ultimo recurso
   * que nada), pero la fragilidad se reporta en el resultado del job para que sea visible.
   */
  pasosSoloXpath: string[];
  /**
   * Nombres de los metodos NO representables que la promocion descarto sin abortar (FIX A: un gesto
   * de enfoque como clickAndHold, un scroll suelto, un select nativo o una tool desconocida de una
   * version futura de Stagehand). Vacio cuando la trayectoria no traia ninguno. El job los loguea
   * para dejar rastro de que gesto se omitio al aprender la tarea.
   */
  metodosDescartados: string[];
}

export type ResultadoDeGuardado = GuardadoAceptado | GuardadoRechazado;

/**
 * CONVIERTE las trayectorias persistidas de un job exitoso en los pasos y la firma de una receta.
 * Funcion PURA: toda la politica de conversion (que se conserva, que se deriva, que se descarta y
 * cuando se rechaza entero) es la de promoverTrayectoria, con el pre-filtrado documentado arriba.
 */
export function convertirTrayectoriaPersistida(
  trayectorias: readonly TrayectoriaConPasos[],
): ResultadoDeGuardado {
  const ultima = trayectorias[trayectorias.length - 1];
  if (ultima === undefined) {
    return { guardable: false, motivo: 'el job no tiene ninguna trayectoria registrada' };
  }
  if (ultima.estado !== 'exitosa') {
    return { guardable: false, motivo: `la ultima trayectoria termino ${ultima.estado}` };
  }
  // Un job multisitio pierde el dominio POR PASO al persistirse (V030 no lo guarda): promoverlo
  // ataria pasos de un sitio al dominio de otro. Los goto al segundo sitio ya lo rechazarian
  // ('navegacion fuera del dominio'); este chequeo lo dice con la causa real.
  const dominios = new Set(trayectorias.map((t) => t.dominio.toLowerCase()));
  if (dominios.size > 1) {
    return { guardable: false, motivo: 'la tarea cruzo varios sitios y eso no se puede guardar desde su registro' };
  }

  const promocion = promoverTrayectoria({
    pasos: pasosCensuradosDesdeTrayectorias(trayectorias),
    dominio: ultima.dominio,
    objetivo: ultima.objetivo,
    estado: 'exitosa',
    exigeVerificacion: detectarVerboBloqueado(ultima.objetivo) !== null,
  });
  if (!promocion.promovida) return { guardable: false, motivo: promocion.motivo };
  return {
    guardable: true,
    pasos: promocion.pasos,
    firmaObjetivo: firmaDeObjetivo(ultima.objetivo),
    pasosSoloXpath: promocion.pasos
      .filter((paso) => paso.estrategias.length > 0 && paso.estrategias.every((e) => e.tipo === 'xpath'))
      .map((paso) => `paso ${paso.idx} (${paso.accion})`),
    metodosDescartados: promocion.metodosDescartados ?? [],
  };
}

/** Puerto de lectura de trayectorias (lo implementa TrayectoriasWebRepository). */
export interface TrayectoriasParaPromocion {
  listarPorJobConPasos(jobId: string, ownerId: string): Promise<TrayectoriaConPasos[]>;
}

/** Puerto de recetas (lo implementa RecetasWebRepository + el metodo de doble guardado). */
export interface RecetasParaPromocion {
  promover(input: NuevaRecetaWeb): Promise<RecetaWeb | null>;
  /** Id de una receta del owner creada desde alguna de estas trayectorias, o null. */
  buscarPorTrayectorias(ownerId: string, trayectoriaIds: readonly string[]): Promise<string | null>;
}

export interface PromocionTrayectoriaDeps {
  trayectorias: TrayectoriasParaPromocion;
  recetas: RecetasParaPromocion;
  /** Persiste el resultado del job (jobs.resultado, V026) antes del cierre. */
  guardarResultado(jobId: string, resultado: unknown): Promise<void>;
  logger: Logger;
}

/**
 * kind:'promover_trayectoria': punto de entrada del job. Lanza en fallo (execution.ts decide el
 * cierre); el llamador marca completed. IDEMPOTENTE ante el doble guardado: si ya existe una receta
 * creada desde estas trayectorias, termina ok sin crear otra (el endpoint tambien lo rechaza antes
 * de encolar; esta es la segunda capa, para la carrera entre dos encolados).
 */
export async function procesarJobDePromoverTrayectoria(
  deps: PromocionTrayectoriaDeps | undefined,
  job: Job,
): Promise<void> {
  if (!deps) {
    throw new PermanentExecutionError('la promocion de trayectorias no esta configurada en este worker');
  }
  const parsed = parsePromoverTrayectoriaJobPayload(job.payload);
  if (!parsed.success) {
    throw new PermanentExecutionError(`payload de promocion de trayectoria invalido: ${parsed.error}`);
  }
  const jobOrigenId = parsed.data.jobId;

  const trayectorias = await deps.trayectorias.listarPorJobConPasos(jobOrigenId, job.ownerId);
  const ultima = trayectorias[trayectorias.length - 1];
  if (ultima === undefined) {
    throw new PermanentExecutionError(
      'la tarea no tiene registro de lo que hizo (o ya se borro por retencion), asi que no se puede guardar como tarea aprendida',
    );
  }

  const yaGuardada = await deps.recetas.buscarPorTrayectorias(
    job.ownerId,
    trayectorias.map((t) => t.id),
  );
  if (yaGuardada !== null) {
    await deps.guardarResultado(job.id, {
      estado: 'ok',
      via: 'trayectoria',
      recetaId: yaGuardada,
      yaGuardada: true,
    });
    deps.logger.info('promocion de trayectoria: la tarea ya estaba guardada', {
      jobId: job.id,
      jobOrigenId,
      recetaId: yaGuardada,
    });
    return;
  }

  const conversion = convertirTrayectoriaPersistida(trayectorias);
  if (!conversion.guardable) {
    deps.logger.warn('promocion de trayectoria: no se pudo convertir en algo repetible', {
      jobId: job.id,
      jobOrigenId,
      motivo: conversion.motivo,
    });
    // PromocionNoRepetibleError lleva el prefijo estable en su `name`: describeError (execution.ts)
    // construye el last_error como `${name}: ${message}`, asi que el job queda empezando con
    // PROMOCION_NO_REPETIBLE_PREFIX y la consola muestra el motivo real sin invitar a reintentar.
    throw new PromocionNoRepetibleError(conversion.motivo);
  }

  // FAIL-OPEN de los metodos no representables (FIX A): la promocion no aborto por ellos, pero se deja
  // rastro de que gesto o tool desconocida se omitio al aprender la tarea. Sin esto, una receta con un
  // paso de menos se veria como si la corrida no lo hubiera tenido.
  if (conversion.metodosDescartados.length > 0) {
    deps.logger.info('promocion de trayectoria: se descartaron metodos no representables', {
      jobId: job.id,
      jobOrigenId,
      metodos: conversion.metodosDescartados,
    });
  }

  const receta = await deps.recetas.promover({
    ownerId: job.ownerId,
    dominio: ultima.dominio,
    firmaObjetivo: conversion.firmaObjetivo,
    // La descripcion (V037) es el objetivo GENERALIZADO: los valores parametrizados sustituidos por
    // sus nombres de parametro. Es lo que la pantalla de tareas ya sabidas muestra y lo que el
    // selector de tareas compara contra una peticion nueva; con los valores literales de la corrida
    // origen dentro, el selector descartaba el match (caso real, 28 jul 2026). No interviene en la
    // ejecucion.
    descripcion: descripcionGeneralizada(ultima.objetivo),
    pasos: conversion.pasos,
    creadaDesdeTrayectoria: ultima.id,
    origen: 'automatica',
  });

  await deps.guardarResultado(job.id, {
    estado: 'ok',
    via: 'trayectoria',
    recetaId: receta?.id ?? null,
    ...(conversion.pasosSoloXpath.length > 0 ? { pasosSoloXpath: conversion.pasosSoloXpath } : {}),
  });
  deps.logger.info('promocion de trayectoria: la tarea quedo guardada como aprendida', {
    jobId: job.id,
    jobOrigenId,
    dominio: ultima.dominio,
    recetaId: receta?.id ?? null,
    pasos: conversion.pasos.length,
    pasosSoloXpath: conversion.pasosSoloXpath.length,
  });
}
