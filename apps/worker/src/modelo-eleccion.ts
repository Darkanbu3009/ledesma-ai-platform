import { runModel } from '@ledesma-platform/backend/execution';
import type { ElectorDeTareaEnsenada } from './eleccion-tarea.js';
import type { Logger } from './logger.js';

/**
 * LA UNICA LLAMADA AL MODELO de la eleccion de tarea ensenada (CAMBIO 3): una consulta puntual, sin
 * herramientas, sin historial y sin bucle, que devuelve el texto crudo de la respuesta.
 *
 * ES EL UNICO MODULO del worker que habla con un modelo fuera del motor de navegacion, y por eso vive
 * separado del handler: `tarea-web.ts` recibe el PUERTO (`ElectorDeTareaEnsenada`) y no puede llamar
 * a nadie por su cuenta; `eleccion-tarea.ts` es puro y valida la respuesta sin red. Un test de esta
 * ruta jamas llama a un proveedor.
 *
 * REUSA LA MISMA PUERTA que el resto de la plataforma (`runModel`, BYOK por llamada): la key es la del
 * OWNER, sale de la boveda igual que para el motor, y no se guarda ni se loguea en ningun punto.
 *
 * ACOTADA A PROPOSITO: tope de tokens de salida bajo (la respuesta es un JSON de dos campos), sin
 * herramientas que pueda invocar, con temperatura 0 y con un deadline propio. Si tarda, falla o
 * devuelve basura, el llamador se queda sin eleccion y la tarea corre con el motor como siempre.
 */

/** Tope de tokens de salida: la respuesta es {"tarea": "...", "datos": {...}} y nada mas. */
const MAX_TOKENS_DE_ELECCION = 400;

/** Deadline de pared de la consulta. Mas alla de esto no vale la pena esperar: se usa el motor. */
export const TIMEOUT_ELECCION_MS = 20_000;

/**
 * El identificador del modelo SIN el prefijo de proveedor. TAREA_WEB_MODEL viaja en formato
 * `proveedor/modelo` porque es lo que espera el motor de navegacion; la puerta de modelo de la
 * plataforma recibe el proveedor por separado y el id del modelo tal como lo publica el proveedor.
 */
export function modeloSinProveedor(model: string): string {
  const barra = model.indexOf('/');
  return barra === -1 ? model : model.slice(barra + 1);
}

function describir(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'error desconocido';
}

export function crearElectorDeTareaEnsenada(opciones: {
  /** TAREA_WEB_MODEL, en formato proveedor/modelo (el mismo que usa el motor). */
  model: string;
  /** Deadline de pared de la consulta. OPCIONAL: los tests lo bajan. */
  timeoutMs?: number | undefined;
  logger: Logger;
}): ElectorDeTareaEnsenada {
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_ELECCION_MS;
  return {
    async consultar({ peticion, apiKey, signal }): Promise<string> {
      const corte = new AbortController();
      const reloj = setTimeout(() => corte.abort(), timeoutMs);
      const propagar = (): void => corte.abort();
      signal?.addEventListener('abort', propagar, { once: true });
      if (signal?.aborted === true) corte.abort();
      let texto = '';
      try {
        const eventos = runModel({
          providerId: 'anthropic',
          request: {
            system: peticion.system,
            messages: [{ role: 'user', content: [{ type: 'text', text: peticion.usuario }] }],
            modelConfig: {
              model: modeloSinProveedor(opciones.model),
              maxTokens: MAX_TOKENS_DE_ELECCION,
              temperature: 0,
            },
          },
          credentials: { apiKey },
          signal: corte.signal,
        });
        for await (const evento of eventos) {
          if (evento.type === 'text_delta') texto += evento.text;
          if (evento.type === 'stop') {
            // EL COSTO de la consulta puntual (D5/D6): la unica llamada al modelo fuera del motor se
            // loguea con sus tokens, para que "cuanto costo interpretar" se responda desde el log.
            // Nunca el contenido: la peticion lleva el texto del usuario.
            opciones.logger.info('tarea web: consulta puntual al modelo completada', {
              tokensIn: evento.usage?.inputTokens ?? null,
              tokensOut: evento.usage?.outputTokens ?? null,
            });
            break;
          }
        }
      } catch (error) {
        // Sin respuesta no hay eleccion: el llamador cae al motor. Se loguea el tipo de error, nunca
        // el contenido de la peticion (lleva el texto del usuario).
        opciones.logger.warn('tarea web: no se pudo consultar cual de las tareas ensenadas corresponde', {
          err: describir(error),
        });
        return '';
      } finally {
        clearTimeout(reloj);
        signal?.removeEventListener('abort', propagar);
      }
      return texto;
    },
  };
}
