import {
  serializarDetencion,
  type CampoFaltante,
  type DetencionDeVerificacion,
  type PoliticaDeEjecucion,
} from '@ledesma-platform/shared';
import {
  extraerCorreos,
  extraerMontos,
  normalizarMonto,
  normalizarTexto,
  type MontoDeclarado,
  type ParametrosDeclarados,
} from './parametros-objetivo.js';
import { censurarValor } from './censura.js';
import { construirSystemPromptTareaWeb } from './prompt-tarea-web.js';
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
}

/** Foto de solo lectura de la pagina en el momento previo a ejecutar la accion. */
export interface EstadoDeLaPagina {
  campos: CampoDeLaPagina[];
  /** Texto visible de la pagina, acotado. Evidencia DEBIL: lo escribe el sitio, no el agente. */
  texto: string;
}

/** Una comparacion concreta: que se pidio, que habia, y si son lo mismo. */
export interface Comparacion {
  parametro: 'destinatario' | 'monto' | 'producto' | 'cantidad';
  pedido: string;
  encontrado: string;
  coincide: boolean;
}

/** Resultado de la verificacion: ejecutar la accion, o detener la tarea con un motivo. */
export type Veredicto =
  | { tipo: 'ejecutar'; comparaciones: Comparacion[] }
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

/**
 * Contexto de un campo que lo delata como DESTINATARIO de la accion (para/to/cc/bcc/correo). Se
 * evalua sobre el contexto NORMALIZADO del campo.
 */
const CONTEXTO_DESTINATARIO = /\b(to|para|destinatario|destinatarios|recipient|recipients|cc|bcc|cco|correo|email|e-mail|mail)\b/;

/**
 * Contexto de un campo que es el REMITENTE, no el destinatario. Se excluye explicitamente: la
 * direccion del propio usuario aparece en casi todo formulario de correo y compararla como si fuera
 * un destinatario detendria TODOS los envios legitimos.
 */
const CONTEXTO_REMITENTE = /\b(from|remitente|reply[-\s]?to|sender|responder a)\b/;

/** Contexto de un campo de DINERO: ahi un numero pelado (sin simbolo) si es un monto, en MXN. */
const CONTEXTO_MONTO = /\b(monto|importe|total|precio|price|amount|pago|payment|cobro|cargo|subtotal)\b/;

/** Contexto de un campo de CANTIDAD (numero de unidades). */
const CONTEXTO_CANTIDAD = /\b(cantidad|cant|quantity|qty|unidades|units|piezas)\b/;

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
 *  4. no se pudo leer la pagina (nunca se ejecuta a ciegas);
 *  5. un monto comprometido supera el tope configurado;
 *  6. algun parametro declarado no coincide con lo que hay en pantalla.
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
    // Sin foto del DOM no hay verificacion posible. Jamas se ejecuta a ciegas.
    return detener({
      motivo: 'noCoincide',
      pedido: descripcionDeLoPedido(parametros),
      encontrado: '',
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

  // 6. COMPARACION de cada parametro declarado contra el DOM.
  const comparaciones = compararParametros(parametros, pagina);
  const fallida = comparaciones.find((c) => !c.coincide);
  if (fallida !== undefined) {
    return {
      tipo: 'detener',
      detencion: {
        motivo: 'noCoincide',
        pedido: fallida.pedido,
        encontrado: fallida.encontrado,
        detalle: `el parametro ${fallida.parametro} no coincide`,
      },
      comparaciones,
    };
  }

  return { tipo: 'ejecutar', comparaciones };
}

/** Resumen de lo que el objetivo pedia, para el mensaje cuando no hay nada legible con que comparar. */
function descripcionDeLoPedido(parametros: ParametrosDeclarados): string {
  const partes: string[] = [];
  if (parametros.destinatarios.length > 0) partes.push(parametros.destinatarios.join(', '));
  if (parametros.monto !== null) partes.push(parametros.monto.texto);
  if (parametros.producto !== null) partes.push(parametros.producto);
  if (parametros.cantidad !== null) partes.push(String(parametros.cantidad));
  return partes.join(' / ');
}

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
    comparaciones.push({
      parametro: 'destinatario',
      pedido: pedidos.join(', '),
      encontrado: encontrados.join(', '),
      coincide: encontrados.length > 0 && pedidos.join('|') === encontrados.join('|'),
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
    comparaciones.push({
      parametro: 'monto',
      pedido: formatearMonto(declarado.valor, declarado.moneda),
      encontrado: candidatos.map((m) => formatearMonto(m.valor, m.moneda)).join(', '),
      coincide,
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
    });
  }

  // CANTIDAD: el valor de un campo de cantidad debe ser exactamente el numero pedido. Sin campo de
  // cantidad no se puede verificar y la comparacion falla (nunca se asume "seguro era 1").
  if (parametros.cantidad !== null) {
    const campos = pagina.campos.filter((c) => CONTEXTO_CANTIDAD.test(normalizarTexto(c.contexto)));
    const valores = campos
      .map((c) => normalizarMonto(c.valor))
      .filter((v): v is number => v !== null);
    comparaciones.push({
      parametro: 'cantidad',
      pedido: String(parametros.cantidad),
      encontrado: valores.join(', '),
      coincide: valores.length > 0 && valores.every((v) => v === parametros.cantidad),
    });
  }

  return comparaciones;
}

/** Mensaje de cierre del job cuando la accion se detiene (contrato estable con la consola). */
export function mensajeDeDetencion(veredicto: Extract<Veredicto, { tipo: 'detener' }>): string {
  return serializarDetencion(censurarDetencion(veredicto.detencion));
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
 * Prompt de la corrida que EJECUTA la accion ya verificada. Se construye SOLO con texto fijo y con
 * el objetivo ORIGINAL del usuario: nada de lo que el modelo dijo en su mensaje final (que puede
 * venir contaminado por el contenido de la pagina) entra a este prompt. La autorizacion la da el
 * sistema tras comparar, no el modelo al describirse a si mismo.
 */
export function construirEjecucionVerificada(objetivoOriginal: string): {
  objetivo: string;
  systemPrompt: string;
} {
  return {
    systemPrompt: [
      construirSystemPromptTareaWeb(),
      '',
      'VERIFICACION DEL SISTEMA COMPLETADA:',
      '- El sistema ya comparo, fuera de tu alcance, los datos de la accion pendiente contra lo que',
      '  pidio el usuario, y coinciden.',
      '- Ejecuta ESA accion ahora, UNA sola vez, y termina la tarea.',
      '- NO ejecutes ninguna OTRA accion irreversible o financiera: si aparece una, reportala como',
      '  siempre y termina sin ejecutarla.',
    ].join('\n'),
    objetivo:
      `Tu tarea original era: ${objetivoOriginal}\n` +
      'Ya dejaste la pagina lista en la accion que quedo pendiente y el sistema verifico que los ' +
      'datos en pantalla coinciden con lo que pidio el usuario. Ejecuta esa accion ahora, UNA sola ' +
      'vez, y completa la tarea.',
  };
}
