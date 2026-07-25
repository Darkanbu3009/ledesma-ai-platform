import { Stagehand } from '@browserbasehq/stagehand';
import type { V3Options } from '@browserbasehq/stagehand';
import type { EscaladorDePaso, ResultadoEscalada } from './ejecutor-receta.js';
import type { MotorDeTareaWeb, PasoObservado, ResultadoMotor } from './tarea-web.js';

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
  constructor(private readonly config: { apiKey: string; projectId: string; model: string }) {}

  async ejecutar(params: {
    sesionExternaId: string;
    objetivo: string;
    systemPrompt: string;
    apiKey: string;
    model: string;
    maxPasos: number;
    signal?: AbortSignal;
    observador?: ((paso: PasoObservado) => Promise<void>) | undefined;
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
      const agente = stagehand.agent({ systemPrompt: params.systemPrompt });
      const observador = params.observador;
      const resultado = await agente.execute({
        instruction: params.objetivo,
        maxSteps: params.maxPasos,
        ...(params.signal !== undefined ? { signal: params.signal } : {}),
        ...(observador !== undefined
          ? {
              callbacks: {
                // Best-effort SIEMPRE: la observacion enriquece la traza; si falla, la tarea sigue
                // igual y esa corrida simplemente no se podra promover a receta.
                onEvidence: async (evento) => {
                  if (evento.type !== 'step_finished') return;
                  try {
                    for (const paso of pasosObservadosDeEvidencia(evento)) await observador(paso);
                  } catch {
                    // una observacion fallida jamas cambia el desenlace de la tarea
                  }
                },
              },
            }
          : {}),
      });
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
      const resultado = await stagehand.act(params.instruccion);
      const primera = resultado.actions?.[0];
      return {
        ok: resultado.success === true,
        selector: selectorDeAction(primera),
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
