import type { EstrategiaLocalizacion, PasoDeReceta } from '@ledesma-platform/shared';

/**
 * AUTO REPARACION DE RECETAS (V038), parte PURA: el registro de QUE ESTRATEGIA GANO en cada paso de
 * cada ejecucion exitosa, y la REGLA que promueve a primaria la que gana de forma consistente cuando
 * la primaria falla de forma consistente.
 *
 * POR QUE, medido en produccion: en Gmail los ids son dinamicos por sesion (:u3, :q9), asi que la
 * estrategia primaria por atributo id falla en CADA corrida y el elemento lo resuelve siempre el
 * mismo fallback (rol accesible). Funciona, pero cada corrida paga el costo de probar primero una
 * estrategia que jamas va a resolver, y la receta nunca mejora sola.
 *
 * LA REGLA (decidida, no configurable): si en las ultimas 2 ejecuciones exitosas registradas de un
 * paso la primaria (indice 0) NO gano y gano la MISMA estrategia de fallback, esa estrategia pasa al
 * indice 0. La antigua primaria queda en la posicion siguiente; no se borra ninguna estrategia.
 *
 * IDENTIDAD POR CLAVE, no por indice: entre corrida y corrida la auto reparacion de selectores (D5)
 * puede reemplazar la lista de estrategias del paso por la que el elemento expone hoy, asi que un
 * indice no identifica de forma estable a una estrategia. La CLAVE (tipo, mas el nombre del atributo
 * cuando el tipo es 'atributo') si: "rol" es la misma forma de localizar aunque el nombre accesible
 * se haya refrescado, y "atributo:aria-label" no se confunde con "atributo:id". La clave ademas no
 * lleva ningun VALOR leido del sitio, asi que el historial persistido no contiene datos del usuario.
 *
 * Modulo PURO (sin base, sin navegador, sin reloj propio): mismo criterio que receta-web.ts. La
 * persistencia (leer y escribir `recetas_web.ganadoras` de forma atomica) vive en el repositorio; la
 * orquestacion (cuando corre, que se loguea) en tarea-web.ts.
 */

/** Cuantas ejecuciones exitosas se retienen POR PASO. La regla mira 2; con 5 hay para diagnosticar. */
export const MAX_REGISTROS_POR_PASO = 5;

/** Cuantas ejecuciones exitosas consecutivas tiene que ganar el MISMO fallback para promoverlo. */
export const EJECUCIONES_PARA_PROMOVER = 2;

/** La estrategia que gano un paso en una ejecucion exitosa. */
export interface RegistroGanadora {
  /** Indice que la estrategia ganadora tenia en el paso AL EJECUTAR. 0 = gano la primaria. */
  indice: number;
  /** Clave estable de la estrategia (ver cabecera). Sin valores del sitio. */
  clave: string;
  /** Job en el que gano (auditoria). */
  jobId: string;
  /** Cuando (ISO 8601). */
  en: string;
}

/** Historial por paso: la clave del objeto es el `idx` del paso como texto (viene de jsonb). */
export type HistorialGanadoras = Record<string, RegistroGanadora[]>;

/** La ganadora de UN paso en la corrida que acaba de terminar. */
export interface GanadoraDeCorrida {
  paso: number;
  indice: number;
  clave: string;
}

/** Una promocion decidida: que estrategia pasa a primaria en que paso. */
export interface PromocionDeEstrategia {
  pasoIdx: number;
  clave: string;
  /** La estrategia promovida, tal como quedo en el indice 0 (para loguear y etiquetar). */
  estrategia: EstrategiaLocalizacion;
  /** Indice que tenia antes de la promocion. */
  indiceAnterior: number;
}

/**
 * CLAVE estable de una estrategia: el tipo, mas el nombre del atributo cuando el tipo es 'atributo'.
 * Jamas incluye el valor: es lo que permite persistirla sin arrastrar textos del sitio y reconocer
 * "la misma forma de localizar" aunque el valor se haya refrescado entre corridas.
 */
export function claveDeEstrategia(estrategia: EstrategiaLocalizacion): string {
  return estrategia.tipo === 'atributo' ? `atributo:${estrategia.atributo}` : estrategia.tipo;
}

/** Un registro con la forma exacta, o null (el llamador lo descarta sin invalidar el resto). */
function parsearRegistro(crudo: unknown): RegistroGanadora | null {
  if (typeof crudo !== 'object' || crudo === null) return null;
  const objeto = crudo as Record<string, unknown>;
  const { indice, clave, jobId, en } = objeto;
  if (typeof indice !== 'number' || !Number.isInteger(indice) || indice < 0) return null;
  if (typeof clave !== 'string' || clave === '' || clave.length > 80) return null;
  if (typeof jobId !== 'string' || jobId === '' || jobId.length > 80) return null;
  if (typeof en !== 'string' || en === '' || en.length > 40) return null;
  return { indice, clave, jobId, en };
}

/**
 * Lee el historial tal como vuelve del jsonb. TOLERANTE a proposito (a diferencia del parser de
 * pasos): esto es telemetria de optimizacion, no el procedimiento a ejecutar. Una entrada corrupta
 * se descarta sola; cualquier cosa que no sea un objeto devuelve historial vacio y la vida sigue.
 */
export function parsearHistorialGanadoras(crudo: unknown): HistorialGanadoras {
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return {};
  const historial: HistorialGanadoras = {};
  for (const [clave, valor] of Object.entries(crudo)) {
    if (!/^\d{1,3}$/.test(clave) || !Array.isArray(valor)) continue;
    const registros: RegistroGanadora[] = [];
    for (const item of valor) {
      const registro = parsearRegistro(item);
      if (registro !== null) registros.push(registro);
    }
    if (registros.length > 0) historial[clave] = registros.slice(-MAX_REGISTROS_POR_PASO);
  }
  return historial;
}

/**
 * Las GANADORAS de la corrida que acaba de terminar, con su clave resuelta contra los pasos QUE SE
 * EJECUTARON. Solo pasos con un indice valido dentro de su lista: un paso escalado al motor no tiene
 * estrategia ganadora y no registra nada.
 */
export function ganadorasDeCorrida(
  pasos: PasoDeReceta[],
  ganadoras: ReadonlyArray<{ paso: number; indice: number }>,
): GanadoraDeCorrida[] {
  const resultado: GanadoraDeCorrida[] = [];
  for (const ganadora of ganadoras) {
    const paso = pasos.find((candidato) => candidato.idx === ganadora.paso);
    const estrategia = paso?.estrategias[ganadora.indice];
    if (paso === undefined || estrategia === undefined) continue;
    resultado.push({ paso: paso.idx, indice: ganadora.indice, clave: claveDeEstrategia(estrategia) });
  }
  return resultado;
}

/**
 * AGREGA las ganadoras de una corrida exitosa al historial, reteniendo solo las ultimas
 * MAX_REGISTROS_POR_PASO por paso. Devuelve un historial NUEVO (el de entrada no se muta).
 */
export function registrarGanadoras(
  historial: HistorialGanadoras,
  ganadoras: readonly GanadoraDeCorrida[],
  jobId: string,
  en: string,
): HistorialGanadoras {
  const nuevo: HistorialGanadoras = { ...historial };
  for (const ganadora of ganadoras) {
    const clave = String(ganadora.paso);
    const registros = [...(nuevo[clave] ?? []), { indice: ganadora.indice, clave: ganadora.clave, jobId, en }];
    nuevo[clave] = registros.slice(-MAX_REGISTROS_POR_PASO);
  }
  return nuevo;
}

/**
 * LA REGLA DE PROMOCION sobre el historial ya actualizado. Para cada paso: sus ultimos
 * EJECUCIONES_PARA_PROMOVER registros existen, en NINGUNO gano la primaria (indice 0), en TODOS gano
 * la MISMA clave, y esa clave no es ya la primaria actual del paso. Devuelve las promociones a
 * aplicar (normalmente cero o una).
 *
 * Casos que NO promueven, a proposito:
 *  - un solo registro: una racha de 1 no es consistencia;
 *  - fallbacks DISTINTOS en cada corrida: el paso esta inestable, reordenar seria perseguirlo;
 *  - la primaria gano en cualquiera de las ultimas corridas: la primaria sirve;
 *  - la clave ganadora ya no existe entre las estrategias del paso (la reparacion de selectores la
 *    quito): no hay nada que subir.
 */
export function evaluarPromociones(
  historial: HistorialGanadoras,
  pasos: PasoDeReceta[],
): PromocionDeEstrategia[] {
  const promociones: PromocionDeEstrategia[] = [];
  for (const paso of pasos) {
    const registros = historial[String(paso.idx)] ?? [];
    if (registros.length < EJECUCIONES_PARA_PROMOVER) continue;
    const ultimos = registros.slice(-EJECUCIONES_PARA_PROMOVER);
    if (ultimos.some((registro) => registro.indice === 0)) continue;
    const clave = ultimos[0]?.clave;
    if (clave === undefined || !ultimos.every((registro) => registro.clave === clave)) continue;
    const indiceActual = paso.estrategias.findIndex(
      (estrategia) => claveDeEstrategia(estrategia) === clave,
    );
    // Ya es la primaria (una corrida concurrente la subio) o ya no existe: nada que promover.
    if (indiceActual <= 0) continue;
    const estrategia = paso.estrategias[indiceActual];
    if (estrategia === undefined) continue;
    promociones.push({ pasoIdx: paso.idx, clave, estrategia, indiceAnterior: indiceActual });
  }
  return promociones;
}

/**
 * APLICA las promociones: en cada paso promovido, la ganadora pasa al indice 0 y el resto conserva
 * su orden relativo (la antigua primaria queda en la posicion siguiente). No se borra ninguna
 * estrategia y ningun otro campo del paso cambia. Devuelve una copia.
 */
export function aplicarPromociones(
  pasos: PasoDeReceta[],
  promociones: readonly PromocionDeEstrategia[],
): PasoDeReceta[] {
  return pasos.map((paso) => {
    const promocion = promociones.find((candidata) => candidata.pasoIdx === paso.idx);
    if (promocion === undefined) return paso;
    const ganadora = paso.estrategias[promocion.indiceAnterior];
    if (ganadora === undefined || claveDeEstrategia(ganadora) !== promocion.clave) return paso;
    const restantes = paso.estrategias.filter((_, indice) => indice !== promocion.indiceAnterior);
    return { ...paso, estrategias: [ganadora, ...restantes] };
  });
}
