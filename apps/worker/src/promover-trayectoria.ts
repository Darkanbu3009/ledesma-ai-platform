import {
  esAtributoEstable,
  parsePromoverTrayectoriaJobPayload,
  type EstrategiaLocalizacion,
  type Job,
  type PasoDeReceta,
} from '@ledesma-platform/shared';
import type { TrayectoriaConPasos, PasoTrayectoria } from '@ledesma-platform/backend/trayectorias';
import type { NuevaRecetaWeb, RecetaWeb } from '@ledesma-platform/backend/recetas-web';
import { PermanentExecutionError } from './errores.js';
import { detectarVerboBloqueado } from './prompt-tarea-web.js';
import { firmaDeObjetivo, promoverTrayectoria } from './receta-web.js';
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
 *  - Rol accesible y texto visible NO se pueden derivar: solo existian en las observaciones en
 *    memoria. La receta derivada nace mas fragil que una observada, y la AUTO REPARACION (D5) la
 *    enriquece en su primera re-ejecucion: al escalar un paso se leen del DOM las estrategias
 *    frescas y quedan persistidas.
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
  return {
    idx,
    accion: accionDeFila(fila.accion),
    selector: fila.selector,
    valorCensurado: fila.valorCensurado,
    url: fila.url,
    exito: true,
    estrategias: derivarEstrategiasDeSelector(fila.selector),
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

/** Mensaje al usuario cuando lo registrado no alcanza para repetir la tarea. Sin detalle tecnico. */
const MENSAJE_NO_GUARDABLE =
  'lo que hizo esta tarea no quedo registrado con el detalle necesario para repetirla, asi que no se puede guardar como tarea aprendida';

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
    throw new PermanentExecutionError(MENSAJE_NO_GUARDABLE);
  }

  const receta = await deps.recetas.promover({
    ownerId: job.ownerId,
    dominio: ultima.dominio,
    firmaObjetivo: conversion.firmaObjetivo,
    // El objetivo censurado hace de descripcion (V037): es lo que la pantalla de tareas ya sabidas
    // muestra para que el usuario RECONOZCA que guardo. No interviene en la ejecucion.
    descripcion: ultima.objetivo,
    pasos: conversion.pasos,
    creadaDesdeTrayectoria: ultima.id,
    origen: 'automatica',
  });

  await deps.guardarResultado(job.id, {
    estado: 'ok',
    via: 'trayectoria',
    recetaId: receta?.id ?? null,
  });
  deps.logger.info('promocion de trayectoria: la tarea quedo guardada como aprendida', {
    jobId: job.id,
    jobOrigenId,
    dominio: ultima.dominio,
    recetaId: receta?.id ?? null,
    pasos: conversion.pasos.length,
  });
}
