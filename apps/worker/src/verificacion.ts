import {
  serializarDetencion,
  type CampoFaltante,
  type DetencionDeVerificacion,
  type MarcadorParametro,
  type PoliticaDeEjecucion,
} from '@ledesma-platform/shared';
import {
  contarParametrosDeclarados,
  extraerCorreos,
  extraerMontos,
  normalizarMonto,
  normalizarTexto,
  type MontoDeclarado,
  type ParametrosDeclarados,
} from './parametros-objetivo.js';
import { censurarValor } from './censura.js';
import type { PasoCensurado } from './trayectoria.js';

/**
 * VERIFICACION DETERMINISTA previa a ejecutar una accion que no se puede deshacer (CAMBIO 3) y
 * APLICACION DE LA POLITICA del usuario (CAMBIO 4).
 *
 * QUE SUSTITUYE Y POR QUE: hasta ahora toda accion de la lista bloqueada creaba un checkpoint que el
 * usuario tenia que aprobar CADA VEZ. El producto se opera en lenguaje natural y su usuario no es
 * tecnico: pedirle permiso en cada accion convierte la automatizacion en una lista de tareas
 * pendientes. La aprobacion por accion deja de ser el comportamiento por defecto (D1) y en su lugar
 * el sistema COMPARA MECANICAMENTE lo que el usuario pidio contra lo que hay en pantalla antes de
 * ejecutar. Coinciden: se ejecuta sin preguntar nada (el camino normal). No coinciden, o un dato
 * declarado no se puede leer del sitio: NO se ejecuta y se reporta con ambos valores (D2).
 *
 * QUE NO ES: no es aprobacion humana. Es comparacion de texto y de numeros hecha por codigo.
 *
 * POR QUE SIGUE HABIENDO UNA VERIFICACION: en produccion el modelo relanzo una tarea por su cuenta y
 * duplico un borrador, y reporto causas inexistentes al fallar. El modelo NO es una fuente confiable
 * de verdad sobre lo que hizo. Por eso (D4) el modelo puede proponer que hace, pero la lectura del
 * DOM y la comparacion final son deterministas y estan fuera de su alcance: no hay ninguna forma de
 * que el motor de navegacion se autorice a si mismo la ejecucion.
 *
 * QUE NO SE TOCA: aprobaciones_web e intervenciones_art22 (V027) siguen intactas y en uso en el
 * camino de reanudacion tras decision humana; AprobacionNoAprobadaError sigue siendo el unico
 * candado de ese camino. Esta verificacion es un camino NUEVO para la corrida inicial, no un
 * reemplazo del registro de intervenciones (que es cumplimiento Art.22 y LFPDPPP).
 */

/** La politica vigente durante una tarea (los tres ajustes de D3). */
export type PoliticaVigente = PoliticaDeEjecucion;

/**
 * PUERTO de lectura de la politica del owner. Lo implementa PoliticasEjecucionRepository (V034),
 * cableado en index.ts; los tests pasan fakes. Devuelve null si el usuario nunca configuro nada
 * (se usan los defaults SIN crear la fila, D3).
 */
export interface RepositorioPoliticasParaWorker {
  obtenerPorOwner(ownerId: string): Promise<PoliticaVigente | null>;
}

/** Un campo del formulario tal como se leyo del DOM (valor actual + su contexto textual). */
export interface CampoDeLaPagina {
  /**
   * Todo lo que identifica al campo para una persona: name, id, tipo, placeholder, aria-label y la
   * etiqueta asociada, concatenados. Es lo que decide si el campo es "el destinatario" o "el monto".
   */
  contexto: string;
  /** Valor ACTUAL del campo. Los campos de contrasena jamas se leen (ver browserbase.ts). */
  valor: string;
  /**
   * El campo EXISTE pero su valor no se pudo determinar (CAMBIO 2): tiene chips u otro contenido
   * comprometido del que el lector no extrajo ningun dato. NO es lo mismo que vacio: un campo vacio
   * esta por escribirse (la tarea sigue); uno no leible no se puede comprobar (la tarea se detiene).
   */
  noLeible?: boolean;
}

/** Foto de solo lectura de la pagina en el momento previo a ejecutar la accion. */
export interface EstadoDeLaPagina {
  campos: CampoDeLaPagina[];
  /** Texto visible de la pagina, acotado. Evidencia DEBIL: lo escribe el sitio, no el agente. */
  texto: string;
}

/** Nombre de negocio de un parametro comparable (el que se le muestra al usuario). */
export type NombreDeParametro =
  | 'destinatario'
  | 'monto'
  | 'producto'
  | 'cantidad'
  | 'asunto'
  | 'cuerpo';

/** Una comparacion concreta: que se pidio, que habia, y si son lo mismo. */
export interface Comparacion {
  parametro: NombreDeParametro;
  pedido: string;
  encontrado: string;
  coincide: boolean;
  /**
   * El dato pedido TODAVIA NO ESTA en la pagina: nadie lo escribio (CAMBIO 1). Es la distincion que
   * separa "el formulario esta a medio llenar" (la tarea sigue, el agente termina de llenarlo) de
   * "hay OTRO valor donde deberia estar el mio" (eso detiene la tarea en seco y se reporta).
   */
  ausente: boolean;
  /**
   * El campo del parametro existe pero su valor NO SE PUDO LEER (CAMBIO 2): no hay con que comparar
   * y tampoco se puede afirmar que falte escribirlo. Detiene la tarea diciendo exactamente eso.
   */
  noLeible?: boolean;
}

/**
 * Resultado de la verificacion:
 *  - 'ejecutar': los N parametros declarados estan en la pagina y coinciden; la accion pasa.
 *  - 'incompleto' (CAMBIO 1): falta escribir alguno de los datos declarados. La accion NO pasa, pero
 *    NO es un fallo: la tarea sigue para que el agente termine de llenar los campos.
 *  - 'detener': la tarea termina sin ejecutar, con el motivo que se le reporta al usuario.
 */
export type Veredicto =
  | { tipo: 'ejecutar'; comparaciones: Comparacion[] }
  | { tipo: 'incompleto'; comparaciones: Comparacion[]; faltantes: NombreDeParametro[] }
  | { tipo: 'detener'; detencion: DetencionDeVerificacion; comparaciones: Comparacion[] };

/**
 * Parametro que una accion EXIGE declarar en el objetivo. La exigencia se deriva del VERBO que el
 * usuario escribio (deteccion determinista sobre SU texto), jamas del mensaje del modelo: si el
 * requisito dependiera de lo que el modelo dice que va a hacer, bastaria con que dijera otra cosa.
 *
 * Solo dos exigencias, las que no tienen lectura alternativa: a quien se le envia algo y cuanto
 * dinero se mueve. Comprar o borrar no exigen un parametro fijo (el objetivo puede describirlos de
 * mil formas legitimas); ahi protegen la comparacion de lo que SI se declaro y el tope de monto.
 */
const PARAMETRO_REQUERIDO_POR_VERBO: Readonly<Record<string, CampoFaltante>> = {
  enviar: 'destinatario',
  send: 'destinatario',
  pagar: 'monto',
  pay: 'monto',
  transferir: 'monto',
  transfer: 'monto',
};

/** Los marcadores que se reconocen por el CONTEXTO de un campo. `producto` no: ver mas abajo. */
type MarcadorDeContexto = Extract<
  MarcadorParametro,
  'destinatario' | 'monto' | 'cantidad' | 'asunto' | 'cuerpo'
>;

/**
 * LOS VOCABULARIOS DE CONTEXTO, uno por marcador comparable: las palabras que, dentro del contexto
 * de un campo, lo delatan como el destinatario, el monto, la cantidad, el asunto o el cuerpo.
 *
 * VIVEN COMO LISTA Y NO COMO REGEX ESCRITA A MANO porque no son solo de este modulo: la tabla que
 * mapea el NOMBRE DE CLASE de una ranura a su marcador (MARCADOR_POR_NOMBRE_DE_CLASE,
 * packages/shared/src/plantillas/contrato.ts) declara estar sembrada de estos mismos vocabularios,
 * y las dos copias habian divergido en silencio: la verificacion trataba un campo "Correo
 * electronico" como destinatario y la tabla no le daba marcador, asi que ese campo se comparaba
 * como destinatario pero no se podia publicar como ranura de destinatario. Exportarlos permite que
 * un test compare los dos lados termino por termino (simetria-vocabularios.test.ts) y que una
 * divergencia futura falle en CI en vez de descubrirse con una investigacion.
 *
 * NO ENTRA aqui el vocabulario de REMITENTE: no nombra un marcador, es la EXCLUSION que impide
 * comparar la direccion del propio usuario como si fuera un destinatario.
 */
export const VOCABULARIO_DE_CONTEXTO: Readonly<Record<MarcadorDeContexto, readonly string[]>> = {
  destinatario: [
    'to',
    'para',
    'destinatario',
    'destinatarios',
    'recipient',
    'recipients',
    'cc',
    'bcc',
    'cco',
    'correo',
    'email',
    'e-mail',
    'mail',
  ],
  monto: [
    'monto',
    'importe',
    'total',
    'precio',
    'price',
    'amount',
    'pago',
    'payment',
    'cobro',
    'cargo',
    'subtotal',
  ],
  cantidad: ['cantidad', 'cant', 'quantity', 'qty', 'unidades', 'units', 'piezas'],
  asunto: ['asunto', 'subject', 'subjectbox', 'titulo', 'title'],
  cuerpo: ['cuerpo', 'mensaje', 'message', 'body', 'texto', 'contenido', 'content', 'redaccion'],
};

/** El patron de un vocabulario: la palabra completa, sobre el contexto ya normalizado del campo. */
function patronDeContexto(terminos: readonly string[]): RegExp {
  return new RegExp(`\\b(${terminos.join('|')})\\b`);
}

/**
 * Contexto de un campo que lo delata como DESTINATARIO de la accion (para/to/cc/bcc/correo). Se
 * evalua sobre el contexto NORMALIZADO del campo.
 */
const CONTEXTO_DESTINATARIO = patronDeContexto(VOCABULARIO_DE_CONTEXTO.destinatario);

/**
 * Contexto de un campo que es el REMITENTE, no el destinatario. Se excluye explicitamente: la
 * direccion del propio usuario aparece en casi todo formulario de correo y compararla como si fuera
 * un destinatario detendria TODOS los envios legitimos.
 */
const CONTEXTO_REMITENTE = /\b(from|remitente|reply[-\s]?to|sender|responder a)\b/;

/** Contexto de un campo de DINERO: ahi un numero pelado (sin simbolo) si es un monto, en MXN. */
const CONTEXTO_MONTO = patronDeContexto(VOCABULARIO_DE_CONTEXTO.monto);

/** Contexto de un campo de CANTIDAD (numero de unidades). */
const CONTEXTO_CANTIDAD = patronDeContexto(VOCABULARIO_DE_CONTEXTO.cantidad);

/** Contexto de un campo de ASUNTO (el titulo de un mensaje). */
const CONTEXTO_ASUNTO = patronDeContexto(VOCABULARIO_DE_CONTEXTO.asunto);

/**
 * Contexto de un campo de CUERPO de mensaje. Incluye los nombres que usan los redactores modernos
 * (contenteditable con aria-label "Cuerpo del mensaje" / "Message Body"), que es donde el agente
 * escribe el texto en un sitio de correo real.
 */
const CONTEXTO_CUERPO = patronDeContexto(VOCABULARIO_DE_CONTEXTO.cuerpo);

/** Tolerancia de la comparacion numerica de montos (medio centavo). */
const TOLERANCIA_MONTO = 0.005;

/** Moneda del tope configurable. Un monto en otra moneda no es comparable contra un limite en MXN. */
const MONEDA_DEL_TOPE = 'MXN';

/** Detencion sin comparaciones (los criterios que ni llegan a comparar: politica y dato faltante). */
function detener(detencion: DetencionDeVerificacion): Veredicto {
  return { tipo: 'detener', detencion, comparaciones: [] };
}

/** Formatea un monto para mostrarselo al usuario (sin locale: estable en logs y en la consola). */
function formatearMonto(valor: number, moneda: string | null): string {
  const numero = Number.isInteger(valor) ? String(valor) : valor.toFixed(2);
  return moneda === null ? numero : `${numero} ${moneda}`;
}

/** Campos cuyo contexto los delata como destinatarios (y no como remitentes). */
function camposDeDestinatario(campos: CampoDeLaPagina[]): CampoDeLaPagina[] {
  return campos.filter((campo) => {
    const contexto = normalizarTexto(campo.contexto);
    return CONTEXTO_DESTINATARIO.test(contexto) && !CONTEXTO_REMITENTE.test(contexto);
  });
}

/**
 * MONTOS que la accion comprometeria, leidos de los VALORES DE LOS CAMPOS (lo que el agente tecleo o
 * eligio). Dos vias: un valor con simbolo o nombre de moneda, y un numero pelado en un campo cuyo
 * contexto es de dinero (ahi el numero ES el monto, en la moneda del tope).
 *
 * El texto libre de la pagina NO entra aca a proposito: los precios de un catalogo dispararian el
 * tope en cada tarea. El tope acota lo que la accion COMPROMETE, no lo que la pagina muestra.
 */
export function montosEnCampos(campos: CampoDeLaPagina[]): MontoDeclarado[] {
  const montos: MontoDeclarado[] = [];
  for (const campo of campos) {
    const conMoneda = extraerMontos(campo.valor);
    if (conMoneda.length > 0) {
      montos.push(...conMoneda);
      continue;
    }
    if (CONTEXTO_MONTO.test(normalizarTexto(campo.contexto))) {
      const valor = normalizarMonto(campo.valor);
      if (valor !== null && valor > 0) {
        montos.push({ valor, moneda: MONEDA_DEL_TOPE, texto: campo.valor.trim() });
      }
    }
  }
  return montos;
}

/** ¿El dominio esta excluido por el usuario? Coincide el dominio exacto y cualquier subdominio suyo. */
export function dominioExcluido(dominio: string, excluidos: string[]): string | null {
  const objetivo = normalizarTexto(dominio);
  for (const crudo of excluidos) {
    const excluido = normalizarTexto(crudo);
    if (excluido === '') continue;
    if (objetivo === excluido || objetivo.endsWith(`.${excluido}`)) return excluido;
  }
  return null;
}

/** Todos los valores de campos mas el texto visible: donde se busca un producto o una cantidad. */
function textosDeLaPagina(pagina: EstadoDeLaPagina): string[] {
  return [...pagina.campos.map((c) => c.valor), pagina.texto];
}

/**
 * VERIFICACION COMPLETA previa a ejecutar (D2 + D3). Funcion PURA: recibe la politica, el objetivo
 * ya parseado y la foto del DOM, y devuelve el veredicto. No navega, no escribe y no llama al modelo.
 *
 * Orden de los criterios, del mas barato y mas categorico al mas fino:
 *  1. el usuario apago las acciones irreversibles;
 *  2. el dominio esta excluido;
 *  3. la accion exige un dato que el objetivo nunca declaro;
 *  4. no se pudo leer la pagina (nunca se ejecuta a ciegas) -> 'noLeible';
 *  5. un monto comprometido supera el tope configurado;
 *  6. algun parametro declarado tiene en pantalla un valor DISTINTO del pedido;
 *  6.5. el campo de un parametro declarado existe pero no se pudo leer -> 'noLeible' (CAMBIO 2);
 *  7. algun parametro declarado todavia no esta en pantalla -> 'incompleto' (la tarea sigue).
 */
export function verificarAccion(entrada: {
  politica: PoliticaVigente;
  dominio: string;
  /** Verbo de accion bloqueada detectado en el OBJETIVO del usuario, o null. */
  verbo: string | null;
  parametros: ParametrosDeclarados;
  /** Foto del DOM. null = no se pudo leer. */
  pagina: EstadoDeLaPagina | null;
}): Veredicto {
  const { politica, parametros, pagina } = entrada;

  if (!politica.ejecutarAccionesIrreversibles) {
    return detener({ motivo: 'accionesDesactivadas' });
  }

  const excluido = dominioExcluido(entrada.dominio, politica.sitiosExcluidos);
  if (excluido !== null) {
    return detener({ motivo: 'sitioExcluido', dominio: excluido });
  }

  // 3. Dato que la accion exige y el objetivo no declaro. Se evalua ANTES de mirar la pagina: si el
  //    usuario no dijo a quien enviarle, no hay nada contra que comparar y el sitio no puede suplirlo.
  const requerido = entrada.verbo === null ? undefined : PARAMETRO_REQUERIDO_POR_VERBO[entrada.verbo];
  if (requerido === 'destinatario' && parametros.destinatarios.length === 0) {
    return detener({ motivo: 'faltaDato', campo: 'destinatario' });
  }
  if (requerido === 'monto' && parametros.monto === null) {
    return detener({ motivo: 'faltaDato', campo: 'monto' });
  }

  if (pagina === null) {
    // Sin foto del DOM no hay verificacion posible. Jamas se ejecuta a ciegas. Es un NO LEIBLE
    // (CAMBIO 2), no un "no coincide": decirle al usuario que "en el sitio aparecia nada" cuando lo
    // que paso es que no se pudo leer manda a diagnosticar lo que no fue.
    //
    // SIN `campo`, a proposito (FIX C, caso real de produccion del 3 ago 2026): lo que no se pudo
    // leer fue LA PAGINA (una sesion de navegador degradada), no un dato del usuario. Nombrar aqui el
    // primer parametro declarado hacia que la consola dijera "No pudimos leer a quien enviarlo"
    // cuando el destinatario estaba escrito y visible; con el campo ausente la consola dice que la
    // pagina no se pudo leer y que se reintentara, que es lo que paso.
    return detener({
      motivo: 'noLeible',
      detalle: 'no se pudo leer el estado de la pagina antes de ejecutar',
    });
  }

  // 5. TOPE: los montos que la accion comprometeria (los del objetivo y los de los campos). Un monto
  //    en una moneda distinta a la del tope NO es comparable contra un limite en MXN: se detiene
  //    (falla cerrada), nunca se asume que "30 USD" cabe en un tope de 500.
  const montos = [...(parametros.monto ? [parametros.monto] : []), ...montosEnCampos(pagina.campos)];
  for (const monto of montos) {
    const superaElTope = monto.valor > politica.topeMontoSinConfirmacion;
    const monedaDistinta = monto.moneda !== null && monto.moneda !== MONEDA_DEL_TOPE;
    if (superaElTope || monedaDistinta) {
      return detener({
        motivo: 'topeExcedido',
        monto: formatearMonto(monto.valor, monto.moneda),
        tope: formatearMonto(politica.topeMontoSinConfirmacion, MONEDA_DEL_TOPE),
        ...(monedaDistinta && !superaElTope
          ? { detalle: 'monto en una moneda distinta a la del tope configurado' }
          : {}),
      });
    }
  }

  // 6. COMPARACION de cada parametro declarado contra el DOM. Un valor DISTINTO del pedido detiene la
  //    tarea (es una accion distinta a la que se pidio, y puede ser una pagina que sustituyo el dato).
  const comparaciones = compararParametros(parametros, pagina);
  // Un parametro NO LEIBLE no es un valor DISTINTO (no hay valor con que discrepar): se resuelve en
  // el paso 6.5 con su propio motivo, no como noCoincide.
  const discordante = comparaciones.find((c) => !c.coincide && !c.ausente && c.noLeible !== true);
  if (discordante !== undefined) {
    return {
      tipo: 'detener',
      detencion: {
        motivo: 'noCoincide',
        pedido: discordante.pedido,
        encontrado: discordante.encontrado,
        detalle: `el parametro ${discordante.parametro} no coincide`,
      },
      comparaciones,
    };
  }

  // 6.5. NO LEIBLE (CAMBIO 2): el campo de un parametro declarado existe pero su valor no se pudo
  //      determinar. No se puede comprobar y no se puede afirmar que falte escribirlo: la tarea se
  //      detiene DICIENDO eso, en vez de girar para siempre como 'incompleto' o de reportar que "en
  //      el sitio aparecia nada" (el falso diagnostico de la evidencia de produccion).
  const ilegible = comparaciones.find((c) => !c.coincide && c.noLeible === true);
  if (ilegible !== undefined) {
    return {
      tipo: 'detener',
      detencion: {
        motivo: 'noLeible',
        campo: ilegible.parametro,
        detalle: `el campo ${ilegible.parametro} existe en la pagina pero su valor no se pudo leer`,
      },
      comparaciones,
    };
  }

  // 7. TODOS LOS PARAMETROS DECLARADOS O NINGUNA ACCION (CAMBIO 1). La verificacion solo se supera
  //    cuando los N parametros que el objetivo declaro estan en la pagina y coinciden. Dos guardas:
  //    los que faltan por escribir, y la INVARIANTE de que se comparo uno por cada declarado (si un
  //    parametro nuevo se agregara al extractor sin su comparacion, esto lo detiene en vez de
  //    dejarlo pasar sin mirar). En produccion la accion paso con 1 de 3 datos en pantalla: el
  //    correo se envio a medio escribir y el resto de la corrida quedo inutilizable.
  const faltantes = comparaciones.filter((c) => !c.coincide).map((c) => c.parametro);
  const declarados = contarParametrosDeclarados(parametros);
  if (faltantes.length > 0 || comparaciones.length < declarados) {
    return { tipo: 'incompleto', comparaciones, faltantes };
  }

  return { tipo: 'ejecutar', comparaciones };
}

/**
 * ¿La accion irreversible SURTIO EFECTO? (CAMBIO 4, endurecido en CAMBIO 2). Se responde LEYENDO EL
 * DOM despues de ejecutar, jamas preguntandole al modelo. Se exige AL MENOS UNO de dos criterios:
 *  1. el sitio muestra un aviso EXPLICITO de exito ("mensaje enviado", "pago realizado");
 *  2. el CONTENEDOR de la accion desaparecio del DOM: la ventana de redaccion (o el formulario de
 *     pago) se cerro, que es como se ve una accion consumada.
 * Si ninguno se cumple, la accion NO esta confirmada y se reporta como tal. Jamas se asume exito.
 *
 * QUE SE RETIRO Y POR QUE (evidencia de produccion): antes bastaba con que TODOS los campos
 * comparados quedaran vacios. Ese estado no distingue una accion consumada de un simple cambio de
 * representacion del dato: Gmail convierte el destinatario tecleado en un CHIP y el lector de campos
 * leia cadena vacia, asi que "el dato ya no esta donde estaba" se leia como "la accion se consumo" y
 * un correo jamas enviado se reporto como enviado. Un token, un autocompletado o un campo que se
 * deshabilita producen exactamente el mismo estado. HOY el lector ademas LEE los chips como valor
 * del campo (browserbase.ts), asi que un dato vuelto chip sigue presente en la foto y ya no puede
 * confundirse con un contenedor que desaparecio; el criterio estricto de abajo queda como esta.
 *
 * Tambien se retiro el ultimo recurso "la pagina cambio": entre dos lecturas del DOM casi cualquier
 * pagina viva cambia (un reloj, un contador, un aviso), asi que era evidencia de nada.
 */
export function accionSurtioEfecto(entrada: {
  parametros: ParametrosDeclarados;
  /** Foto tomada JUSTO ANTES de ejecutar (la de la verificacion previa). */
  antes: EstadoDeLaPagina;
  /** Foto tomada DESPUES de ejecutar. */
  despues: EstadoDeLaPagina;
}): boolean {
  return desenlaceDelEfecto(entrada) === 'confirmado';
}

/**
 * Los TRES desenlaces del clic irreversible (FIX B):
 *  - 'confirmado': el sitio mostro su aviso de exito, O el formulario cuyos campos se verificaron
 *    DESAPARECIO del DOM. Para una accion de envio, que Gmail cierre el compose ES el exito esperado
 *    (evidencia del 27 jul: exigir ademas que los datos declarados no fueran legibles en la pagina
 *    hacia inconfirmable un envio real, porque el hilo muestra el mensaje recien enviado).
 *  - 'formulario_presente': la pagina cambio o no, pero el formulario verificado sigue en el DOM
 *    (incluido un compose MINIMIZADO: sus campos siguen presentes aunque colapsados, porque el
 *    lector incluye campos ocultos a proposito). Sin efecto.
 *  - 'sin_rastro_previo': no habia campos verificados antes de ejecutar; no hay contenedor cuyo
 *    cierre pueda confirmar nada. Sin efecto (nunca se asume exito).
 */
export type DesenlaceDelEfecto = 'confirmado' | 'formulario_presente' | 'sin_rastro_previo';

export function desenlaceDelEfecto(entrada: {
  parametros: ParametrosDeclarados;
  antes: EstadoDeLaPagina;
  despues: EstadoDeLaPagina;
}): DesenlaceDelEfecto {
  if (PATRON_CONFIRMACION.test(normalizarTexto(entrada.despues.texto))) return 'confirmado';
  const formulario = camposDelFormularioVerificado(entrada.parametros, entrada.antes);
  if (formulario.length === 0) return 'sin_rastro_previo';
  const presentes = new Set(entrada.despues.campos.map(claveDeCampo));
  return formulario.some((campo) => presentes.has(claveDeCampo(campo)))
    ? 'formulario_presente'
    : 'confirmado';
}

/** Identidad de un campo entre dos fotos: su contexto normalizado (name/id/tipo/rotulo). */
function claveDeCampo(campo: CampoDeLaPagina): string {
  return normalizarTexto(campo.contexto);
}

/**
 * Los campos del FORMULARIO VERIFICADO: los de la foto previa cuyo valor contiene alguno de los
 * datos de texto que el usuario declaro (los mismos que la verificacion determinista comparo). Son
 * el contenedor cuya desaparicion confirma la accion y cuya presencia la niega. Si ningun campo
 * contiene un dato declarado (o el objetivo no declaro texto), el formulario verificado son TODOS
 * los campos previos: es el comportamiento anterior y evita que un campo ajeno persistente (una
 * barra de busqueda llena) vuelva inconfirmable el cierre del redactor.
 *
 * Montos y cantidades quedan FUERA a proposito: un numero aparece en cualquier parte de una pagina
 * (totales, historial, saldos) y no identifica al formulario.
 */
export function camposDelFormularioVerificado(
  parametros: ParametrosDeclarados,
  antes: EstadoDeLaPagina,
): CampoDeLaPagina[] {
  if (antes.campos.length === 0) return [];
  const declarados = [
    ...parametros.destinatarios,
    ...(parametros.producto !== null ? [parametros.producto] : []),
    ...(parametros.asunto !== null ? [parametros.asunto] : []),
    ...(parametros.cuerpo !== null ? [parametros.cuerpo] : []),
  ]
    .map(normalizarTexto)
    .filter((valor) => valor !== '');
  const delFormulario = antes.campos.filter((campo) => {
    const valor = normalizarTexto(campo.valor);
    return valor !== '' && declarados.some((declarado) => valor.includes(declarado));
  });
  return delFormulario.length > 0 ? delFormulario : antes.campos;
}

/**
 * DOBLE SEGURIDAD del reintento (FIX A): ¿el formulario con los datos verificados SIGUE presente?
 * Si ya no esta, la accion probablemente surtio efecto con retraso y reintentarla podria duplicarla:
 * el llamador NO reintenta y termina reportando al usuario que verifique el resultado en el sitio.
 */
export function formularioVerificadoPresente(
  parametros: ParametrosDeclarados,
  antes: EstadoDeLaPagina,
  ahora: EstadoDeLaPagina,
): boolean {
  const formulario = camposDelFormularioVerificado(parametros, antes);
  if (formulario.length === 0) return false;
  const presentes = new Set(ahora.campos.map(claveDeCampo));
  return formulario.some((campo) => presentes.has(claveDeCampo(campo)));
}

/**
 * CONFIRMACION que un sitio muestra tras consumar la accion. Deliberadamente acotada a las formas en
 * que un sitio dice que YA lo hizo: palabras genericas ("listo", "confirmacion") aparecen tambien
 * ANTES de ejecutar y darian por hecha una accion que nunca ocurrio.
 */
const PATRON_CONFIRMACION =
  /\b(?:mensaje enviado|correo enviado|se envio|enviado con exito|enviada correctamente|message sent|email sent|pago (?:realizado|enviado|exitoso|aprobado)|payment (?:sent|complete|completed|successful)|transferencia (?:realizada|enviada|exitosa)|compra (?:realizada|confirmada|exitosa)|gracias por tu compra|pedido (?:confirmado|realizado)|order (?:confirmed|placed)|se elimino|eliminado correctamente|deleted successfully|publicado correctamente|published successfully)\b/;

/**
 * Compara cada parametro DECLARADO contra la pagina. Un parametro no declarado no genera comparacion
 * (no hay nada que verificar); un parametro declarado que no se puede leer del DOM genera una
 * comparacion FALLIDA con "encontrado" vacio (D2: si no se puede leer, no se ejecuta).
 */
function compararParametros(
  parametros: ParametrosDeclarados,
  pagina: EstadoDeLaPagina,
): Comparacion[] {
  const comparaciones: Comparacion[] = [];

  // DESTINATARIO: conjunto exacto. Los correos se leen SOLO de los campos de destinatario (lo que el
  // agente puso), nunca del texto de la pagina. La igualdad es de CONJUNTO, no de inclusion: un
  // correo de mas (un cc agregado por la pagina, un destinatario que el usuario no pidio) es una
  // accion distinta a la pedida y detiene la tarea igual que un correo equivocado.
  if (parametros.destinatarios.length > 0) {
    const campos = camposDeDestinatario(pagina.campos);
    const enPagina = extraerCorreos(campos.map((c) => c.valor).join(' '));
    const pedidos = [...parametros.destinatarios].sort();
    const encontrados = [...enPagina].sort();
    // Sin ningun correo legible, un campo de destinatario NO LEIBLE (CAMBIO 2) manda: no se puede
    // afirmar que falte escribirlo (quiza ya esta, en un chip que no se pudo leer) ni compararlo.
    const noLeible = encontrados.length === 0 && campos.some((c) => c.noLeible === true);
    comparaciones.push({
      parametro: 'destinatario',
      pedido: pedidos.join(', '),
      encontrado: encontrados.join(', '),
      coincide: encontrados.length > 0 && pedidos.join('|') === encontrados.join('|'),
      ausente: encontrados.length === 0 && !noLeible,
      ...(noLeible ? { noLeible: true } : {}),
    });
  }

  // MONTO: comparacion NUMERICA (tras limpiar simbolos y separadores) contra los montos de los
  // campos y, si ahi no hubiera ninguno, contra los del texto visible (el total de un checkout suele
  // ser texto, no un campo). El texto es evidencia mas debil y por eso es el ultimo recurso.
  if (parametros.monto !== null) {
    const declarado = parametros.monto;
    const deCampos = montosEnCampos(pagina.campos);
    const candidatos = deCampos.length > 0 ? deCampos : extraerMontos(pagina.texto);
    const coincide = candidatos.some(
      (m) => Math.abs(m.valor - declarado.valor) < TOLERANCIA_MONTO,
    );
    // Un campo de dinero NO LEIBLE sin ningun monto legible en la pagina: no se puede comprobar.
    const noLeible =
      candidatos.length === 0 &&
      pagina.campos.some(
        (c) => c.noLeible === true && CONTEXTO_MONTO.test(normalizarTexto(c.contexto)),
      );
    comparaciones.push({
      parametro: 'monto',
      pedido: formatearMonto(declarado.valor, declarado.moneda),
      encontrado: candidatos.map((m) => formatearMonto(m.valor, m.moneda)).join(', '),
      coincide,
      ausente: candidatos.length === 0 && !noLeible,
      ...(noLeible ? { noLeible: true } : {}),
    });
  }

  // PRODUCTO: el nombre entrecomillado debe APARECER (comparacion textual normalizada) en un valor
  // de campo o en el texto visible de la pagina.
  if (parametros.producto !== null) {
    const buscado = normalizarTexto(parametros.producto);
    const textos = textosDeLaPagina(pagina).map(normalizarTexto);
    const coincide = buscado !== '' && textos.some((t) => t.includes(buscado));
    comparaciones.push({
      parametro: 'producto',
      pedido: parametros.producto,
      encontrado: coincide ? parametros.producto : '',
      coincide,
      // Es una comparacion de PRESENCIA: si el nombre no aparece, es que todavia no esta en la
      // pagina. No hay un "otro producto" con el que discrepar.
      ausente: !coincide,
    });
  }

  // CANTIDAD: el valor de un campo de cantidad debe ser exactamente el numero pedido. Sin campo de
  // cantidad no se puede verificar y la comparacion falla (nunca se asume "seguro era 1").
  if (parametros.cantidad !== null) {
    const campos = pagina.campos.filter((c) => CONTEXTO_CANTIDAD.test(normalizarTexto(c.contexto)));
    const valores = campos
      .map((c) => normalizarMonto(c.valor))
      .filter((v): v is number => v !== null);
    // Un campo de cantidad NO LEIBLE sin ningun valor legible: no se puede comprobar.
    const noLeible = valores.length === 0 && campos.some((c) => c.noLeible === true);
    comparaciones.push({
      parametro: 'cantidad',
      pedido: String(parametros.cantidad),
      encontrado: valores.join(', '),
      coincide: valores.length > 0 && valores.every((v) => v === parametros.cantidad),
      ausente: valores.length === 0 && !noLeible,
      ...(noLeible ? { noLeible: true } : {}),
    });
  }

  // ASUNTO y CUERPO (CAMBIO 1): lo que el agente TECLEO en el redactor. Se buscan en los campos cuyo
  // contexto los nombra y, si el sitio no los rotula, en el resto de los campos; el texto visible NO
  // entra (lo escribe el sitio, no el agente, y en un hilo de correo mostraria el mensaje anterior).
  // Comparacion de PRESENCIA (el valor declarado aparece dentro del campo): una firma automatica
  // pegada al final del cuerpo no debe leerse como que el usuario pidio otra cosa.
  if (parametros.asunto !== null) {
    comparaciones.push(compararTextoTecleado('asunto', parametros.asunto, pagina, CONTEXTO_ASUNTO));
  }
  if (parametros.cuerpo !== null) {
    comparaciones.push(compararTextoTecleado('cuerpo', parametros.cuerpo, pagina, CONTEXTO_CUERPO));
  }

  return comparaciones;
}

/** Tope del valor leido del DOM que viaja en una comparacion (el mensaje de detencion ya se acota). */
const MAX_ENCONTRADO_CHARS = 200;

/**
 * Compara un texto DECLARADO (asunto, cuerpo) contra lo que hay tecleado en la pagina. Los candidatos
 * son los campos cuyo contexto nombra al parametro y, si el sitio no rotula ninguno, TODOS los campos:
 * un redactor que no dice como se llama su caja de texto no puede volver imposible la verificacion.
 */
function compararTextoTecleado(
  parametro: NombreDeParametro,
  declarado: string,
  pagina: EstadoDeLaPagina,
  contexto: RegExp,
): Comparacion {
  const rotulados = pagina.campos.filter((c) => contexto.test(normalizarTexto(c.contexto)));
  const candidatos = (rotulados.length > 0 ? rotulados : pagina.campos).filter(
    (c) => c.valor.trim() !== '',
  );
  const buscado = normalizarTexto(declarado);
  const coincide =
    buscado !== '' && candidatos.some((c) => normalizarTexto(c.valor).includes(buscado));
  // El campo rotulado del parametro es NO LEIBLE y ninguno de los rotulados tiene un valor legible:
  // no se puede comprobar (CAMBIO 2). Con algun rotulado legible, ese valor decide como siempre.
  const noLeible =
    !coincide &&
    rotulados.some((c) => c.noLeible === true) &&
    rotulados.every((c) => c.valor.trim() === '');
  return {
    parametro,
    pedido: declarado,
    // Solo se reporta lo que hay tecleado en los campos ROTULADOS: volcar el valor de cualquier campo
    // de la pagina en el mensaje de la detencion filtraria datos que nadie pidio comparar.
    encontrado: coincide
      ? declarado
      : rotulados
          .map((c) => c.valor.trim())
          .filter((v) => v !== '')
          .join(' ')
          .slice(0, MAX_ENCONTRADO_CHARS),
    coincide,
    ausente: !coincide && !noLeible,
    ...(noLeible ? { noLeible: true } : {}),
  };
}

/** Mensaje de cierre del job cuando la accion se detiene (contrato estable con la consola). */
export function mensajeDeDetencion(veredicto: Extract<Veredicto, { tipo: 'detener' }>): string {
  return serializarDetencion(censurarDetencion(veredicto.detencion));
}

/**
 * Mensaje de una verificacion INCOMPLETA (CAMBIO 1). NO es una detencion y por eso NO lleva el
 * prefijo del contrato con la consola: la tarea no termino, solo que esta accion no puede pasar
 * todavia. Nombra los parametros que faltan, JAMAS sus valores ni nada leido de la pagina (este
 * texto vuelve al modelo como resultado de su herramienta).
 */
export function mensajeDeIncompleto(veredicto: Extract<Veredicto, { tipo: 'incompleto' }>): string {
  const faltan = veredicto.faltantes.join(', ');
  return (
    'la verificacion previa del sistema todavia no se supera y la accion NO se ejecuto: ' +
    (faltan === ''
      ? 'la pagina no muestra todos los datos que pidio el usuario'
      : `faltan datos del objetivo por escribir en la pagina (${faltan})`) +
    '. Termina de completar esos datos en el formulario y despues vuelve a intentar esta misma ' +
    'accion; no busques otra ruta ni des la tarea por terminada.'
  );
}

/**
 * Aplica la CENSURA existente a los valores que salen de este proceso (mismo criterio que la traza
 * de trayectorias): un numero con pinta de tarjeta jamas llega ni al mensaje del usuario ni a la
 * base, aunque el usuario lo haya dictado en el objetivo o el agente lo haya tecleado en un campo.
 */
function censurarDetencion(detencion: DetencionDeVerificacion): DetencionDeVerificacion {
  const censurado: DetencionDeVerificacion = { motivo: detencion.motivo };
  for (const clave of ['pedido', 'encontrado', 'monto', 'tope', 'dominio', 'detalle'] as const) {
    const valor = detencion[clave];
    if (typeof valor === 'string') censurado[clave] = censurarValor(valor, clave);
  }
  if (detencion.campo !== undefined) censurado.campo = detencion.campo;
  return censurado;
}

/**
 * El resultado de la verificacion como UN PASO de la trayectoria (V030), con los valores comparados
 * y su veredicto. Los valores pasan por la MISMA censura que el resto de la traza antes de salir del
 * proceso. Deja constancia de por que una accion se ejecuto o no, que es exactamente lo que hay que
 * poder auditar despues.
 */
export function construirPasoDeVerificacion(veredicto: Veredicto): PasoCensurado {
  const detalle =
    veredicto.tipo === 'ejecutar'
      ? 'verificacion previa: los datos coinciden con lo pedido'
      : veredicto.tipo === 'incompleto'
        ? `verificacion previa: faltan datos por escribir (${veredicto.faltantes.join(', ')})`
        : `verificacion previa: la accion se detuvo (${veredicto.detencion.motivo})`;
  return {
    idx: 0,
    accion: {
      tipo: 'verificacion',
      instruccion: detalle,
      metodo: null,
      argumentos: veredicto.comparaciones.map((c) =>
        [
          c.parametro,
          censurarValor(c.pedido, c.parametro),
          censurarValor(c.encontrado, c.parametro),
          c.coincide ? 'coincide' : 'no coincide',
        ].join(': '),
      ),
    },
    selector: null,
    valorCensurado: null,
    // La verificacion no toca ningun elemento: no hay nada que volver a localizar.
    estrategias: [],
    url: null,
    exito: veredicto.tipo === 'ejecutar',
  };
}

/**
 * UNA DECISION DE LA GUARDIA que no nace de comparar, como PASO de la trayectoria (CAMBIO 4): el
 * cupo ya consumido, la cancelacion del dueno o un fallo de la comprobacion. Antes esas ramas
 * cortaban la corrida ANTES de escribir nada, asi que la decision que mataba la accion era invisible
 * en la traza: el usuario veia una tarea que termino sin su envio y ni un renglon que dijera quien
 * lo impidio. Siempre exito false: ninguna de estas ramas ejecuta nada.
 *
 * `detalle` lo arma el llamador y JAMAS lleva valores leidos de la pagina sin censurar.
 */
export function construirPasoDeBloqueo(detalle: string): PasoCensurado {
  return {
    idx: 0,
    accion: { tipo: 'verificacion', instruccion: detalle, metodo: null, argumentos: [] },
    selector: null,
    valorCensurado: null,
    estrategias: [],
    url: null,
    exito: false,
  };
}
