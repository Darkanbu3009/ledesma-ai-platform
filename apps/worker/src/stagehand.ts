import { Stagehand } from '@browserbasehq/stagehand';
import type { V3Options } from '@browserbasehq/stagehand';
import type { MotorDeTareaWeb } from './tarea-web.js';

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

export class MotorStagehand implements MotorDeTareaWeb {
  constructor(private readonly config: { apiKey: string; projectId: string }) {}

  async ejecutar(params: {
    sesionExternaId: string;
    objetivo: string;
    systemPrompt: string;
    apiKey: string;
    model: string;
    maxPasos: number;
    signal?: AbortSignal;
  }): Promise<{ exito: boolean; mensaje: string }> {
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
      const resultado = await agente.execute({
        instruction: params.objetivo,
        maxSteps: params.maxPasos,
        ...(params.signal !== undefined ? { signal: params.signal } : {}),
      });
      return { exito: resultado.success && resultado.completed, mensaje: resultado.message };
    } finally {
      // Cierre del CLIENTE Stagehand (no de la sesion: keepAlive la mantiene viva para que el
      // handler extraiga el contexto; la sesion la cierra el handler en su finally).
      await stagehand.close().catch(() => {});
    }
  }
}
