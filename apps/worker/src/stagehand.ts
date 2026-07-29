import { Stagehand, tool } from '@browserbasehq/stagehand';
import type { AgentExecuteOptions, V3Options } from '@browserbasehq/stagehand';
import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';
import { z } from 'zod';
import {
  AccionBloqueadaError,
  AccionSinConfirmarError,
  CambioDeSitioError,
  FalloDeEsquemaDelMotorError,
  GuardiaBloqueoReintentosError,
} from './errores.js';
import { estrategiasDelSelectorParaElAtlas } from './atlas-sitios.js';
import { TOOL_CAMBIAR_DE_SITIO } from './prompt-tarea-web.js';
import {
  crearAcumuladorDeConsumo,
  crearPoliticaDeScreenshots,
  crearPreparadorDePaso,
  numeroDeMetadatos,
  type ConsumoDeCorrida,
  type ModoScreenshots,
  type PoliticaDeScreenshots,
} from './costo-modelo.js';
import type { Logger } from './logger.js';
import {
  crearControlDePercepcion,
  type ControlDePercepcion,
  type PerceptorDePagina,
} from './percepcion.js';
import { crearMiddlewareDeModelo, instalarNormalizadorDeElementId } from './normalizador-elementid.js';
import type { EscaladorDePaso, ResultadoEscalada } from './ejecutor-receta.js';
import type { AccionCrudaDeMotor } from './trayectoria.js';
import type {
  CambiadorDeSitio,
  CambioDeSitioPedido,
  GuardiaDeAccion,
  MotorDeTareaWeb,
  PasoObservado,
  ResultadoMotor,
} from './tarea-web.js';

/**
 * ADAPTADOR real del puerto MotorDeTareaWeb (tarea-web.ts) sobre Stagehand v3
 * (@browserbasehq/stagehand 3.6.0). Este modulo es el UNICO del worker que importa Stagehand; el
 * handler y los tests no lo tocan (los tests pasan fakes y jamas llaman al modelo).
 *
 * Decisiones atadas a la API de Stagehand v3 (dist/esm/lib/v3/types/public/options.d.ts y v3.d.ts):
 *  - Se ADHIERE a la sesion de Browserbase YA creada y verificada por el handler via
 *    `browserbaseSessionID` (V3Options): Stagehand NO crea sesion nueva, asi el pin de
 *    contexto+proxy y la verificacion de egress_ip ocurren ANTES y fuera de Stagehand.
 *  - `keepAlive: true` para que el close() de Stagehand no libere la sesion: el handler todavia
 *    extrae el contexto actualizado despues, y el cierre real lo hace SIEMPRE el handler en finally.
 *  - `model: { modelName, apiKey }`: la inferencia corre con la key del OWNER (boveda), formato
 *    proveedor/modelo (TAREA_WEB_MODEL; Haiku prohibido, validado en env.ts).
 *  - `disableAPI: true` + `experimental: true`: van JUNTOS y son deliberados (ver
 *    construirOpcionesStagehand); no quitar ninguno de los dos.
 *  - `agent({ systemPrompt })` + `execute({ instruction, maxSteps, signal })`: el system prompt
 *    anti-injection va por el canal de sistema y el OBJETIVO del usuario por el canal de
 *    instruccion; el contenido de las paginas jamas entra a ninguno de los dos.
 *  - `disablePino: true` y `verbose: 0`: cero logging propio de Stagehand (los logs del worker no
 *    deben arrastrar URLs ni contenido del sitio).
 *  - `callbacks.onEvidence`: Stagehand emite `step_finished` justo DESPUES de empujar las acciones
 *    de esa tool a la traza (v3AgentHandler). Es el gancho con el que el handler observa cada paso
 *    mientras corre y lee del DOM las estrategias de localizacion que la traza no trae (CAMBIO 1).
 *    Se pasa SOLO cuando el handler cableo un observador (TAREA_WEB_OBSERVADOR_PASOS): apagado, la
 *    corrida no abre ni una conexion CDP extra.
 *  - `tools: { act }`: la tool `act` va BLINDADA (ver crearActBlindado). Stagehand fusiona las tools
 *    recibidas DESPUES de su toolset nativo, asi que una con el mismo nombre lo reemplaza.
 *  - `toolTimeout`: techo por llamada de tool (TAREA_WEB_TOOL_TIMEOUT_SECONDS). Sin el, Stagehand
 *    aplica su default de 45 s y el worker no tiene forma de ajustarlo por despliegue.
 */
/**
 * Opciones del constructor de Stagehand. Exportada SOLO para que los tests validen esta
 * configuracion contra la validacion real de Stagehand (validateExperimentalFeatures) sin abrir un
 * navegador.
 *
 * `disableAPI: true` y `experimental: true` van JUNTOS y son deliberados; NO quitar ninguno:
 *  - `disableAPI: true`: la inferencia es LOCAL (nuestro proceso llama al proveedor con la key del
 *    owner); nada viaja al plano de API de Stagehand/Browserbase.
 *  - `experimental: true`: desbloquea el abort signal de execute(), que es como el deadline de
 *    pared del worker (runTimeoutMs, tarea-web.ts) corta una tarea colgada antes de que consuma
 *    minutos de Browserbase indefinidamente. Sin este flag, pasar `signal` lanza
 *    ExperimentalNotConfiguredError y la navegacion falla de inmediato.
 *  - Auditado en 3.6.0: con disableAPI ya en true, `experimental: true` NO habilita ningun otro
 *    cambio de comportamiento (el cliente de API nunca se crea, el cache de servidor depende de ese
 *    cliente, y el resto de los sitios que reciben el flag no lo leen).
 */
export function construirOpcionesStagehand(params: {
  apiKey: string;
  projectId: string;
  sesionExternaId: string;
  model: string;
  modelApiKey: string;
  /**
   * Logger del middleware de modelo (FIX B y C). `model.middleware` es el UNICO punto de paso
   * obligatorio de la API de Stagehand: LLMProvider lo aplica a TODO LanguageModelV2 que cree para
   * esta instancia (cliente inicial, overrides por llamada y bucle del agente), asi que ningun
   * camino puede nacer sin la normalizacion de elementId ni sin la marca de cache del prefijo.
   * Opcional solo para los tests de esta configuracion, que no ejecutan ninguna llamada.
   */
  logger?: Logger;
}): V3Options {
  const modelo: NonNullable<V3Options['model']> = {
    modelName: params.model,
    apiKey: params.modelApiKey,
  };
  if (params.logger !== undefined) {
    // Tipos estructurales del worker contra los del AI SDK: este es el UNICO punto en que se cruzan
    // (mismo criterio que los mensajes de costo-modelo.ts en prepareStep).
    (modelo as { middleware?: unknown }).middleware = crearMiddlewareDeModelo(params.logger);
  }
  return {
    env: 'BROWSERBASE',
    apiKey: params.apiKey,
    projectId: params.projectId,
    browserbaseSessionID: params.sesionExternaId,
    keepAlive: true,
    model: modelo,
    disableAPI: true,
    experimental: true,
    disablePino: true,
    verbose: 0,
  };
}

/**
 * BLINDAJE ANTE EL FALLO DE ESQUEMA DEL MOTOR (CAMBIO 2 y 3). Causa raiz, auditada en 3.6.0:
 * `formatTreeLine` (understudy/a11y/snapshot/treeFormatUtils.js) rotula cada linea del arbol de
 * accesibilidad con `node.encodedId ?? node.nodeId`; cuando `encodedId` queda undefined, el modelo
 * ve `[8246]` en vez de `[0-8246]`, lo copia tal cual y el esquema de `act` (lib/inference.js, que
 * exige `/^\d+-\d+$/` en `elementId`) rechaza la respuesta con NoObjectGeneratedError. El motor
 * devuelve ese fallo a la tool y el agente vuelve a intentar lo mismo, sin espera y sin cota: en
 * produccion (25 jul 2026) giro casi 4 minutos sin registrar un solo paso.
 *
 * La causa raiz la ataca el PARCHE de la libreria (patches/@browserbasehq+stagehand+3.6.0.patch):
 * un nodo sin `encodedId` valido ya no se rotula, asi que el modelo no puede copiar un id que el
 * esquema vaya a rechazar. Lo de aca abajo es la red de seguridad para lo que el parche no cubra.
 *
 * REINTENTO SOLO SI EL ID CAMBIA. El fallo NO es intermitente: el mismo arbol produce el mismo id
 * malformado y el mismo rechazo (produccion, 25 jul 2026: elementId "5662" rechazado cinco veces en
 * dos minutos). Por eso el reintento se condiciona al identificador: si dos intentos seguidos fallan
 * con el MISMO elementId, la corrida se corta en el acto en vez de quemar pasos y minutos de
 * navegador en algo que no se va a resolver solo. Solo se reintenta cuando el id cambia entre
 * intentos (ahi si puede ser otra rama del arbol) o cuando no se pudo leer del error.
 */
/** Reintentos de la MISMA llamada de act ante un rechazo de esquema, antes de darla por fallida. */
export const MAX_REINTENTOS_ESQUEMA = 2;
/** Espera entre reintentos: el fallo es intermitente, un respiro corto basta. */
export const ESPERA_ENTRE_REINTENTOS_ESQUEMA_MS = 1000;
/** Fallos de esquema CONSECUTIVOS (ya agotados los reintentos) que cortan la corrida. */
export const MAX_FALLOS_ESQUEMA_CONSECUTIVOS = 3;

/** Nombres de error que el AI SDK y Stagehand usan para un rechazo de esquema de la salida. */
const NOMBRES_DE_FALLO_DE_ESQUEMA = [
  'NoObjectGeneratedError',
  'TypeValidationError',
  'ZodSchemaValidationError',
  'ZodError',
];

/** Marcas del mensaje, para las envolturas que pierden el nombre del error original. */
const MARCAS_DE_FALLO_DE_ESQUEMA = [
  'no object generated',
  'did not match schema',
  'response did not match',
  'schema validation',
];

/**
 * Reconoce un RECHAZO DE ESQUEMA del motor (NoObjectGeneratedError y la validacion de tipo que lo
 * acompana), mirando tambien la cadena de `cause`: el AI SDK envuelve el error de validacion dentro
 * del error de generacion. Acotado en profundidad para no recorrer una cadena circular.
 */
export function esFalloDeEsquemaDelMotor(error: unknown, profundidad = 0): boolean {
  if (typeof error !== 'object' || error === null || profundidad > 3) return false;
  const { name, message, cause } = error as { name?: unknown; message?: unknown; cause?: unknown };
  const nombre = typeof name === 'string' ? name : '';
  if (NOMBRES_DE_FALLO_DE_ESQUEMA.some((conocido) => nombre.includes(conocido))) return true;
  const texto = typeof message === 'string' ? message.toLowerCase() : '';
  if (MARCAS_DE_FALLO_DE_ESQUEMA.some((marca) => texto.includes(marca))) return true;
  return esFalloDeEsquemaDelMotor(cause, profundidad + 1);
}

/** El `elementId` dentro de un objeto con la forma de la salida de `act` ({ action: { elementId } }). */
function elementIdDeSalida(valor: unknown): string | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const accion = (valor as { action?: unknown }).action;
  if (typeof accion !== 'object' || accion === null) return null;
  const elementId = (accion as { elementId?: unknown }).elementId;
  return typeof elementId === 'string' && elementId.length > 0 ? elementId : null;
}

/** El `elementId` de una issue de Zod cuyo path termina en 'elementId' (Zod v4 adjunta el input). */
function elementIdDeIssues(valor: unknown): string | null {
  if (!Array.isArray(valor)) return null;
  for (const issue of valor) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { path, input } = issue as { path?: unknown; input?: unknown };
    if (!Array.isArray(path) || path[path.length - 1] !== 'elementId') continue;
    if (typeof input === 'string' && input.length > 0) return input;
  }
  return null;
}

/**
 * Lee el `elementId` que el motor RECHAZO, recorriendo la cadena de `cause` igual que
 * esFalloDeEsquemaDelMotor. El AI SDK deja el valor en varios sitios segun la envoltura, asi que se
 * prueban todos, del mas estructurado al mas debil:
 *
 *  1. `value` de TypeValidationError: el objeto ya parseado que no valido.
 *  2. `text` de NoObjectGeneratedError: el JSON crudo que devolvio el modelo.
 *  3. `issues` de ZodError: la issue de `elementId` con su input.
 *  4. El mensaje, por si la envoltura perdio todo lo anterior y solo dejo el texto serializado.
 *
 * null = no se pudo leer. El llamador NO asume nada en ese caso: sin identificador no se puede
 * afirmar que el fallo se repita, asi que el reintento sigue su curso normal.
 */
export function elementIdDeFalloDeEsquema(error: unknown, profundidad = 0): string | null {
  if (typeof error !== 'object' || error === null || profundidad > 3) return null;
  const { value, text, issues, message, cause } = error as {
    value?: unknown;
    text?: unknown;
    issues?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  const deValue = elementIdDeSalida(value);
  if (deValue !== null) return deValue;
  if (typeof text === 'string') {
    try {
      const deTexto = elementIdDeSalida(JSON.parse(text));
      if (deTexto !== null) return deTexto;
    } catch {
      // texto que no es JSON: se sigue con las otras fuentes
    }
  }
  const deIssues = elementIdDeIssues(issues);
  if (deIssues !== null) return deIssues;
  if (typeof message === 'string') {
    const enMensaje = /"elementId"\s*:\s*"([^"]+)"/.exec(message);
    if (enMensaje?.[1] !== undefined) return enMensaje[1];
  }
  return elementIdDeFalloDeEsquema(cause, profundidad + 1);
}

/** Salida de la tool `act` hacia el modelo, con la MISMA forma que la nativa de Stagehand. */
export interface SalidaDeActBlindado {
  success: boolean;
  action?: string;
  error?: string;
  playwrightArguments?: unknown;
}

/** Lo minimo que el blindaje necesita de `stagehand.act` (los tests pasan una funcion propia). */
interface ResultadoDeActCrudo {
  success?: boolean;
  actionDescription?: string;
  actions?: unknown[];
}

export interface ActBlindado {
  /** Ejecuta UNA accion con reintento ante rechazo de esquema. Lanza al alcanzar el corte. */
  ejecutar(accion: string): Promise<SalidaDeActBlindado>;
  /** true si la corrida se corto por fallo de esquema del motor (CAMBIO 3). */
  corto(): boolean;
  /**
   * El error EXACTO con el que se corto la corrida (racha de fallos o repeticion determinista del
   * mismo elementId), o null si no se corto. El adaptador lo re-lanza tal cual: el handler de
   * Stagehand atrapa lo que sale de la tool, asi que este es el unico camino por el que el motivo
   * real del corte llega al diagnostico.
   */
  corte(): FalloDeEsquemaDelMotorError | null;
  /** Mensaje de la detencion si la GUARDIA bloqueo una accion; null si nunca bloqueo. */
  bloqueo(): string | null;
  /**
   * true en cuanto la guardia AUTORIZO una accion irreversible (veredicto 'permitir' con
   * confirmacion). Marca el fin del tramo que PRECEDE a esa accion, que es lo que la politica de
   * capturas necesita saber en modo 'minimo'.
   */
  autorizoIrreversible(): boolean;
  /**
   * Mensaje del cierre si una accion irreversible se ejecuto y NO se pudo confirmar su efecto
   * (CAMBIO 4); null si no ocurrio. Viaja por el mismo camino que el bloqueo: la excepcion que sale
   * de la tool la atrapa el handler de Stagehand, asi que el adaptador la reconstruye al terminar.
   */
  sinConfirmar(): string | null;
  /**
   * Mensaje del corte si la guardia bloqueo el reintento irreversible por SEGUNDA vez consecutiva
   * (FIX C); null si no ocurrio. El adaptador lo convierte en GuardiaBloqueoReintentosError, cuyo
   * nombre es el prefijo estable GUARDIA_BLOQUEO_REINTENTOS_IRREVERSIBLES del last_error.
   */
  reintentosAgotados(): string | null;
}

/** Espera real entre reintentos; los tests inyectan la suya para no dormir. */
function esperarMs(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

function mensajeDeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'error desconocido';
}

/**
 * Envuelve la llamada de act del agente (CAMBIO 2 y 3). Modulo puro sobre una funcion `actuar`: se
 * testea sin navegador y sin modelo.
 *
 *  - Rechazo de esquema con un elementId DISTINTO al del intento anterior (o ilegible): hasta
 *    MAX_REINTENTOS_ESQUEMA reintentos con ESPERA_ENTRE_REINTENTOS_ESQUEMA_MS entre ellos, cada uno
 *    logueado en warn como fallo del MOTOR (no del objetivo del usuario). Agotados, la llamada se
 *    devuelve al modelo como fallo de la tool, igual que la act nativa.
 *  - Rechazo de esquema con el MISMO elementId que el intento anterior: NO se reintenta. Es el fallo
 *    determinista de produccion; reintentarlo solo quema pasos y minutos de navegador. LANZA en el
 *    acto con el identificador en el mensaje.
 *  - MAX_FALLOS_ESQUEMA_CONSECUTIVOS de fallos seguidos (contando por llamada de tool): LANZA.
 *    Lanzar desde la tool corta el bucle del agente en el acto; el adaptador re-lanza el error
 *    exacto que se guardo en `corte()`.
 *  - Un act exitoso reinicia el contador y el ultimo elementId visto.
 *  - Cualquier OTRO fallo (elemento inexistente, timeout) se devuelve al modelo tal como hace la act
 *    nativa y NO cuenta para el corte: no es un fallo del motor.
 *
 * TRAYECTORIA (CAMBIO 7 y este PR): la accion se reporta por `registrarAccion` ANTES de tocar el
 * navegador y el MISMO registro se completa con el desenlace cuando la llamada termina. Registrarla
 * despues perdia toda accion que estuviera en vuelo (o entre reintentos) cuando la corrida se
 * cancelaba, que es por lo que una tarea cancelada quedaba con cero pasos.
 *
 * GUARDIA (este PR): `guardia` es el UNICO punto del sistema en que codigo del worker ve una accion
 * del agente ANTES de que llegue al navegador. Se consulta UNA vez por llamada (no por reintento de
 * esquema: el reintento repite una accion que nunca llego a ejecutarse) y su veredicto es final. Si
 * bloquea, se LANZA: devolverle el bloqueo al modelo como un fallo de tool lo dejaria libre para
 * buscar otra ruta hacia la misma accion, que es justo lo que no puede pasar.
 */
export function crearActBlindado(params: {
  actuar: (accion: string) => Promise<ResultadoDeActCrudo>;
  logger: Logger;
  registrarAccion?: ((accion: AccionCrudaDeMotor) => void) | undefined;
  esperar?: ((ms: number) => Promise<void>) | undefined;
  guardia?: GuardiaDeAccion | undefined;
  /**
   * CORTE REAL del bucle del agente (FIX C). La evidencia de produccion del 27 jul demostro que
   * lanzar desde la tool NO detiene el bucle: el handler de Stagehand atrapa la excepcion y se la
   * devuelve al modelo como fallo de tool, y la corrida ciclo ~10 minutos contra la guardia hasta el
   * deadline de pared. Este hook aborta el signal de la corrida en el mismo instante en que el
   * blindaje registra un desenlace terminal (bloqueo, sin efecto confirmado, reintentos agotados o
   * corte por esquema): ninguna corrida vuelve a ciclar contra la guardia.
   */
  alTerminar?: (() => void) | undefined;
}): ActBlindado {
  const esperar = params.esperar ?? esperarMs;
  let fallosConsecutivos = 0;
  let corte: FalloDeEsquemaDelMotorError | null = null;
  let bloqueo: string | null = null;
  let sinConfirmar: string | null = null;
  let reintentosAgotados: string | null = null;
  let autorizoIrreversible = false;
  /** Ultimo elementId que el motor rechazo; se compara con el del intento siguiente. */
  let elementIdRechazado: string | null = null;

  // La accion entra a la traza al EMPEZAR y este registro se completa al terminar: lo que quede en
  // vuelo cuando la corrida se cancele ya esta registrado (como no exitoso, que es lo veraz).
  const registrarInicio = (accion: string): AccionCrudaDeMotor => {
    const registro: AccionCrudaDeMotor = { type: 'act', action: accion, success: false };
    params.registrarAccion?.(registro);
    return registro;
  };

  /** La llamada al navegador con su reintento por rechazo de esquema. Lanza al alcanzar el corte. */
  const actuarConReintentos = async (
    accion: string,
    registro: AccionCrudaDeMotor,
  ): Promise<SalidaDeActBlindado> => {
    for (let intento = 0; ; intento++) {
      try {
        const resultado = await params.actuar(accion);
        fallosConsecutivos = 0;
        elementIdRechazado = null;
        const exito = resultado.success ?? true;
        const primera = resultado.actions?.[0];
        registro.success = exito;
        if (primera !== undefined) registro.playwrightArguments = primera;
        return {
          success: exito,
          action: resultado.actionDescription ?? accion,
          ...(primera !== undefined ? { playwrightArguments: primera } : {}),
        };
      } catch (error) {
        if (!esFalloDeEsquemaDelMotor(error)) {
          return { success: false, error: mensajeDeError(error) };
        }
        // REPETICION DETERMINISTA: el motor rechazo el MISMO identificador dos veces seguidas. El
        // arbol que lo produce no cambia solo, asi que reintentar es tiempo de navegador tirado.
        const elementId = elementIdDeFalloDeEsquema(error);
        const repetido = elementId !== null && elementId === elementIdRechazado;
        elementIdRechazado = elementId;
        if (repetido) {
          fallosConsecutivos += 1;
          // El identificador es un numero del arbol de accesibilidad: no arrastra contenido.
          params.logger.warn(
            'tarea web: el motor de navegacion rechazo dos veces el MISMO identificador de elemento; se corta',
            { elementId },
          );
          corte = new FalloDeEsquemaDelMotorError(fallosConsecutivos, elementId);
          params.alTerminar?.();
          throw corte;
        }
        if (intento < MAX_REINTENTOS_ESQUEMA) {
          // Sin el texto de la accion ni el del error: pueden arrastrar contenido de la pagina.
          params.logger.warn(
            'tarea web: fallo de esquema del motor de navegacion al resolver una accion; se reintenta',
            { intento: intento + 1, reintentos: MAX_REINTENTOS_ESQUEMA },
          );
          await esperar(ESPERA_ENTRE_REINTENTOS_ESQUEMA_MS);
          continue;
        }
        fallosConsecutivos += 1;
        if (fallosConsecutivos >= MAX_FALLOS_ESQUEMA_CONSECUTIVOS) {
          corte = new FalloDeEsquemaDelMotorError(fallosConsecutivos);
          params.alTerminar?.();
          throw corte;
        }
        return {
          success: false,
          error:
            'el motor no pudo resolver un elemento valido para esa accion; describe otro elemento ' +
            'o usa otra herramienta',
        };
      }
    }
  };

  return {
    corto: () => corte !== null,
    corte: () => corte,
    bloqueo: () => bloqueo,
    sinConfirmar: () => sinConfirmar,
    reintentosAgotados: () => reintentosAgotados,
    autorizoIrreversible: () => autorizoIrreversible,
    ejecutar: async (accion: string): Promise<SalidaDeActBlindado> => {
      // La accion NO se registra en la traza: no llego al navegador. La constancia de por que se
      // bloqueo es el paso de verificacion que deja la propia guardia.
      const veredicto = await params.guardia?.revisar(accion);
      if (veredicto?.tipo === 'bloquear') {
        // Cada causa termina la corrida con SU error (y su prefijo estable de last_error). El hook
        // alTerminar aborta el bucle en el acto: lanzar desde la tool no basta (ver arriba).
        if (veredicto.causa === 'sin_efecto') {
          sinConfirmar = veredicto.mensaje;
          params.alTerminar?.();
          throw new AccionSinConfirmarError(veredicto.mensaje);
        }
        if (veredicto.causa === 'guardia_reintentos') {
          reintentosAgotados = veredicto.mensaje;
          params.alTerminar?.();
          throw new GuardiaBloqueoReintentosError(veredicto.mensaje);
        }
        bloqueo = veredicto.mensaje;
        params.alTerminar?.();
        throw new AccionBloqueadaError(veredicto.mensaje);
      }
      // INCOMPLETO (CAMBIO 1) y RECHAZAR (FIX C): la accion no pasa al navegador, pero la corrida NO
      // se corta. El motivo vuelve al modelo como fallo de la tool; en 'rechazar' el texto ademas es
      // terminal (la corrida terminara y el agente no debe insistir).
      if (veredicto?.tipo === 'incompleto' || veredicto?.tipo === 'rechazar') {
        return { success: false, error: veredicto.mensaje };
      }
      const registro = registrarInicio(accion);
      const salida = await actuarConReintentos(accion, registro);
      // CONFIRMACION (CAMBIO 4 + FIX A): tras EJECUTAR una accion irreversible se relee el DOM para
      // ver que surtio efecto. Corre haya salido bien o mal la llamada: lo que decide es la pagina,
      // no lo que reporte la tool. Sin confirmacion:
      //  - primera vez (terminal false): el mensaje vuelve al agente con la instruccion del UNICO
      //    reintento autorizado (act + rol/aria-label);
      //  - reintento (terminal true): la tarea termina aqui y NO se vuelve a intentar.
      if (veredicto?.tipo === 'permitir' && veredicto.confirmar === true && params.guardia) {
        autorizoIrreversible = true;
        const confirmacion = await params.guardia.confirmar();
        if (!confirmacion.confirmada) {
          if (!confirmacion.terminal) {
            return { success: false, error: confirmacion.mensaje };
          }
          sinConfirmar = confirmacion.mensaje;
          params.alTerminar?.();
          throw new AccionSinConfirmarError(confirmacion.mensaje);
        }
      }
      return salida;
    },
  };
}

/** Descripcion de la tool `act`, calcada de la nativa para no cambiar el prompt que ve el modelo. */
const DESCRIPCION_ACT =
  'Perform an action on the page (click, type). Provide a short, specific phrase that mentions the element type.';

/** Tool `act` BLINDADA que reemplaza a la nativa en el toolset del agente (mismo nombre y forma). */
function herramientaActBlindada(blindado: ActBlindado): NonNullable<
  Parameters<Stagehand['agent']>[0]
>['tools'] {
  return {
    act: tool({
      description: DESCRIPCION_ACT,
      inputSchema: z.object({
        action: z
          .string()
          .describe(
            'Describe what to click or type, e.g. "click the Login button" or "type "John" into the first name input"',
          ),
      }),
      execute: async ({ action }): Promise<SalidaDeActBlindado> => blindado.ejecutar(action),
    }),
  };
}

/** Salida de la tool de cambio de sitio hacia el modelo cuando el destino NO esta autorizado. */
export interface SalidaDeCambioDeSitio {
  success: boolean;
  error?: string;
}

/** La tool de cambio de sitio mas lo que el adaptador necesita saber al terminar la corrida. */
export interface CambiadorDeSitioBlindado {
  herramienta: NonNullable<Parameters<Stagehand['agent']>[0]>['tools'];
  /** El cambio AUTORIZADO que corto esta corrida, o null si el agente nunca cambio de sitio. */
  solicitado(): CambioDeSitioPedido | null;
  /**
   * El cambio como PASO de la traza, o null. La tool LANZA para cortar el bucle, asi que Stagehand no
   * llega a empujar esa llamada a su propia traza: sin esto, el paso que explica por que la tarea
   * cambio de sitio no aparecia en la trayectoria que ve el usuario.
   */
  paso(): AccionCrudaDeMotor | null;
}

/** Tope del resumen que el agente puede llevarse al otro sitio (el handler lo vuelve a acotar). */
const MAX_RESUMEN_TOOL_CHARS = 4_000;

/**
 * TOOL DE CAMBIO DE SITIO (tareas multisitio). Solo se registra cuando el job autorizo MAS DE UN
 * sitio; con uno solo el toolset del agente queda exactamente como estaba.
 *
 * QUIEN DECIDE: el destino lo escribe el modelo, pero quien autoriza es `cambiador.solicitar`, que
 * compara contra la lista CERRADA del job (multisitio.ts). Un destino fuera de esa lista vuelve al
 * modelo como fallo de la tool -- no corta la tarea, porque un nombre mal escrito no es un ataque y
 * el agente puede corregirse -- y NADA se abre.
 *
 * POR QUE LANZA cuando el cambio SI se autoriza: el bucle del agente esta atado a la sesion de
 * navegador en la que arranco. Devolver "ok" y seguir el bucle dejaria al agente razonando sobre la
 * pagina del sitio anterior. Lanzar corta el bucle en el acto; el adaptador reconstruye el desenlace
 * y el handler abre (o reutiliza) la sesion del destino y vuelve a correr el motor alli.
 *
 * EL RESUMEN ES UN PARAMETRO DE LA TOOL, no el mensaje final del agente: cuando una tool lanza, el
 * mensaje final que devuelve el motor es el del error, no el del agente. Pedirlo aqui es lo unico
 * que garantiza que lo que el agente traiga del sitio anterior sobreviva al cambio. El handler lo
 * trata como DATO no confiable (delimitado y censurado), nunca como instruccion.
 */
export function crearCambiadorDeSitio(params: {
  cambiador: CambiadorDeSitio;
  registrarAccion?: ((accion: AccionCrudaDeMotor) => void) | undefined;
}): CambiadorDeSitioBlindado {
  let solicitado: CambioDeSitioPedido | null = null;
  let paso: AccionCrudaDeMotor | null = null;
  return {
    solicitado: () => solicitado,
    paso: () => paso,
    herramienta: {
      [TOOL_CAMBIAR_DE_SITIO]: tool({
        description:
          'Cambia a otro de los sitios conectados que esta tarea autoriza. Termina lo que estas ' +
          'haciendo en el sitio actual: lo unico que llevas contigo es lo que escribas en `resumen`.',
        inputSchema: z.object({
          dominio: z
            .string()
            .describe('Dominio exacto del sitio autorizado al que quieres cambiar, sin https ni rutas'),
          resumen: z
            .string()
            .describe(
              'Todo lo que encontraste en el sitio actual y necesitas para continuar la tarea en el otro sitio',
            ),
        }),
        execute: async ({ dominio, resumen }): Promise<SalidaDeCambioDeSitio> => {
          const veredicto = params.cambiador.solicitar(dominio);
          if (veredicto.tipo === 'rechazado') {
            return { success: false, error: veredicto.mensaje };
          }
          solicitado = { dominio: veredicto.dominio, resumen: resumen.slice(0, MAX_RESUMEN_TOOL_CHARS) };
          // EL CAMBIO QUEDA EN LA TRAYECTORIA: es un paso mas de lo que la tarea hizo, con el destino
          // (un dominio ya autorizado, nunca texto libre del modelo) como unica informacion. Se
          // reporta por los DOS caminos porque solo uno de ellos ocurre: `registrarAccion` cubre la
          // corrida que ademas lanza (cancelacion, deadline), y `paso()` la que devuelve normalmente.
          paso = {
            type: TOOL_CAMBIAR_DE_SITIO,
            action: `cambio al sitio ${veredicto.dominio}`,
            success: true,
          };
          params.registrarAccion?.(paso);
          throw new CambioDeSitioError(veredicto.dominio);
        },
      }),
    },
  };
}

/** Salida de la tool `screenshot`, con la MISMA forma que la nativa de Stagehand (agent/tools). */
export interface SalidaDeScreenshot {
  success: boolean;
  base64?: string;
  timestamp?: number;
  pageUrl?: string;
  /** true cuando la politica de capturas decidio NO tomar la foto (no es un fallo). */
  omitido?: boolean;
  error?: string;
}

/**
 * Texto que vuelve al modelo cuando la captura se omite. Dice el MOTIVO, no una negativa a secas: el
 * agente pidio la foto para ver el estado de la pagina, y "la pagina sigue siendo la misma" es
 * exactamente esa informacion, sin los miles de tokens que cuesta la imagen.
 */
const MOTIVO_SCREENSHOT_OMITIDO =
  'screenshot no tomado: la pagina no cambio desde la observacion anterior (misma URL y mismo ' +
  'titulo), asi que la imagen seria identica a la que ya tienes. Sigue con la tarea.';

/** Descripcion de la tool `screenshot`, calcada de la nativa para no cambiar el prompt del modelo. */
const DESCRIPCION_SCREENSHOT =
  'Takes a screenshot (PNG) of the current page. Use this to quickly verify page state.';

/** Lo minimo que la tool necesita de la pagina de Stagehand (los tests pasan un objeto propio). */
export interface PaginaObservable {
  url(): string;
  title(): Promise<string>;
  screenshot(opciones: { fullPage: boolean }): Promise<Buffer>;
}

/**
 * Tool `screenshot` BAJO POLITICA (TAREA_WEB_SCREENSHOTS), que reemplaza a la nativa por el mismo
 * mecanismo que `act` (mismo nombre y misma forma de salida, fusionada DESPUES del toolset nativo).
 *
 * Una captura es lo mas caro que entra al contexto del modelo, y en la mayoria de los pasos es la
 * MISMA pagina que el agente ya tiene delante. La politica decide; la tool solo obedece y, cuando
 * captura, devuelve exactamente lo que devolveria la nativa (mismo `toModelOutput`, mismo formato de
 * imagen), asi que el modelo no puede notar diferencia alguna en las capturas que si se toman.
 *
 * La URL y el titulo se leen de la pagina YA conectada (sin abrir nada nuevo) y JAMAS se loguean: los
 * logs del worker no arrastran URLs ni contenido del sitio.
 */
export function herramientaScreenshotConPolitica(params: {
  politica: PoliticaDeScreenshots;
  pagina: () => Promise<PaginaObservable>;
}): NonNullable<Parameters<Stagehand['agent']>[0]>['tools'] {
  return {
    screenshot: tool({
      description: DESCRIPCION_SCREENSHOT,
      inputSchema: z.object({}),
      execute: async (): Promise<SalidaDeScreenshot> => {
        try {
          const pagina = await params.pagina();
          const url = pagina.url();
          const titulo = await pagina.title();
          if (!params.politica.permitir({ url, titulo })) {
            return { success: true, omitido: true, pageUrl: url };
          }
          const imagen = await pagina.screenshot({ fullPage: false });
          return {
            success: true,
            base64: imagen.toString('base64'),
            timestamp: Date.now(),
            pageUrl: url,
          };
        } catch (error) {
          return { success: false, error: `Error taking screenshot: ${mensajeDeError(error)}` };
        }
      },
      toModelOutput: (resultado: SalidaDeScreenshot) => {
        if (resultado.omitido === true) {
          return {
            type: 'content' as const,
            value: [{ type: 'text' as const, text: MOTIVO_SCREENSHOT_OMITIDO }],
          };
        }
        if (resultado.success === false || resultado.base64 === undefined) {
          return {
            type: 'content' as const,
            value: [{ type: 'text' as const, text: JSON.stringify(resultado) }],
          };
        }
        return {
          type: 'content' as const,
          value: [{ type: 'media' as const, mediaType: 'image/png', data: resultado.base64 }],
        };
      },
    }),
  };
}

/**
 * TOOLS QUE SE RETIRAN cuando la corrida lleva GUARDIA (revision adversarial). La guardia solo puede
 * interponerse en `act`, que es la unica tool que este worker reemplaza; el resto del toolset nativo
 * de Stagehand va directo al navegador. Cuatro de esas tools alcanzan la MISMA accion irreversible
 * sin pasar por la comparacion:
 *  - `keys`: manda pulsaciones a donde este el foco. Un "Control+Enter" envia el correo que la
 *    guardia acaba de detener.
 *  - `fillForm`: observa y actua sobre cada campo que le describan; su descripcion es texto libre,
 *    asi que puede resolver un boton igual que un input.
 *  - `click` y `type` (modo hibrido, POR COORDENADAS): no llevan descripcion que la guardia pueda
 *    clasificar y no resuelven ningun selector. En produccion (27 jul 2026, pasos 36-42) el click
 *    final del envio salio por esta via, golpeo la cabecera del compose en vez del boton Enviar y
 *    dejo la corrida en el limbo "ejecutada sin efecto". Los clicks por coordenadas quedan
 *    PROHIBIDOS en toda corrida con guardia (FIX A): `act` resuelve el elemento por descripcion y
 *    es la unica via de interaccion permitida.
 * Retirarlas deja a `act` como unica via de interaccion en las tareas que piden una accion bloqueada.
 * En el resto de las tareas (y en la reanudacion tras una decision humana) el toolset queda intacto:
 * no hay accion que verificar y no tiene sentido pagar el costo en capacidad.
 */
export const TOOLS_RETIRADAS_CON_GUARDIA: readonly string[] = ['keys', 'fillForm', 'click', 'type'];

/**
 * Opciones de `agent.execute()`. Exportada para poder fijar en un test lo que NO lleva: sin
 * observador NO se pasa `callbacks.onEvidence` (CAMBIO 5), y con el, Stagehand no captura nada extra
 * por su cuenta. `toolTimeout` (CAMBIO 4) acota CADA llamada de tool del agente: sin el, una tool
 * colgada se come el deadline de pared entero.
 */
export function construirOpcionesDeEjecucion(params: {
  objetivo: string;
  maxPasos: number;
  toolTimeoutMs: number;
  signal?: AbortSignal | undefined;
  observador?: ((paso: PasoObservado) => Promise<void>) | undefined;
  /**
   * REGISTRO EN VIVO de las tools que NO son `act` (goto, extract, click, type, fillForm, keys...).
   * `act` no entra por aca: crearActBlindado ya la registra, y ademas la registra ANTES de tocar el
   * navegador. Sin esto, una corrida que LANZA (cancelacion, deadline o corte por esquema) perdia
   * todas las acciones que no fueran `act`, porque la traza del motor solo llega cuando devuelve.
   */
  registrarAccion?: ((accion: AccionCrudaDeMotor) => void) | undefined;
  /** La corrida lleva guardia: se retiran las tools que llegarian al navegador sin pasar por ella. */
  conGuardia?: boolean | undefined;
  /** Ventana de historial que se reenvia al modelo (TAREA_WEB_HISTORIAL_PASOS). */
  historialPasos: number;
  /** Recibe el consumo de CADA llamada al modelo (tokens de entrada, salida y de cache). */
  registrarConsumo?: ((paso: PasoDeConsumoDelBucle) => void) | undefined;
  /**
   * PERCEPCION DE EFECTO Y DE CAMPOS (FIX A y B): tras cada paso que toca la pagina, el control lee
   * la huella y el estado de campos (percepcion.ts) y sus lineas pendientes se ADJUNTAN al contexto
   * del agente en el siguiente prepareStep, como mensaje de usuario acotado. Ausente, la corrida
   * queda exactamente como antes: cero lecturas extra y cero mensajes extra.
   */
  percepcion?: ControlDePercepcion | undefined;
  /**
   * ATLAS DE SITIOS: recibe, por cada evento del bucle, UNA lista de estrategias POR ACCION que ese
   * evento empuja a la traza del motor (la primera lleva lo que la percepcion leyo del elemento
   * tocado; donde la percepcion no dio nada entra el complemento por selector). Emitir una por
   * accion es lo que mantiene el emparejamiento posicional con la traza; sin percepcion cableada no
   * se pasa, y entonces no se emite nada.
   */
  registrarEstrategias?: ((porAccion: EstrategiaLocalizacion[][]) => void) | undefined;
}): AgentExecuteOptions {
  const observador = params.observador;
  const registrarAccion = params.registrarAccion;
  const registrarConsumo = params.registrarConsumo;
  const percepcion = params.percepcion;
  const registrarEstrategias = params.registrarEstrategias;
  // PREPARACION POR PASO (cache de prompt + system por su canal + ventana de historial). Tiene
  // estado (la longitud del envio anterior), asi que se crea uno por corrida.
  const preparador = crearPreparadorDePaso({ historialPasos: params.historialPasos });
  return {
    instruction: params.objetivo,
    maxSteps: params.maxPasos,
    toolTimeout: params.toolTimeoutMs,
    ...(params.signal !== undefined ? { signal: params.signal } : {}),
    ...(params.conGuardia === true ? { excludeTools: [...TOOLS_RETIRADAS_CON_GUARDIA] } : {}),
    callbacks: {
      // Stagehand invoca este callback al final de SU preparacion de cada paso y usa tal cual lo que
      // devuelve (v3AgentHandler.createPrepareStep): es el unico punto desde el que el worker decide
      // que mensajes viajan, por que canal van las instrucciones de sistema y que prefijo se cachea.
      prepareStep: (opciones) => {
        const preparado = preparador(opciones.messages);
        // Las lineas de percepcion pendientes (FIX A y B) entran como UN mensaje de usuario al
        // final del envio: es informacion del SISTEMA sobre el efecto real del paso anterior, no
        // contenido de pagina, y el propio texto de cada linea lo dice. Acotadas por turno
        // (MAX_LINEAS_POR_TURNO) para que el canal no crezca sin cota.
        const lineas = percepcion?.tomarLineas() ?? [];
        const mensajes =
          lineas.length > 0
            ? [...preparado.messages, { role: 'user' as const, content: lineas.join('\n') }]
            : preparado.messages;
        return {
          ...(preparado.system !== undefined ? { system: preparado.system } : {}),
          // El tipo estructural de costo-modelo.ts y el ModelMessage del AI SDK describen la misma
          // forma; este es el UNICO punto del worker en que se cruzan.
          messages: mensajes as unknown as typeof opciones.messages,
        };
      },
      // CONSUMO POR PASO: el resultado del motor solo reporta entrada y salida totales; los tokens
      // leidos y creados en cache -- lo unico que dice si el cache de prompt esta funcionando --
      // solo viajan aca (el creado en cache, en los metadatos del proveedor).
      ...(registrarConsumo !== undefined
        ? {
            onStepFinish: (paso): void => {
              const anthropic = (paso.providerMetadata as Record<string, unknown> | undefined)?.[
                'anthropic'
              ];
              registrarConsumo({
                tokensEntrada: paso.usage.inputTokens,
                tokensSalida: paso.usage.outputTokens,
                tokensLeidosDeCache: paso.usage.cachedInputTokens,
                tokensCreadosEnCache: numeroDeMetadatos(anthropic, 'cacheCreationInputTokens'),
              });
            },
          }
        : {}),
      // Best-effort SIEMPRE: la observacion enriquece la traza; si falla, la tarea sigue
      // igual y esa corrida simplemente no se podra promover a receta.
      ...(observador !== undefined || registrarAccion !== undefined || percepcion !== undefined
        ? {
            onEvidence: async (evento): Promise<void> => {
              if (evento.type !== 'step_finished') return;
              if (registrarAccion !== undefined && evento.actionName !== 'act') {
                registrarAccion(accionCrudaDeEvidencia(evento));
              }
              // PERCEPCION (FIX A y B): se corre AQUI porque Stagehand espera (await) este callback
              // antes de la siguiente llamada al modelo, asi que las lineas quedan listas para el
              // prepareStep que sigue. alTerminarPaso nunca lanza (best-effort interno).
              if (percepcion !== undefined) {
                // ATLAS DE SITIOS: una entrada POR ACCION empujada por este evento (una tool puede
                // empujar varias: fillForm empuja la suya mas una por campo). Las ranuras se calculan
                // ANTES de leer y se emiten SIEMPRE, aunque la lectura falle: el emparejamiento con
                // la traza es POSICIONAL, asi que un evento que no emitiera las suyas correria de
                // lugar a todas las siguientes y el aprendizaje entero de la corrida se descartaria.
                const ranuras = pasosObservadosDeEvidencia(evento);
                let porAccion = ranuras.map((): EstrategiaLocalizacion[] => []);
                try {
                  const estrategias = await percepcion.alTerminarPaso({
                    actionName: evento.actionName,
                    actionArgs: evento.actionArgs,
                    toolOutput: { result: evento.toolOutput.result },
                  });
                  // Lo leido pertenece a la PRIMERA ranura, que es la accion de la tool; las demas
                  // quedan como estaban.
                  //
                  // LA PERCEPCION ES LA FUENTE PRIMARIA, y el SELECTOR solo la COMPLEMENTA: cuando la
                  // lectura no devolvio nada para una accion (elemento ya destruido, no resoluble o no
                  // enfocable) se derivan los predicados de atributo del selector que el motor resolvio
                  // para ESA accion. Nunca la reemplaza ni la mezcla: donde la percepcion dio algo, eso
                  // es lo que viaja, tal cual. Es lo que cubre las acciones finales, que destruyen su
                  // propio contexto y que ninguna lectura posterior puede alcanzar (el boton Enviar).
                  porAccion = ranuras.map((paso, indice) => {
                    const percibidas = indice === 0 ? estrategias : [];
                    return percibidas.length > 0
                      ? percibidas
                      : estrategiasDelSelectorParaElAtlas(paso.selector);
                  });
                } catch {
                  // una lectura rota cuesta el dato del atlas de ESE evento, jamas la alineacion
                }
                registrarEstrategias?.(porAccion);
              }
              if (observador === undefined) return;
              try {
                for (const paso of pasosObservadosDeEvidencia(evento)) await observador(paso);
              } catch {
                // una observacion fallida jamas cambia el desenlace de la tarea
              }
            },
          }
        : {}),
    },
  };
}

/** Lo que el bucle del agente reporta de consumo en CADA llamada al modelo. */
export interface PasoDeConsumoDelBucle {
  tokensEntrada?: number | undefined;
  tokensSalida?: number | undefined;
  tokensLeidosDeCache?: number | undefined;
  tokensCreadosEnCache?: number | undefined;
}

/** Campos de `actionArgs` que describen la accion en TEXTO y que la traza del motor tambien lleva. */
const CAMPOS_DE_TEXTO_DE_TOOL = ['action', 'instruction', 'describe', 'text'] as const;

/**
 * Traduce UN evento `step_finished` a la accion CRUDA que corresponde, con la misma forma con la que
 * el motor la pondria en su traza (`type`, texto de la accion, `success`).
 *
 * WHITELIST, igual que trayectoria.ts: de `actionArgs` se copian SOLO los campos de texto conocidos
 * y solo si son string. Nunca un spread del objeto crudo: los argumentos de una tool pueden traer
 * esquemas de extraccion, selectores y contenido de la pagina que no tienen por que entrar a la
 * traza (la censura de trayectoria.ts corre despues, pero el recorte empieza aca).
 */
export function accionCrudaDeEvidencia(evento: {
  actionName: string;
  actionArgs: Record<string, unknown>;
  toolOutput: { ok?: boolean };
}): AccionCrudaDeMotor {
  const textos: Record<string, string> = {};
  for (const campo of CAMPOS_DE_TEXTO_DE_TOOL) {
    const valor = evento.actionArgs[campo];
    if (typeof valor === 'string' && valor.length > 0) textos[campo] = valor;
  }
  return { type: evento.actionName, success: evento.toolOutput.ok !== false, ...textos };
}

/** Forma minima de la salida de una tool que trae selectores resueltos (act / fillForm). */
interface SalidaConSelectores {
  output?: unknown;
  playwrightArguments?: unknown;
}

/** El `selector` de un objeto Action de Stagehand ({ selector, description, method, arguments }). */
function selectorDeAction(valor: unknown): string | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const selector = (valor as { selector?: unknown }).selector;
  return typeof selector === 'string' && selector !== '' ? selector : null;
}

/**
 * Traduce UN evento `step_finished` a los pasos observados que le corresponden, en el MISMO orden y
 * cantidad en que Stagehand empuja acciones a la traza (mapToolResultToActions):
 *  - 'act' -> UNA accion con playwrightArguments.
 *  - 'fillForm' -> UNA accion de la propia tool MAS una por cada campo resuelto.
 *  - 'click' / 'type' (modo hibrido) -> UNA accion, sin selector: solo coordenadas.
 *  - cualquier otra tool -> UNA accion sin elemento.
 * Mantener la correspondencia 1 a 1 es lo que permite emparejar por posicion en trayectoria.ts.
 */
export function pasosObservadosDeEvidencia(evento: {
  actionName: string;
  actionArgs: Record<string, unknown>;
  toolOutput: { result: unknown };
}): PasoObservado[] {
  const crudo = evento.toolOutput.result;
  const envoltorio: SalidaConSelectores =
    typeof crudo === 'object' && crudo !== null ? (crudo as SalidaConSelectores) : {};
  const salida: SalidaConSelectores =
    typeof envoltorio.output === 'object' && envoltorio.output !== null
      ? (envoltorio.output as SalidaConSelectores)
      : envoltorio;

  if (evento.actionName === 'fillForm') {
    const campos = Array.isArray(salida.playwrightArguments) ? salida.playwrightArguments : [];
    return [
      { selector: null, punto: null },
      ...campos.map((campo) => ({ selector: selectorDeAction(campo), punto: null })),
    ];
  }
  if (evento.actionName === 'act') {
    return [{ selector: selectorDeAction(salida.playwrightArguments), punto: null }];
  }
  if (evento.actionName === 'click' || evento.actionName === 'type') {
    const coordenadas = evento.actionArgs.coordinates;
    const punto =
      Array.isArray(coordenadas) &&
      typeof coordenadas[0] === 'number' &&
      typeof coordenadas[1] === 'number'
        ? { x: coordenadas[0], y: coordenadas[1] }
        : null;
    return [{ selector: null, punto }];
  }
  return [{ selector: null, punto: null }];
}

/**
 * CONTROL DE PERCEPCION de una corrida, cableado sobre el perceptor que expone el navegador.
 *
 * Existe como funcion PROPIA Y EXPORTADA por una razon concreta: el OBJETIVO DE LECTURA del atlas
 * tiene que llegar HASTA el adaptador del navegador. Hasta el 29 jul 2026 este cableado llamaba a
 * `percibir()` sin reenviarlo, asi que `percibirPagina` armaba la expresion de siempre (la que NO
 * lee estrategias), `alTerminarPaso` devolvia lista vacia en todos los pasos y toda corrida del
 * motor libre llegaba al agregador sin una sola estrategia: cero entradas en el aprendizaje comun.
 * Nada de eso se podia fijar en un test porque vivia dentro de `ejecutar`, que ningun test
 * instancia (necesita Stagehand y una sesion real); aca si.
 */
export function crearPercepcionDeCorrida(params: {
  perceptor: PerceptorDePagina | undefined;
  /** Bloque "mapa conocido del sitio" (atlas): viaja por la cola de percepcion. */
  mapaDelSitio?: readonly string[] | undefined;
  logger?: Logger | undefined;
}): ControlDePercepcion | undefined {
  const perceptor = params.perceptor;
  if (perceptor === undefined) return undefined;
  return crearControlDePercepcion({
    // El objetivo viaja INTACTO: es lo unico que hace que la evaluacion que ya corre despues de cada
    // paso traiga ademas las estrategias del elemento tocado (lectura fusionada, percepcion.ts).
    percibir: (objetivo) => perceptor.percibir(objetivo),
    ...(params.mapaDelSitio !== undefined ? { mapaDelSitio: params.mapaDelSitio } : {}),
    ...(params.logger !== undefined ? { logger: params.logger } : {}),
  });
}

/**
 * UNA RANURA POR ACCION DE LA TRAZA, que es la condicion para que `extraerPasosCensurados`
 * (trayectoria.ts) empareje por posicion en vez de descartar la lista entera.
 *
 * Lo que emiten los eventos es siempre un PREFIJO de la traza: Stagehand empuja las acciones de una
 * tool y JUSTO DESPUES emite su `step_finished`, y este adaptador emite una ranura por cada accion
 * empujada. Lo que la traza puede tener de mas son acciones que NINGUN evento anuncia:
 *  - `done` SINTETICA: cuando el modelo cierra el bucle sin llamar a la tool, `ensureDone`
 *    (v3AgentHandler) la agrega a `state.actions` sin emitir evidencia.
 *  - el paso del CAMBIO DE SITIO, que agrega a mano este mismo adaptador.
 * Sin rellenar esas ranuras las cantidades no cuadran y se pierde el aprendizaje de la corrida
 * COMPLETA por una accion final que nadie podia percibir.
 *
 * Si llegaran MAS ranuras que acciones (ningun camino conocido lo produce) se devuelve lista vacia:
 * ahi el desfase no esta en la cola, la correspondencia por posicion ya no es confiable y el
 * criterio de siempre es no aprender nada antes que atribuirle a un paso el elemento de otro.
 */
export function ranurasPorAccion(
  emitidas: readonly EstrategiaLocalizacion[][],
  acciones: number,
): EstrategiaLocalizacion[][] {
  if (emitidas.length > acciones) return [];
  const ranuras = [...emitidas];
  while (ranuras.length < acciones) ranuras.push([]);
  return ranuras;
}

export class MotorStagehand implements MotorDeTareaWeb, EscaladorDePaso {
  constructor(
    private readonly config: {
      apiKey: string;
      projectId: string;
      model: string;
      /** Techo por llamada de tool del agente (TAREA_WEB_TOOL_TIMEOUT_SECONDS * 1000). */
      toolTimeoutMs: number;
      logger: Logger;
    },
  ) {}

  async ejecutar(params: {
    sesionExternaId: string;
    objetivo: string;
    systemPrompt: string;
    apiKey: string;
    model: string;
    maxPasos: number;
    signal?: AbortSignal;
    observador?: ((paso: PasoObservado) => Promise<void>) | undefined;
    registrarAccion?: ((accion: AccionCrudaDeMotor) => void) | undefined;
    guardia?: GuardiaDeAccion | undefined;
    cambiador?: CambiadorDeSitio | undefined;
    perceptor?: PerceptorDePagina | undefined;
    /** Bloque "mapa conocido del sitio" (atlas, V040): viaja por la cola de percepcion. */
    mapaDelSitio?: readonly string[] | undefined;
    historialPasos: number;
    modoScreenshots: ModoScreenshots;
    reportarConsumo?: ((consumo: ConsumoDeCorrida) => void) | undefined;
  }): Promise<ResultadoMotor> {
    const stagehand = new Stagehand(
      construirOpcionesStagehand({
        apiKey: this.config.apiKey,
        projectId: this.config.projectId,
        sesionExternaId: params.sesionExternaId,
        model: params.model,
        modelApiKey: params.apiKey,
        // El logger activa el middleware de modelo (FIX B y C): normalizacion de elementId antes de
        // validar y cache de prompt del prefijo en las llamadas de inferencia con esquema.
        logger: this.config.logger,
      }),
    );
    await stagehand.init();
    // SEGUNDA RED (FIX C del PR anterior): rescate post-rechazo sobre el cliente de instancia. El
    // middleware de modelo ya normaliza ANTES de validar; esto cubre la forma interna vieja si la
    // libreria cambiara la aplicacion del middleware.
    instalarNormalizadorDeElementId(stagehand, this.config.logger);
    // PERCEPCION (FIX A y B): el control lee la huella y los campos tras cada paso que toca la
    // pagina y sus lineas viajan al agente en el siguiente prepareStep. Solo si el handler cableo
    // un perceptor; sin el, cero lecturas extra.
    // ATLAS DE SITIOS (V040): el mapa se encola en el control y sale en el primer turno, dentro del
    // mismo tope por turno que el resto de la percepcion.
    const percepcion = crearPercepcionDeCorrida({
      perceptor: params.perceptor,
      ...(params.mapaDelSitio !== undefined ? { mapaDelSitio: params.mapaDelSitio } : {}),
      logger: this.config.logger,
    });
    // La huella INICIAL es el "antes" del primer paso (el primer click de la corrida tambien tiene
    // que poder reportarse sin efecto). Best-effort: si falla, el primer paso queda sin comparacion.
    if (percepcion !== undefined) await percepcion.inicializar();
    // ATLAS DE SITIOS: lo que la percepcion leyo del elemento de cada paso, UNA lista por accion de
    // la traza y en su mismo orden. Se acumula aqui y viaja en el resultado; el handler decide que
    // hace con ello (agregarlo al aprendizaje comun, best-effort y despues del desenlace).
    const estrategiasPorAccion: EstrategiaLocalizacion[][] = [];
    // El reporte se emite en el `finally`: una corrida que LANZA (deadline, cancelacion o corte por
    // esquema) es justo donde mas hace falta saber cuanto se gasto antes de cortarse.
    const consumo = crearAcumuladorDeConsumo();
    try {
      // CORTE REAL DEL BUCLE (FIX C): senal INTERNA encadenada a la externa. El blindaje la aborta
      // en el instante en que registra un desenlace terminal (bloqueo, sin efecto, reintentos
      // agotados o corte por esquema): en produccion quedo demostrado que lanzar desde la tool no
      // detiene el bucle (Stagehand devuelve la excepcion al modelo como fallo de tool) y la
      // corrida ciclo contra la guardia hasta el deadline de pared.
      const controlador = new AbortController();
      const alAbortarExterno = (): void => controlador.abort();
      if (params.signal?.aborted === true) controlador.abort();
      else params.signal?.addEventListener('abort', alAbortarExterno, { once: true });
      // La tool `act` del agente va BLINDADA (CAMBIO 2 y 3): misma forma que la nativa, con
      // reintento ante rechazo de esquema y corte por fallos consecutivos. Se pasa por `tools`, que
      // el handler de Stagehand fusiona DESPUES del toolset nativo y por tanto reemplaza a `act`.
      const blindado = crearActBlindado({
        actuar: (accion) => stagehand.act(accion, { timeout: this.config.toolTimeoutMs }),
        logger: this.config.logger,
        registrarAccion: params.registrarAccion,
        guardia: params.guardia,
        alTerminar: () => controlador.abort(),
      });
      // CAPTURAS BAJO POLITICA (TAREA_WEB_SCREENSHOTS): con 'siempre' NO se reemplaza la tool nativa
      // (cero intervencion, comportamiento historico exacto). Con los otros dos modos, la tool del
      // worker decide si la foto se toma; cuando se toma, devuelve lo mismo que la nativa.
      const politicaScreenshots =
        params.modoScreenshots === 'siempre'
          ? null
          : crearPoliticaDeScreenshots({
              modo: params.modoScreenshots,
              conGuardia: params.guardia !== undefined,
              yaAutorizo: () => blindado.autorizoIrreversible(),
            });
      // CAMBIO DE SITIO (multisitio): la tool solo existe cuando el job autorizo mas de un sitio.
      // Sin ella el toolset del agente es exactamente el de una tarea de un solo sitio.
      const cambiador =
        params.cambiador !== undefined
          ? crearCambiadorDeSitio({
              cambiador: params.cambiador,
              registrarAccion: params.registrarAccion,
            })
          : null;
      const agente = stagehand.agent({
        systemPrompt: params.systemPrompt,
        tools: {
          ...herramientaActBlindada(blindado),
          ...(politicaScreenshots !== null
            ? herramientaScreenshotConPolitica({
                politica: politicaScreenshots,
                pagina: () => stagehand.context.awaitActivePage(),
              })
            : {}),
          ...(cambiador !== null ? cambiador.herramienta : {}),
        },
      });
      // El desenlace TERMINAL registrado por el blindaje manda sobre lo que devuelva (o lance) el
      // bucle: cuando el hook alTerminar aborta la corrida, el error que sube es un abort generico y
      // el motivo real vive en el blindaje. Se consulta en los DOS caminos (retorno y excepcion).
      //
      // Orden: reintentos agotados y bloqueo primero (desenlaces decididos por el sistema, no fallos
      // del motor), despues la accion sin efecto confirmado y al final el corte por esquema.
      const convertirDesenlaceTerminal = (): Error | null => {
        const agotados = blindado.reintentosAgotados();
        if (agotados !== null) return new GuardiaBloqueoReintentosError(agotados);
        const bloqueo = blindado.bloqueo();
        if (bloqueo !== null) return new AccionBloqueadaError(bloqueo);
        const sinConfirmar = blindado.sinConfirmar();
        if (sinConfirmar !== null) return new AccionSinConfirmarError(sinConfirmar);
        // El error EXACTO del corte (racha de fallos o repeticion determinista del mismo elementId):
        // reconstruirlo aca perderia el identificador que hace veraz el diagnostico.
        return blindado.corte();
      };
      const resultado = await (async () => {
        try {
          return await agente.execute(
            construirOpcionesDeEjecucion({
              objetivo: params.objetivo,
              maxPasos: params.maxPasos,
              toolTimeoutMs: this.config.toolTimeoutMs,
              signal: controlador.signal,
              observador: params.observador,
              // Las tools que no son `act` se registran por evidencia; `act` ya la registra el blindaje.
              registrarAccion: params.registrarAccion,
              conGuardia: params.guardia !== undefined,
              historialPasos: params.historialPasos,
              percepcion,
              ...(percepcion !== undefined
                ? {
                    registrarEstrategias: (porAccion: EstrategiaLocalizacion[][]): void => {
                      estrategiasPorAccion.push(...porAccion);
                    },
                  }
                : {}),
              ...(params.reportarConsumo !== undefined
                ? { registrarConsumo: (paso) => consumo.registrarPaso(paso) }
                : {}),
            }),
          );
        } catch (error) {
          throw convertirDesenlaceTerminal() ?? error;
        } finally {
          params.signal?.removeEventListener('abort', alAbortarExterno);
        }
      })();
      const terminal = convertirDesenlaceTerminal();
      if (terminal !== null) {
        throw terminal;
      }
      // CAMBIO DE SITIO AUTORIZADO: el bucle no fallo, TERMINO este tramo. Va despues de los tres
      // desenlaces anteriores porque todos ellos cierran la tarea entera y este solo cierra el tramo.
      const cambio = cambiador?.solicitado() ?? null;
      if (cambio !== null) {
        const pasoDelCambio = cambiador?.paso() ?? null;
        // El paso del cambio se agrega a mano: la tool lanzo, asi que Stagehand no la empujo a su
        // traza y la trayectoria del tramo quedaria sin el paso que explica por que termino.
        const acciones = [
          ...(resultado.actions ?? []),
          ...(pasoDelCambio !== null ? [pasoDelCambio] : []),
        ];
        return {
          // Ni exito ni DONE: el tramo se corto a proposito. Quien decide que pasa despues es el
          // handler, que ve `cambioDeSitio` antes que cualquier otra cosa.
          exito: false,
          completado: false,
          mensaje: cambio.resumen,
          acciones,
          // Nadie percibio el paso del cambio: su ranura va vacia para que la lista siga teniendo
          // una entrada por accion de la traza.
          estrategiasPorAccion: ranurasPorAccion(estrategiasPorAccion, acciones.length),
          tokensIn: resultado.usage?.input_tokens ?? null,
          tokensOut: resultado.usage?.output_tokens ?? null,
          cambioDeSitio: cambio,
        };
      }
      // AgentResult (v3, types/public/agent.d.ts:64-89) ya trae la TRAZA estructurada: `actions`
      // (una por tool ejecutada, con playwrightArguments.selector en 'act'/'fillForm') y `usage`
      // (tokens). Se devuelven CRUDAS: la censura y la persistencia son del handler (trayectoria.ts),
      // este adaptador no decide que se guarda.
      const acciones = resultado.actions ?? [];
      return {
        exito: resultado.success && resultado.completed,
        completado: resultado.completed,
        mensaje: resultado.message,
        acciones,
        // La traza puede cerrar con la accion `done` que sintetiza Stagehand sin emitir evidencia:
        // su ranura va vacia para que las cantidades cuadren (ver ranurasPorAccion).
        estrategiasPorAccion: ranurasPorAccion(estrategiasPorAccion, acciones.length),
        tokensIn: resultado.usage?.input_tokens ?? null,
        tokensOut: resultado.usage?.output_tokens ?? null,
        cambioDeSitio: null,
      };
    } finally {
      params.reportarConsumo?.(consumo.total());
      // Cierre del CLIENTE Stagehand (no de la sesion: keepAlive la mantiene viva para que el
      // handler extraiga el contexto; la sesion la cierra el handler en su finally).
      await stagehand.close().catch(() => {});
    }
  }

  /**
   * ESCALADA DE UN PASO (D5): ejecuta UNA accion puntual sobre UN elemento con el motor, cuando la
   * ejecucion determinista no logro localizarlo. Es `act(instruccion)`, NO un agente: Stagehand
   * observa la pagina, resuelve UN elemento y aplica UN metodo sobre el. No hay bucle, no hay tools
   * de navegacion y no hay forma de que encadene otra accion; el alcance del modelo en este camino
   * es elegir a que elemento se parece la descripcion.
   *
   * Devuelve el SELECTOR que resolvio: es el insumo con el que el ejecutor relee del DOM las
   * estrategias actuales y repara la receta.
   */
  async ejecutarPasoConModelo(params: {
    sesionExternaId: string;
    instruccion: string;
    apiKey: string;
    signal?: AbortSignal | undefined;
  }): Promise<ResultadoEscalada> {
    if (params.signal?.aborted === true) {
      return { ok: false, selector: null, tokensIn: null, tokensOut: null };
    }
    const stagehand = new Stagehand(
      construirOpcionesStagehand({
        apiKey: this.config.apiKey,
        projectId: this.config.projectId,
        sesionExternaId: params.sesionExternaId,
        model: this.config.model,
        modelApiKey: params.apiKey,
        // Mismo middleware que la corrida del agente (FIX B y C): la escalada tambien pasa por el
        // esquema de act y sus llamadas tampoco llevaban cache de prompt.
        logger: this.config.logger,
      }),
    );
    await stagehand.init();
    // Segunda red, igual que en la corrida del agente: rescate post-rechazo de instancia.
    instalarNormalizadorDeElementId(stagehand, this.config.logger);
    try {
      // Misma envoltura que la del agente (CAMBIO 2): un rechazo de esquema es intermitente y aca
      // tambien se reintenta. El corte por fallos consecutivos no aplica: es UNA sola llamada.
      const blindado = crearActBlindado({
        actuar: (accion) => stagehand.act(accion, { timeout: this.config.toolTimeoutMs }),
        logger: this.config.logger,
      });
      const resultado = await blindado.ejecutar(params.instruccion);
      return {
        ok: resultado.success,
        selector: selectorDeAction(resultado.playwrightArguments),
        // act() no reporta usage; los tokens de una escalada se contabilizan como no reportados y la
        // comparacion de ahorro usa el numero de escaladas, que si es exacto.
        tokensIn: null,
        tokensOut: null,
      };
    } finally {
      await stagehand.close().catch(() => {});
    }
  }
}
