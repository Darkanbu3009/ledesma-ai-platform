import { Stagehand, tool } from '@browserbasehq/stagehand';
import type { AgentExecuteOptions, V3Options } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { AccionBloqueadaError, FalloDeEsquemaDelMotorError } from './errores.js';
import type { Logger } from './logger.js';
import type { EscaladorDePaso, ResultadoEscalada } from './ejecutor-receta.js';
import type { AccionCrudaDeMotor } from './trayectoria.js';
import type { GuardiaDeAccion, MotorDeTareaWeb, PasoObservado, ResultadoMotor } from './tarea-web.js';

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
}): V3Options {
  return {
    env: 'BROWSERBASE',
    apiKey: params.apiKey,
    projectId: params.projectId,
    browserbaseSessionID: params.sesionExternaId,
    keepAlive: true,
    model: { modelName: params.model, apiKey: params.modelApiKey },
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
}): ActBlindado {
  const esperar = params.esperar ?? esperarMs;
  let fallosConsecutivos = 0;
  let corte: FalloDeEsquemaDelMotorError | null = null;
  let bloqueo: string | null = null;
  /** Ultimo elementId que el motor rechazo; se compara con el del intento siguiente. */
  let elementIdRechazado: string | null = null;

  // La accion entra a la traza al EMPEZAR y este registro se completa al terminar: lo que quede en
  // vuelo cuando la corrida se cancele ya esta registrado (como no exitoso, que es lo veraz).
  const registrarInicio = (accion: string): AccionCrudaDeMotor => {
    const registro: AccionCrudaDeMotor = { type: 'act', action: accion, success: false };
    params.registrarAccion?.(registro);
    return registro;
  };

  return {
    corto: () => corte !== null,
    corte: () => corte,
    bloqueo: () => bloqueo,
    ejecutar: async (accion: string): Promise<SalidaDeActBlindado> => {
      // La accion NO se registra en la traza: no llego al navegador. La constancia de por que se
      // bloqueo es el paso de verificacion que deja la propia guardia.
      const veredicto = await params.guardia?.revisar(accion);
      if (veredicto?.tipo === 'bloquear') {
        bloqueo = veredicto.mensaje;
        throw new AccionBloqueadaError(veredicto.mensaje);
      }
      const registro = registrarInicio(accion);
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

/**
 * TOOLS QUE SE RETIRAN cuando la corrida lleva GUARDIA (revision adversarial). La guardia solo puede
 * interponerse en `act`, que es la unica tool que este worker reemplaza; el resto del toolset nativo
 * de Stagehand va directo al navegador. Dos de esas tools alcanzan la MISMA accion irreversible sin
 * pasar por la comparacion:
 *  - `keys`: manda pulsaciones a donde este el foco. Un "Control+Enter" envia el correo que la
 *    guardia acaba de detener.
 *  - `fillForm`: observa y actua sobre cada campo que le describan; su descripcion es texto libre,
 *    asi que puede resolver un boton igual que un input.
 * Retirarlas deja a `act` como unica via de interaccion en las tareas que piden una accion bloqueada.
 * En el resto de las tareas (y en la reanudacion tras una decision humana) el toolset queda intacto:
 * no hay accion que verificar y no tiene sentido pagar el costo en capacidad.
 */
export const TOOLS_RETIRADAS_CON_GUARDIA: readonly string[] = ['keys', 'fillForm'];

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
}): AgentExecuteOptions {
  const observador = params.observador;
  const registrarAccion = params.registrarAccion;
  return {
    instruction: params.objetivo,
    maxSteps: params.maxPasos,
    toolTimeout: params.toolTimeoutMs,
    ...(params.signal !== undefined ? { signal: params.signal } : {}),
    ...(params.conGuardia === true ? { excludeTools: [...TOOLS_RETIRADAS_CON_GUARDIA] } : {}),
    ...(observador !== undefined || registrarAccion !== undefined
      ? {
          callbacks: {
            // Best-effort SIEMPRE: la observacion enriquece la traza; si falla, la tarea sigue
            // igual y esa corrida simplemente no se podra promover a receta.
            onEvidence: async (evento): Promise<void> => {
              if (evento.type !== 'step_finished') return;
              if (registrarAccion !== undefined && evento.actionName !== 'act') {
                registrarAccion(accionCrudaDeEvidencia(evento));
              }
              if (observador === undefined) return;
              try {
                for (const paso of pasosObservadosDeEvidencia(evento)) await observador(paso);
              } catch {
                // una observacion fallida jamas cambia el desenlace de la tarea
              }
            },
          },
        }
      : {}),
  };
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
  }): Promise<ResultadoMotor> {
    const stagehand = new Stagehand(
      construirOpcionesStagehand({
        apiKey: this.config.apiKey,
        projectId: this.config.projectId,
        sesionExternaId: params.sesionExternaId,
        model: params.model,
        modelApiKey: params.apiKey,
      }),
    );
    await stagehand.init();
    try {
      // La tool `act` del agente va BLINDADA (CAMBIO 2 y 3): misma forma que la nativa, con
      // reintento ante rechazo de esquema y corte por fallos consecutivos. Se pasa por `tools`, que
      // el handler de Stagehand fusiona DESPUES del toolset nativo y por tanto reemplaza a `act`.
      const blindado = crearActBlindado({
        actuar: (accion) => stagehand.act(accion, { timeout: this.config.toolTimeoutMs }),
        logger: this.config.logger,
        registrarAccion: params.registrarAccion,
        guardia: params.guardia,
      });
      const agente = stagehand.agent({
        systemPrompt: params.systemPrompt,
        tools: herramientaActBlindada(blindado),
      });
      const resultado = await agente.execute(
        construirOpcionesDeEjecucion({
          objetivo: params.objetivo,
          maxPasos: params.maxPasos,
          toolTimeoutMs: this.config.toolTimeoutMs,
          signal: params.signal,
          observador: params.observador,
          // Las tools que no son `act` se registran por evidencia; `act` ya la registra el blindaje.
          registrarAccion: params.registrarAccion,
          conGuardia: params.guardia !== undefined,
        }),
      );
      // Ni el bloqueo de la guardia ni el corte por fallos de esquema pueden viajar como excepcion
      // desde la tool: el handler de Stagehand atrapa cualquier error del bucle y lo devuelve como
      // resultado fallido. El bucle YA se corto (lanzar desde la tool lo detiene); aca se convierten
      // en el error especifico de cada caso.
      //
      // El BLOQUEO va primero: es un desenlace decidido por el sistema, no un fallo del motor, y su
      // mensaje (la detencion ya serializada) es el que tiene que llegar al usuario.
      const bloqueo = blindado.bloqueo();
      if (bloqueo !== null) {
        throw new AccionBloqueadaError(bloqueo);
      }
      // El error EXACTO del corte (racha de fallos o repeticion determinista del mismo elementId):
      // reconstruirlo aca perderia el identificador que hace veraz el diagnostico.
      const corte = blindado.corte();
      if (corte !== null) {
        throw corte;
      }
      // AgentResult (v3, types/public/agent.d.ts:64-89) ya trae la TRAZA estructurada: `actions`
      // (una por tool ejecutada, con playwrightArguments.selector en 'act'/'fillForm') y `usage`
      // (tokens). Se devuelven CRUDAS: la censura y la persistencia son del handler (trayectoria.ts),
      // este adaptador no decide que se guarda.
      return {
        exito: resultado.success && resultado.completed,
        completado: resultado.completed,
        mensaje: resultado.message,
        acciones: resultado.actions ?? [],
        tokensIn: resultado.usage?.input_tokens ?? null,
        tokensOut: resultado.usage?.output_tokens ?? null,
      };
    } finally {
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
      }),
    );
    await stagehand.init();
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
