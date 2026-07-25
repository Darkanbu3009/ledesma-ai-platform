/**
 * EXTRACCION DE PARAMETROS DECLARADOS en el objetivo del usuario (CAMBIO 2). Dado el objetivo en
 * lenguaje natural, saca los datos CONCRETOS que la accion va a comprometer: a quien se le envia,
 * cuanto dinero, que producto, que cantidad, con que asunto y con que cuerpo.
 *
 * POR QUE ES CODIGO Y NO EL MODELO (D4): el modelo ya demostro en produccion que no es una fuente
 * confiable sobre lo que hizo (relanzo una tarea por su cuenta y reporto causas inexistentes). Si el
 * mismo modelo que ejecuta la accion tambien dijera con que parametros compararla, la verificacion
 * seria una firma que el firmante se otorga a si mismo. Aca todo es regla y expresion regular:
 * determinista, testeable sin red y fuera del alcance de una pagina envenenada.
 *
 * CRITERIO ANTE LA DUDA (opuesto al de la censura y a proposito): un parametro AMBIGUO se marca como
 * NO DECLARADO, nunca se adivina. Un parametro adivinado mal haria pasar una verificacion contra un
 * valor que el usuario jamas dijo; un parametro no declarado, en cambio, o no se compara (si la
 * accion no lo exige) o detiene la tarea con un mensaje claro. Nunca se inventa un dato.
 *
 * Modulo PURO y sin dependencias (se testea exhaustivamente sin motor, sin navegador y sin base).
 */

/** Un monto declarado: valor numerico ya normalizado, moneda detectada y el texto original. */
export interface MontoDeclarado {
  valor: number;
  /** Codigo ISO de la moneda detectada, o null si el objetivo no la nombro. */
  moneda: string | null;
  /** El texto tal como aparecio (lo que se le muestra al usuario si hay que detener). */
  texto: string;
}

/** Lo que el objetivo DECLARA. null / arreglo vacio = no declarado (jamas "adivinado"). */
export interface ParametrosDeclarados {
  /** Correos destinatarios, normalizados y sin repetir. */
  destinatarios: string[];
  monto: MontoDeclarado | null;
  /** Nombre de producto entre comillas. */
  producto: string | null;
  cantidad: number | null;
  /** Asunto de un mensaje, entre comillas y precedido de la palabra que lo nombra. */
  asunto: string | null;
  /** Cuerpo de un mensaje, entre comillas y precedido de la palabra que lo nombra. */
  cuerpo: string | null;
}

/**
 * Normalizacion TEXTUAL de la comparacion (D2): minusculas, sin acentos, sin espacios extremos y con
 * los espacios internos colapsados. Es la MISMA funcion para el valor del objetivo y para el valor
 * leido del sitio: comparar con criterios distintos a cada lado seria comparar otra cosa.
 */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Correo electronico. Deliberadamente laxo en el dominio: el destinatario se compara, no se valida. */
const PATRON_CORREO = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

/** Todos los correos de un texto, normalizados (minusculas) y sin repetir, en orden de aparicion. */
export function extraerCorreos(texto: string): string[] {
  const encontrados = texto.match(PATRON_CORREO) ?? [];
  const unicos: string[] = [];
  for (const correo of encontrados) {
    const normalizado = correo.toLowerCase();
    if (!unicos.includes(normalizado)) unicos.push(normalizado);
  }
  return unicos;
}

/**
 * Simbolos y nombres de moneda que hacen de un numero un MONTO. Sin uno de estos, un numero suelto
 * es un numero suelto (una fecha, un vuelo, un asiento): jamas se interpreta como dinero.
 */
const MONEDA_POR_NOMBRE: Record<string, string> = {
  mxn: 'MXN',
  peso: 'MXN',
  pesos: 'MXN',
  usd: 'USD',
  dolar: 'USD',
  dolares: 'USD',
  dollar: 'USD',
  dollars: 'USD',
  eur: 'EUR',
  euro: 'EUR',
  euros: 'EUR',
};

/**
 * Monto con la moneda ANTES ($ 2,400 / MXN 2400 / USD 30) o DESPUES (2,400 MXN / 30 dolares). El
 * simbolo `$` se interpreta como MXN: es la moneda de la plataforma y la que el usuario escribe en
 * espanol de Mexico. Esa suposicion es explicita porque el tope configurable esta en MXN.
 */
const PATRON_MONTO = new RegExp(
  String.raw`(\$|mx\$|us\$|€|£)?\s*(?:\b(mxn|usd|eur|pesos?|dolares?|dollars?|euros?)\b\s*)?` +
    String.raw`(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)` +
    String.raw`\s*(?:\b(mxn|usd|eur|pesos?|dolares?|dollars?|euros?)\b)?`,
  'gi',
);

const MONEDA_POR_SIMBOLO: Record<string, string> = {
  $: 'MXN',
  'mx$': 'MXN',
  'us$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
};

/**
 * Convierte el numero de un monto a valor numerico limpiando simbolos y separadores (D2: "para
 * montos, comparacion numerica tras limpiar simbolos de moneda y separadores").
 *
 * Regla de separadores, pensada para el formato que escribe un usuario en Mexico y para el que
 * imprime un sitio: el ULTIMO separador es decimal solo si lo siguen 1 o 2 digitos; si lo siguen 3,
 * es de miles. "2,400" -> 2400; "2.400,50" -> 2400.5; "1,50" -> 1.5; "1 000" -> 1000.
 * Devuelve null si el texto no queda como un numero finito: nunca se adivina un monto.
 */
export function normalizarMonto(texto: string): number | null {
  const limpio = texto.replace(/[^\d.,\s]/g, '').replace(/\s/g, '').trim();
  if (limpio === '' || !/\d/.test(limpio)) return null;
  const ultimoSeparador = Math.max(limpio.lastIndexOf('.'), limpio.lastIndexOf(','));
  let entero = limpio;
  let decimales = '';
  if (ultimoSeparador >= 0) {
    const cola = limpio.slice(ultimoSeparador + 1);
    if (/^\d{1,2}$/.test(cola)) {
      entero = limpio.slice(0, ultimoSeparador);
      decimales = cola;
    }
  }
  const digitos = entero.replace(/[.,]/g, '');
  if (!/^\d+$/.test(digitos)) return null;
  const valor = Number(decimales === '' ? digitos : `${digitos}.${decimales}`);
  return Number.isFinite(valor) ? valor : null;
}

/**
 * Todos los MONTOS de un texto (numero con simbolo o nombre de moneda pegado). Se usa tanto sobre el
 * objetivo del usuario como sobre los valores leidos del sitio, con las MISMAS reglas.
 */
export function extraerMontos(texto: string): MontoDeclarado[] {
  const montos: MontoDeclarado[] = [];
  for (const match of texto.matchAll(PATRON_MONTO)) {
    const [crudo, simbolo, monedaAntes, numero, monedaDespues] = match;
    if (numero === undefined) continue;
    // Sin simbolo NI nombre de moneda no es dinero: es un numero suelto.
    if (simbolo === undefined && monedaAntes === undefined && monedaDespues === undefined) continue;
    const valor = normalizarMonto(numero);
    if (valor === null) continue;
    const nombre = (monedaDespues ?? monedaAntes ?? '').toLowerCase();
    const moneda =
      MONEDA_POR_NOMBRE[nombre] ??
      (simbolo !== undefined ? MONEDA_POR_SIMBOLO[simbolo.toLowerCase()] : undefined) ??
      null;
    montos.push({ valor, moneda, texto: crudo.replace(/\s+/g, ' ').trim() });
  }
  return montos;
}

/** Texto ENTRE COMILLAS (rectas o tipograficas). Las simples no cuentan: son apostrofes. */
const ENTRECOMILLADO = String.raw`"([^"\n]{1,120})"|[“]([^”\n]{1,120})[”]|«([^»\n]{1,120})»`;

/** Nombre de producto entrecomillado, sin rotulo que lo preceda. */
const PATRON_PRODUCTO = new RegExp(ENTRECOMILLADO, 'g');

/**
 * Texto entrecomillado precedido del ROTULO que dice QUE es ("con el asunto \"X\"", "mensaje: \"Y\"",
 * "cuerpo que diga \"Z\""). Exigir el rotulo Y las comillas es lo que mantiene la extraccion
 * determinista: sin las dos cosas, el dato queda NO DECLARADO y no se compara nada inventado.
 */
function patronRotulado(rotulos: string): RegExp {
  return new RegExp(
    String.raw`\b(?:${rotulos})\b\s*(?:que\s+)?(?:diga|dice|sea|es|of|de|del)?\s*[:=]?\s*(?:${ENTRECOMILLADO})`,
    'gi',
  );
}

/**
 * ASUNTO de un mensaje. "titulo" queda FUERA a proposito: en un objetivo de compra ("el libro con
 * titulo X") nombra al producto, y robarselo al parametro `producto` cambiaria contra que se compara.
 */
const PATRON_ASUNTO = patronRotulado('asunto|subject');

/** CUERPO de un mensaje (lo que se escribe dentro, no el asunto). */
const PATRON_CUERPO = patronRotulado('cuerpo|mensaje|texto|contenido|body|message|content');

/** Los textos entrecomillados que un patron rotulado captura, en orden de aparicion. */
function entrecomilladosRotulados(objetivo: string, patron: RegExp): string[] {
  const valores: string[] = [];
  for (const match of objetivo.matchAll(patron)) {
    const valor = match[1] ?? match[2] ?? match[3];
    if (valor !== undefined && valor.trim() !== '') valores.push(valor.trim());
  }
  return valores;
}

/**
 * CANTIDAD explicita: exige una palabra que la nombre ("cantidad 3", "3 unidades", "qty: 2"). Un
 * numero suelto JAMAS es una cantidad (seria un dia, un asiento o parte de una direccion).
 */
const PATRONES_CANTIDAD: readonly RegExp[] = [
  /\b(?:cantidad|quantity|qty|cant)\b\s*(?:de|of)?\s*[:=]?\s*(\d{1,4})\b/gi,
  /\b(\d{1,4})\s*(?:unidades|unidad|piezas|pieza|units|unit|pcs)\b/gi,
];

/** Devuelve el unico valor de la lista si todos son iguales; null si esta vacia o hay varios. */
function unicoValor<T>(valores: T[], clave: (v: T) => string): T | null {
  if (valores.length === 0) return null;
  const primero = valores[0] as T;
  const referencia = clave(primero);
  return valores.every((v) => clave(v) === referencia) ? primero : null;
}

/**
 * Extrae los parametros DECLARADOS en el objetivo. Nunca lanza: un objetivo raro devuelve parametros
 * no declarados, que es el estado seguro (o no se compara nada, o la tarea se detiene pidiendo el dato).
 */
export function extraerParametrosDeclarados(objetivo: string): ParametrosDeclarados {
  const destinatarios = extraerCorreos(objetivo);

  // Varios montos distintos en un mismo objetivo = ambiguo (no se puede saber cual es EL monto de la
  // accion): no declarado. Varias menciones del MISMO monto si cuentan como uno.
  const monto = unicoValor(extraerMontos(objetivo), (m) => `${m.valor}|${m.moneda ?? ''}`);

  // ASUNTO y CUERPO se extraen ANTES que el producto y se RESERVAN: un texto que el objetivo ya
  // rotulo como asunto no puede ademas contarse como el nombre de un producto (seria el mismo dato
  // comparado dos veces y con criterios distintos). La reserva vale aunque el rotulo aparezca varias
  // veces con valores distintos: ahi el dato es ambiguo, queda NO declarado, y tampoco es un producto.
  const asuntos = entrecomilladosRotulados(objetivo, PATRON_ASUNTO);
  const cuerpos = entrecomilladosRotulados(objetivo, PATRON_CUERPO);
  const asunto = unicoValor(asuntos, (a) => normalizarTexto(a));
  const cuerpo = unicoValor(cuerpos, (c) => normalizarTexto(c));
  const reservados = new Set([...asuntos, ...cuerpos].map((t) => normalizarTexto(t)));

  const entrecomillados: string[] = [];
  for (const match of objetivo.matchAll(PATRON_PRODUCTO)) {
    const valor = match[1] ?? match[2] ?? match[3];
    if (valor === undefined || valor.trim() === '') continue;
    if (reservados.has(normalizarTexto(valor.trim()))) continue;
    entrecomillados.push(valor.trim());
  }
  const producto = unicoValor(entrecomillados, (p) => normalizarTexto(p));

  // La cantidad se busca sobre el objetivo SIN los montos: "2,400 MXN" no debe dejar un "400" suelto
  // que una frase de cantidad cercana pudiera capturar.
  const sinMontos = extraerMontos(objetivo).reduce(
    (texto, m) => texto.split(m.texto).join(' '),
    objetivo,
  );
  const cantidades: number[] = [];
  for (const patron of PATRONES_CANTIDAD) {
    for (const match of sinMontos.matchAll(patron)) {
      const crudo = match[1];
      if (crudo === undefined) continue;
      const valor = Number(crudo);
      if (Number.isInteger(valor) && valor > 0) cantidades.push(valor);
    }
  }
  const cantidad = unicoValor(cantidades, (c) => String(c));

  return { destinatarios, monto, producto, cantidad, asunto, cuerpo };
}

/**
 * CUANTOS parametros DECLARA el objetivo (CAMBIO 1). Es el numero contra el que la verificacion mide
 * si comparo TODO lo que el usuario pidio: superarla con menos comparaciones que parametros
 * declarados fue exactamente lo que dejo pasar una accion con el formulario a medio llenar.
 */
export function contarParametrosDeclarados(parametros: ParametrosDeclarados): number {
  return [
    parametros.destinatarios.length > 0,
    parametros.monto !== null,
    parametros.producto !== null,
    parametros.cantidad !== null,
    parametros.asunto !== null,
    parametros.cuerpo !== null,
  ].filter(Boolean).length;
}
