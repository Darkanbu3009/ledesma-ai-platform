/**
 * COSTO DE LA CORRIDA DEL MOTOR: las tres palancas con las que el worker decide QUE se le manda al
 * modelo en cada paso y CUANTO costo la corrida. Modulo PURO y sin dependencias (ni Stagehand, ni el
 * AI SDK, ni navegador): se testea entero sin abrir nada y sin llamar a ningun modelo.
 *
 * Por que existe. Una corrida de 26 pasos consumio 208111 tokens de entrada: el bucle del agente
 * reenvia la conversacion COMPLETA en cada llamada, asi que el costo crece con el cuadrado de los
 * pasos. Las tres palancas de aca atacan las tres causas:
 *
 *  1. crearPreparadorDePaso: recorta el historial a los ultimos N pasos (conservando SIEMPRE el
 *     objetivo original), saca las instrucciones de sistema del arreglo de mensajes y las devuelve
 *     por el canal `system`, y marca el prefijo estable como CACHEABLE para que deje de pagarse a
 *     precio de entrada nueva en cada paso.
 *  2. crearPoliticaDeScreenshots: decide si una captura de pantalla se toma de verdad. Una imagen es
 *     el item mas caro que entra al contexto y, en la mayoria de los pasos, es la MISMA pagina.
 *  3. crearAcumuladorDeConsumo: suma lo que cada paso consumio (entrada, salida, leido de cache y
 *     creado en cache) para poder medir si el ahorro funciono.
 *
 * NINGUNA de las tres cambia lo que el agente decide: el modelo ve el mismo objetivo, las mismas
 * reglas de sistema y las mismas herramientas. Lo que cambia es cuanto de lo YA VISTO se le vuelve a
 * cobrar al owner en cada paso.
 */

/** Cotas de la ventana de historial (TAREA_WEB_HISTORIAL_PASOS). Las valida env.ts al arrancar. */
export const HISTORIAL_PASOS_MIN = 3;
export const HISTORIAL_PASOS_MAX = 40;
/** Ventana por defecto: 8 pasos de ida y vuelta mas el objetivo original. */
export const HISTORIAL_PASOS_DEFAULT = 8;

/**
 * Cuando se toma una captura de pantalla durante la corrida (TAREA_WEB_SCREENSHOTS):
 *  - 'siempre': cada vez que el agente la pide (comportamiento historico, sin intervencion).
 *  - 'cambios' (default): solo si la URL o el titulo cambiaron desde la observacion anterior.
 *  - 'minimo': solo la primera de la corrida y las que preceden a una accion irreversible.
 */
export type ModoScreenshots = 'siempre' | 'cambios' | 'minimo';

/**
 * Forma ESTRUCTURAL de un mensaje del AI SDK (`ModelMessage`), declarada aca para que este modulo no
 * dependa del paquete `ai` ni de Stagehand. El adaptador del motor (stagehand.ts) es el unico que
 * cruza los dos tipos, y lo hace en un solo punto.
 */
export interface MensajeDeModelo {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  providerOptions?: Record<string, Record<string, unknown>> | undefined;
}

/** Lo que el preparador devuelve para UN paso del bucle del agente. */
export interface PreparacionDePaso {
  /** Instrucciones de sistema por el canal `system` (ausente si no habia mensaje de sistema). */
  system?: string;
  /** Mensajes que efectivamente se envian, ya recortados y marcados como cacheables. */
  messages: MensajeDeModelo[];
  /** true si esta llamada dejo pasos fuera de la ventana (solo para el diagnostico y los tests). */
  recortado: boolean;
}

/**
 * Marca de CACHE DE PROMPT de Anthropic sobre un mensaje. El proveedor cachea todo el prefijo que
 * termina en el mensaje marcado (definicion de herramientas + system + los mensajes anteriores), y
 * los pasos siguientes lo leen a una decima parte del precio de entrada nueva. Los proveedores que
 * no la entienden ignoran el campo.
 */
function marcarCacheable(mensaje: MensajeDeModelo): MensajeDeModelo {
  return {
    ...mensaje,
    providerOptions: {
      ...(mensaje.providerOptions ?? {}),
      anthropic: {
        ...(mensaje.providerOptions?.anthropic ?? {}),
        cacheControl: { type: 'ephemeral' },
      },
    },
  };
}

/** Indices (en orden) de los mensajes del asistente: cada uno abre UN paso de ida y vuelta. */
function indicesDeAsistente(mensajes: readonly MensajeDeModelo[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < mensajes.length; i++) {
    if (mensajes[i]?.role === 'assistant') indices.push(i);
  }
  return indices;
}

/**
 * RECORTE DEL HISTORIAL a los ultimos `pasos` pasos de ida y vuelta.
 *
 * El corte cae SIEMPRE en un mensaje del asistente y se lleva todo lo que sigue: un mensaje de
 * herramienta cuya llamada quedo fuera del envio es un mensaje huerfano que el proveedor rechaza, y
 * un asistente sin sus resultados deja al modelo esperando una respuesta que nunca llega.
 *
 * El PREFIJO (todo lo anterior al primer mensaje del asistente, o sea el objetivo del usuario y lo
 * que lo acompane) se conserva SIEMPRE: es la unica constancia de que se pidio y sin el la corrida
 * perderia el norte a mitad de camino.
 */
export function recortarHistorial(
  mensajes: readonly MensajeDeModelo[],
  pasos: number,
): { mensajes: MensajeDeModelo[]; recortado: boolean } {
  const asistentes = indicesDeAsistente(mensajes);
  const primerAsistente = asistentes[0];
  if (asistentes.length <= pasos || primerAsistente === undefined) {
    return { mensajes: [...mensajes], recortado: false };
  }
  const corte = asistentes[asistentes.length - pasos];
  if (corte === undefined) return { mensajes: [...mensajes], recortado: false };
  return {
    mensajes: [...mensajes.slice(0, primerAsistente), ...mensajes.slice(corte)],
    recortado: true,
  };
}

/**
 * Preparador de UN paso del bucle del agente. Se invoca antes de CADA llamada al modelo y decide:
 *
 *  1. SYSTEM POR SU CANAL. El mensaje de sistema (el que el motor antepone al arreglo de mensajes)
 *     se saca de ahi y se devuelve por la opcion `system`. Es el canal que corresponde: instruccion
 *     de sistema y conversacion dejan de viajar mezcladas, que es justo la confusion sobre la que
 *     avisa el AI SDK en cada llamada.
 *  2. VENTANA DE HISTORIAL (recortarHistorial).
 *  3. PREFIJO CACHEABLE. Se marca el ultimo mensaje del prefijo estable (el objetivo del usuario),
 *     con lo que quedan cacheadas las herramientas, el system y el objetivo: exactamente la parte
 *     que es identica en los 26 pasos de una corrida. Mientras el historial todavia no se recorta,
 *     se marca ademas el final del envio ANTERIOR: asi cada paso lee de cache toda la conversacion
 *     previa en vez de pagarla como entrada nueva. En cuanto la ventana empieza a deslizarse, esa
 *     segunda marca se apaga: el prefijo ya no se repite entre pasos y escribir cache que nadie va a
 *     leer cuesta mas que no escribirla.
 *
 * El preparador tiene ESTADO (la longitud del envio anterior), asi que hay uno por corrida.
 */
export function crearPreparadorDePaso(params: {
  historialPasos: number;
}): (mensajes: readonly MensajeDeModelo[]) => PreparacionDePaso {
  /** Cuantos mensajes se enviaron en el paso anterior; -1 = todavia no hubo paso anterior. */
  let longitudPrevia = -1;

  return (mensajes) => {
    // 1. El mensaje de sistema sale del arreglo. Solo se levanta si su contenido es texto: cualquier
    //    otra forma se deja donde esta antes que alterar lo que el modelo recibe.
    let system: string | undefined;
    const conversacion: MensajeDeModelo[] = [];
    for (const mensaje of mensajes) {
      if (mensaje.role === 'system' && system === undefined && typeof mensaje.content === 'string') {
        system = mensaje.content;
        continue;
      }
      conversacion.push(mensaje);
    }

    // 2. Ventana de historial.
    const { mensajes: acotados, recortado } = recortarHistorial(conversacion, params.historialPasos);

    // 3. Marcas de cache. Fin del prefijo estable = el mensaje anterior al primer asistente; si
    //    todavia no hay ninguno (primer paso), es el ultimo mensaje del envio.
    const asistentes = indicesDeAsistente(acotados);
    const primerAsistente = asistentes[0];
    const finDelPrefijo = (primerAsistente ?? acotados.length) - 1;
    const marcas = new Set<number>();
    if (finDelPrefijo >= 0) marcas.add(finDelPrefijo);
    // Marca rodante: solo vale mientras el envio anterior siga siendo un prefijo de este.
    if (!recortado && longitudPrevia > 0 && longitudPrevia <= acotados.length) {
      marcas.add(longitudPrevia - 1);
      marcas.add(acotados.length - 1);
    }
    longitudPrevia = recortado ? -1 : acotados.length;

    return {
      ...(system !== undefined ? { system } : {}),
      messages: acotados.map((mensaje, idx) =>
        marcas.has(idx) ? marcarCacheable(mensaje) : mensaje,
      ),
      recortado,
    };
  };
}

/** Lo que se observa de la pagina para decidir si vale la pena una captura nueva. */
export interface EstadoDePagina {
  url: string;
  titulo: string;
}

export interface PoliticaDeScreenshots {
  /**
   * Veredicto para UNA peticion de captura del agente. Registra el estado observado sea cual sea el
   * veredicto: el punto de comparacion es siempre la observacion anterior.
   */
  permitir(estado: EstadoDePagina): boolean;
}

/**
 * POLITICA DE CAPTURAS (TAREA_WEB_SCREENSHOTS). Una captura es lo mas caro que entra al contexto del
 * modelo y, paso a paso, suele ser la MISMA pagina: el agente pide una foto para "verificar el
 * estado" y recibe pixel por pixel lo que ya tenia.
 *
 *  - 'siempre': jamas se interpone (comportamiento historico).
 *  - 'cambios': se captura si la URL o el titulo difieren de la observacion anterior. La primera de
 *    la corrida siempre pasa (no hay con que comparar). Dos peticiones seguidas sobre la misma
 *    pagina devuelven la misma imagen, asi que la segunda no aporta nada que el modelo no tenga.
 *  - 'minimo': pasa la primera de la corrida y, despues, solo mientras la corrida lleve GUARDIA y la
 *    accion irreversible siga sin autorizarse; es decir, exactamente el tramo que PRECEDE a esa
 *    accion. Autorizada la accion (o en una corrida sin accion bloqueada), no se captura mas.
 */
export function crearPoliticaDeScreenshots(params: {
  modo: ModoScreenshots;
  /** La corrida lleva guardia: el objetivo declara una accion irreversible. */
  conGuardia: boolean;
  /** true cuando la guardia YA autorizo esa accion (el tramo previo termino). */
  yaAutorizo: () => boolean;
}): PoliticaDeScreenshots {
  let anterior: EstadoDePagina | null = null;
  return {
    permitir: (estado) => {
      const previo = anterior;
      anterior = estado;
      if (params.modo === 'siempre') return true;
      if (previo === null) return true;
      if (params.modo === 'minimo') return params.conGuardia && !params.yaAutorizo();
      return estado.url !== previo.url || estado.titulo !== previo.titulo;
    },
  };
}

/** Lo que un paso del bucle reporta de consumo. Cualquier campo puede faltar segun el proveedor. */
export interface PasoConsumido {
  tokensEntrada?: number | undefined;
  tokensSalida?: number | undefined;
  tokensLeidosDeCache?: number | undefined;
  tokensCreadosEnCache?: number | undefined;
}

/**
 * REPORTE DE CONSUMO de una corrida completa. `tokensEntrada` son los tokens de entrada NUEVOS (no
 * incluyen los leidos de cache ni los creados en ella): es la cifra que tiene que bajar cuando las
 * otras dos palancas funcionan.
 */
export interface ConsumoDeCorrida {
  tokensEntrada: number;
  tokensSalida: number;
  tokensLeidosDeCache: number;
  tokensCreadosEnCache: number;
  /** Llamadas al modelo que hizo el bucle del agente (una por paso). */
  pasos: number;
}

export interface AcumuladorDeConsumo {
  registrarPaso(paso: PasoConsumido): void;
  total(): ConsumoDeCorrida;
}

/**
 * Acumula el consumo paso a paso. Existe porque el resultado del motor solo reporta los totales de
 * entrada y salida: los tokens leidos y creados en cache -- los unicos que dicen si el cache de
 * prompt esta funcionando -- viajan por el reporte de cada paso y por los metadatos del proveedor.
 */
export function crearAcumuladorDeConsumo(): AcumuladorDeConsumo {
  const total: ConsumoDeCorrida = {
    tokensEntrada: 0,
    tokensSalida: 0,
    tokensLeidosDeCache: 0,
    tokensCreadosEnCache: 0,
    pasos: 0,
  };
  return {
    registrarPaso: (paso) => {
      total.pasos += 1;
      total.tokensEntrada += paso.tokensEntrada ?? 0;
      total.tokensSalida += paso.tokensSalida ?? 0;
      total.tokensLeidosDeCache += paso.tokensLeidosDeCache ?? 0;
      total.tokensCreadosEnCache += paso.tokensCreadosEnCache ?? 0;
    },
    total: () => ({ ...total }),
  };
}

/** Lee un entero no negativo de unos metadatos sueltos (los del proveedor no vienen tipados). */
export function numeroDeMetadatos(fuente: unknown, clave: string): number | undefined {
  if (typeof fuente !== 'object' || fuente === null) return undefined;
  const valor = (fuente as Record<string, unknown>)[clave];
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 ? valor : undefined;
}
