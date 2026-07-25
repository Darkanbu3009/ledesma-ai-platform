import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';
import { censurarTexto, censurarUrl, censurarValor, VALOR_CENSURADO } from './censura.js';

/**
 * TRAYECTORIAS de tareas web (Fase F, paso 1): mapeo de las acciones CRUDAS que devuelve el motor de
 * navegacion (AgentResult.actions de Stagehand v3) a los PASOS CENSURADOS que se persisten en
 * pasos_trayectoria (V030). Modulo puro (sin motor, sin base) para testearlo con acciones sinteticas.
 *
 * PRIVACIDAD por WHITELIST: el objeto `accion` que se persiste se CONSTRUYE campo a campo (tipo,
 * instruccion, metodo, argumentos) y cada valor pasa por la censura. JAMAS se hace spread del objeto
 * crudo del motor: trae campos abiertos (pageText, razonamiento, salidas de tools) que pueden
 * arrastrar contenido de pagina o datos personales que no necesitamos para promover a receta.
 *
 * ENRIQUECIMIENTO (Fase F paso 2, CAMBIO 1): la traza del motor SOLO trae el xpath absoluto que
 * resolvio Stagehand, y solo en 'act' y 'fillForm': los pasos por coordenadas ('click', 'type' del
 * modo hibrido) no traen selector ninguno. Un xpath absoluto no sostiene una receta (se rompe con que
 * el sitio inserte un div mas arriba) y un paso sin selector no se puede repetir en absoluto. Por eso
 * el handler OBSERVA cada paso mientras el motor corre y lee del DOM las formas estables de volver a
 * encontrar el elemento (atributo, rol mas nombre accesible, texto visible, xpath recalculado); esas
 * observaciones entran aqui y se emparejan con las acciones. Es BEST-EFFORT: un paso cuyo elemento ya
 * desaparecio (un click que navego) conserva lo que el motor registro, y sin estrategias ese paso
 * simplemente no se promueve a receta.
 */

/**
 * Accion cruda del motor, tal como viene en AgentResult.actions (Stagehand v3, agent.d.ts:53-62 del
 * paquete): shape abierto con campos opcionales. Se tipa laxa a proposito: el mapeo debe tolerar
 * cualquier forma sin lanzar (una traza jamas debe tumbar la tarea).
 */
export interface AccionCrudaDeMotor {
  type?: unknown;
  action?: unknown;
  instruction?: unknown;
  pageUrl?: unknown;
  success?: unknown;
  playwrightArguments?: unknown;
  [key: string]: unknown;
}

/** Un paso censurado, listo para persistir en pasos_trayectoria (V030). */
export interface PasoCensurado {
  idx: number;
  /** Objeto por whitelist: { tipo, instruccion, metodo, argumentos }, todo ya censurado. */
  accion: {
    tipo: string;
    instruccion: string | null;
    metodo: string | null;
    argumentos: string[];
  };
  selector: string | null;
  valorCensurado: string | null;
  url: string | null;
  exito: boolean;
  /**
   * Formas de volver a encontrar el elemento del paso (CAMBIO 1). Vacia cuando el paso no toca un
   * elemento o cuando la observacion no llego a tiempo. NO se persiste en pasos_trayectoria (V030 no
   * tiene columna para ella y este PR no la agrega): vive solo el tiempo que dura la corrida, que es
   * cuando la promocion a receta la necesita.
   */
  estrategias: EstrategiaLocalizacion[];
}

/**
 * Lo que el handler OBSERVO de un paso mientras el motor lo ejecutaba: el selector que el motor
 * resolvio (si lo hubo) y las estrategias que se leyeron del DOM justo despues. Se emparejan con las
 * acciones crudas en `extraerPasosCensurados`.
 */
export interface ObservacionDePaso {
  /** Selector (xpath) que el motor resolvio para ese paso, o null si actuo por coordenadas. */
  selector: string | null;
  estrategias: EstrategiaLocalizacion[];
}

/** Desenlace de una ejecucion del motor, tal como se persiste en trayectorias_web.estado. */
export type EstadoTrayectoria = 'exitosa' | 'fallida' | 'pausada';

/** Trayectoria completa lista para persistir (cabecera + pasos censurados). */
export interface TrayectoriaNueva {
  ownerId: string;
  jobId: string;
  connectionId: string;
  dominio: string;
  /** Objetivo del usuario, ya pasado por la censura de texto. */
  objetivo: string;
  estado: EstadoTrayectoria;
  iniciadaEn: Date;
  terminadaEn: Date;
  duracionMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  pasos: PasoCensurado[];
}

/** PUERTO de persistencia de trayectorias. Lo implementa el repositorio del backend (V030) cableado
 *  en index.ts; los tests pasan fakes. El llamador SIEMPRE lo invoca best-effort. */
export interface RegistradorDeTrayectorias {
  guardar(trayectoria: TrayectoriaNueva): Promise<void>;
}

/** Metodos de Playwright que TECLEAN un valor (su argumento es texto del usuario y se censura). */
const METODOS_DE_TECLEO = new Set(['fill', 'type', 'press', 'selectOption', 'setValue']);

function comoTexto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

/**
 * EMPAREJA las observaciones con las acciones crudas (CAMBIO 1). Dos criterios, del mas fuerte al
 * mas debil, y ninguno adivina:
 *
 *  1. Si hay TANTAS observaciones como acciones, se emparejan por POSICION. Es el caso normal: el
 *     motor emite una observacion por cada tool que ejecuta, en el mismo orden en que empuja las
 *     acciones (v3AgentHandler emite `step_finished` justo despues de `state.actions.push`).
 *  2. Si no coinciden en cantidad (una tool que se expandio a varias acciones, una observacion que
 *     no se pudo tomar), se empareja SOLO por selector, y solo cuando ese selector aparece UNA vez
 *     de cada lado. Un selector ambiguo no empareja: preferimos un paso sin estrategias (que
 *     simplemente no se promueve) antes que un paso con las estrategias de OTRO elemento.
 */
function emparejarObservaciones(
  acciones: AccionCrudaDeMotor[],
  observaciones: ObservacionDePaso[],
  selectores: Array<string | null>,
): Array<ObservacionDePaso | undefined> {
  if (observaciones.length === acciones.length) return observaciones;

  const porSelector = new Map<string, ObservacionDePaso | null>();
  for (const observacion of observaciones) {
    const selector = observacion.selector;
    if (selector === null) continue;
    // Un selector repetido entre las observaciones queda marcado como ambiguo (null) y no empareja.
    porSelector.set(selector, porSelector.has(selector) ? null : observacion);
  }
  const repetidosEnAcciones = new Set<string>();
  const vistosEnAcciones = new Set<string>();
  for (const selector of selectores) {
    if (selector === null) continue;
    if (vistosEnAcciones.has(selector)) repetidosEnAcciones.add(selector);
    vistosEnAcciones.add(selector);
  }
  return selectores.map((selector) => {
    if (selector === null || repetidosEnAcciones.has(selector)) return undefined;
    return porSelector.get(selector) ?? undefined;
  });
}

/** El selector (xpath) que el motor registro para una accion cruda, o null. */
function selectorDeAccion(accion: AccionCrudaDeMotor): string | null {
  const pw =
    typeof accion.playwrightArguments === 'object' && accion.playwrightArguments !== null
      ? (accion.playwrightArguments as Record<string, unknown>)
      : null;
  return pw ? comoTexto(pw.selector) : null;
}

/**
 * Mapea las acciones crudas del motor a pasos censurados. Tolerante a cualquier shape (campos
 * faltantes o de tipo inesperado se degradan a null); el orden de llegada define idx.
 *
 * `observaciones` (CAMBIO 1) aporta las estrategias de localizacion leidas del DOM durante la
 * corrida. Sin ellas el mapeo es exactamente el de antes: la traza sigue siendo valida, solo que esa
 * corrida no se podra promover a receta.
 */
export function extraerPasosCensurados(
  acciones: AccionCrudaDeMotor[],
  observaciones: ObservacionDePaso[] = [],
): PasoCensurado[] {
  const emparejadas = emparejarObservaciones(
    acciones,
    observaciones,
    acciones.map(selectorDeAccion),
  );
  return acciones.map((accion, idx) => {
    const tipo = comoTexto(accion.type) ?? 'desconocida';
    // 'act' trae la instruccion en `action` ("click the login button"); otras tools la traen en
    // `instruction`. Ambas son texto libre del modelo: censura de texto (tarjetas embebidas).
    const instruccionCruda = comoTexto(accion.action) ?? comoTexto(accion.instruction);

    // playwrightArguments (solo en 'act'/'fillForm'): { selector, method, arguments } resuelto por
    // Stagehand sobre el DOM. Es el corazon de la futura receta.
    const pw =
      typeof accion.playwrightArguments === 'object' && accion.playwrightArguments !== null
        ? (accion.playwrightArguments as Record<string, unknown>)
        : null;
    // Los pasos POR COORDENADAS ('click' y 'type' del modo hibrido) NO traen playwrightArguments:
    // Stagehand nunca resuelve un selector para ellos (ver click.d.ts / type.d.ts: sus argumentos son
    // `describe` y `coordinates`). Hasta este PR se registraban sin metodo, sin argumentos y sin
    // selector, y por tanto eran irrepetibles. Ahora se derivan de la forma de la propia accion
    // (CAMBIO 2) y su selector sale de la OBSERVACION, que resolvio el elemento en esas coordenadas.
    const porCoordenadas = pw === null && (tipo === 'click' || tipo === 'type');
    const observacion = emparejadas[idx];
    const selectorDelMotor = pw ? comoTexto(pw.selector) : null;
    const selector = selectorDelMotor ?? observacion?.selector ?? null;
    const metodo = pw ? comoTexto(pw.method) : porCoordenadas ? tipo : null;
    const descripcionPw = (pw ? comoTexto(pw.description) : null) ?? comoTexto(accion.describe);
    const argumentosCrudos = pw
      ? Array.isArray(pw.arguments)
        ? pw.arguments.filter((a): a is string => typeof a === 'string')
        : []
      : porCoordenadas && tipo === 'type'
        ? [comoTexto(accion.text)].filter((a): a is string => a !== null)
        : [];

    // El contexto de censura junta TODO lo que delata un campo sensible: el selector del DOM, la
    // descripcion del elemento y la instruccion del modelo.
    const contexto = [selector ?? '', descripcionPw ?? '', instruccionCruda ?? ''].join(' ');
    const esTecleo = metodo !== null && METODOS_DE_TECLEO.has(metodo);
    // Tecleo SIN ninguna senal textual (los pasos sinteticos de fillForm no traen instruccion y su
    // descripcion puede faltar; el selector xpath de Stagehand es estructural, sin semantica): no se
    // puede juzgar si el campo es sensible -> se censura entero (criterio asimetrico, revision
    // adversarial). Con senal textual, decide censurarValor por contexto o por forma.
    const sinSenalTextual = esTecleo && descripcionPw === null && instruccionCruda === null;
    const argumentos = argumentosCrudos.map((arg) =>
      sinSenalTextual ? VALOR_CENSURADO : censurarValor(arg, contexto),
    );

    // Valor tecleado: solo en metodos de tecleo con argumentos. Ya viene censurado.
    const valorCensurado = esTecleo && argumentos.length > 0 ? argumentos.join(' ') : null;

    // La instruccion del modelo puede EMBEBER el valor tecleado ("type hunter2 into the password
    // field"): todo argumento que quedo censurado se borra tambien de la instruccion SIN distinguir
    // mayusculas (el modelo puede parafrasear la capitalizacion), y despues se pasa la censura de
    // texto (tarjetas o credenciales dictadas que no vinieran como argumento).
    let instruccion = instruccionCruda;
    if (instruccion !== null) {
      for (let i = 0; i < argumentosCrudos.length; i++) {
        const crudo = argumentosCrudos[i];
        if (argumentos[i] !== crudo && crudo !== undefined && crudo.length > 0) {
          const escapado = crudo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          instruccion = instruccion.replace(new RegExp(escapado, 'gi'), argumentos[i] ?? '');
        }
      }
      instruccion = censurarTexto(instruccion);
    }

    return {
      idx,
      accion: {
        tipo,
        instruccion,
        metodo,
        argumentos,
      },
      selector,
      valorCensurado,
      // Estrategias observadas del DOM durante la corrida (CAMBIO 1). Vacia si no hubo observacion:
      // ese paso no se promueve, la traza no cambia.
      estrategias: observacion?.estrategias ?? [],
      // La URL se persiste SIN query string ni fragment (tokens de reset, codigos OAuth y session
      // ids viajan ahi); una URL no parseable se descarta (censurarUrl).
      url: (() => {
        const cruda = comoTexto(accion.pageUrl);
        return cruda !== null ? censurarUrl(cruda) : null;
      })(),
      // Solo un false explicito del motor marca el paso como fallido; la ausencia del campo es exito
      // (la mayoria de las tools no reportan success cuando salieron bien).
      exito: accion.success !== false,
    };
  });
}
