import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  hayUnSoloFrame,
  instalarNormalizadorDeElementId,
  normalizarIdsPelones,
  rescatarSalidaConIdPelon,
  textoDeFalloDeEsquema,
} from '../src/normalizador-elementid.js';
import type { Logger } from '../src/logger.js';

/**
 * NORMALIZADOR DEFENSIVO DE elementId SIN PREFIJO (FIX C). El parche de patches/ evita que el arbol
 * OFREZCA ids sin prefijo; esto cubre el otro camino: el modelo que QUITA el prefijo por su cuenta
 * ("6377" en vez de "0-6377"). Con un solo frame se normaliza y se re-valida con el MISMO esquema;
 * con varios frames o cualquier duda, el error original se propaga tal cual.
 */

const logger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

/** El esquema de act de Stagehand (lib/inference.js), reproducido en lo esencial. */
const esquemaAct = z.object({
  action: z
    .object({
      elementId: z.string().regex(/^\d+-\d+$/),
      description: z.string(),
      method: z.string(),
      arguments: z.array(z.string()),
    })
    .nullable(),
  twoStep: z.boolean(),
});

/** Mensajes con el arbol de UN solo frame (todos los ids rotulados con prefijo 0). */
const mensajesUnFrame = [
  { role: 'system', content: 'instrucciones' },
  { role: 'user', content: 'Tree:\n[0-1] RootWebArea\n  [0-6377] button: Redactar\n  [0-9] link' },
];

/** Mensajes con DOS frames (Gmail con iframes): aparece un prefijo distinto de 0. */
const mensajesDosFrames = [
  { role: 'user', content: 'Tree:\n[0-1] RootWebArea\n  [1-40] button: Enviar\n  [0-9] link' },
];

function errorDeEsquema(salida: unknown): Error {
  const error = new Error('No object generated: response did not match schema.');
  error.name = 'AI_NoObjectGeneratedError';
  (error as unknown as { text: string }).text = JSON.stringify(salida);
  (error as unknown as { usage: unknown }).usage = { inputTokens: 100, outputTokens: 20 };
  return error;
}

const salidaConIdPelon = {
  action: { elementId: '6377', description: 'boton Redactar', method: 'click', arguments: [] },
  twoStep: false,
};

describe('hayUnSoloFrame', () => {
  it('true cuando todos los ids rotulados llevan prefijo 0', () => {
    expect(hayUnSoloFrame(mensajesUnFrame)).toBe(true);
  });
  it('false con varios frames o sin ids rotulados', () => {
    expect(hayUnSoloFrame(mensajesDosFrames)).toBe(false);
    expect(hayUnSoloFrame([{ role: 'user', content: 'sin arbol' }])).toBe(false);
  });
});

describe('normalizarIdsPelones', () => {
  it('normaliza SOLO los elementId de puros digitos, en cualquier profundidad', () => {
    const { valor, normalizados } = normalizarIdsPelones({
      action: { elementId: '6377' },
      elements: [{ elementId: '0-5' }, { elementId: '88' }],
    });
    expect(normalizados).toEqual(['6377', '88']);
    expect(valor).toEqual({
      action: { elementId: '0-6377' },
      elements: [{ elementId: '0-5' }, { elementId: '0-88' }],
    });
  });
});

describe('rescatarSalidaConIdPelon', () => {
  it('el caso de produccion: elementId 6377 con un solo frame se normaliza y valida', () => {
    const rescatado = rescatarSalidaConIdPelon({
      error: errorDeEsquema(salidaConIdPelon),
      mensajes: mensajesUnFrame,
      esquema: esquemaAct,
      logger,
    });
    expect(rescatado).not.toBeNull();
    const data = rescatado?.data as typeof salidaConIdPelon;
    expect(data.action.elementId).toBe('0-6377');
    expect(rescatado?.usage['prompt_tokens']).toBe(100);
  });

  it('con VARIOS frames NO se normaliza (0-<id> seria una adivinanza)', () => {
    expect(
      rescatarSalidaConIdPelon({
        error: errorDeEsquema(salidaConIdPelon),
        mensajes: mensajesDosFrames,
        esquema: esquemaAct,
        logger,
      }),
    ).toBeNull();
  });

  it('un error que no es rechazo de esquema, o sin texto, no se toca', () => {
    expect(
      rescatarSalidaConIdPelon({
        error: new Error('timeout'),
        mensajes: mensajesUnFrame,
        esquema: esquemaAct,
        logger,
      }),
    ).toBeNull();
  });

  it('una salida sin ningun id pelon no se rescata (el fallo era otro)', () => {
    const salida = { action: null, twoStep: true };
    expect(
      rescatarSalidaConIdPelon({
        error: errorDeEsquema(salida),
        mensajes: mensajesUnFrame,
        esquema: esquemaAct,
        logger,
      }),
    ).toBeNull();
  });
});

describe('textoDeFalloDeEsquema', () => {
  it('lee text del error o de su cadena de cause', () => {
    const interno = errorDeEsquema(salidaConIdPelon);
    const envoltura = new Error('wrapped');
    (envoltura as unknown as { cause: unknown }).cause = interno;
    expect(textoDeFalloDeEsquema(envoltura)).toContain('6377');
  });
});

describe('instalarNormalizadorDeElementId', () => {
  it('envuelve createChatCompletion del cliente del motor y rescata el fallo', async () => {
    const cliente = {
      createChatCompletion: async (llamada: unknown): Promise<never> => {
        void llamada;
        throw errorDeEsquema(salidaConIdPelon);
      },
    };
    const stagehand = { llmClient: cliente };
    expect(instalarNormalizadorDeElementId(stagehand, logger)).toBe(true);
    // Instalar dos veces no envuelve dos veces.
    expect(instalarNormalizadorDeElementId(stagehand, logger)).toBe(true);
    const resultado = (await cliente.createChatCompletion.call(cliente, {
      options: {
        messages: mensajesUnFrame,
        response_model: { schema: esquemaAct, name: 'act' },
      },
    } as never)) as { data: { action: { elementId: string } } };
    expect(resultado.data.action.elementId).toBe('0-6377');
  });

  it('sin response_model el error se propaga tal cual (no es una llamada de esquema)', async () => {
    const cliente = {
      createChatCompletion: async (llamada: unknown): Promise<never> => {
        void llamada;
        throw errorDeEsquema(salidaConIdPelon);
      },
    };
    instalarNormalizadorDeElementId({ llmClient: cliente }, logger);
    await expect(
      cliente.createChatCompletion.call(cliente, { options: { messages: mensajesUnFrame } } as never),
    ).rejects.toThrow('No object generated');
  });

  it('un stagehand sin llmClient no rompe nada: simplemente no se instala', () => {
    expect(instalarNormalizadorDeElementId({}, logger)).toBe(false);
    expect(instalarNormalizadorDeElementId(null, logger)).toBe(false);
  });
});
