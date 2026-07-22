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
 * Mapea las acciones crudas del motor a pasos censurados. Tolerante a cualquier shape (campos
 * faltantes o de tipo inesperado se degradan a null); el orden de llegada define idx.
 */
export function extraerPasosCensurados(acciones: AccionCrudaDeMotor[]): PasoCensurado[] {
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
    const selector = pw ? comoTexto(pw.selector) : null;
    const metodo = pw ? comoTexto(pw.method) : null;
    const descripcionPw = pw ? comoTexto(pw.description) : null;
    const argumentosCrudos =
      pw && Array.isArray(pw.arguments)
        ? pw.arguments.filter((a): a is string => typeof a === 'string')
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
