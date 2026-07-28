import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  crearMiddlewareDeModelo,
  framesPorId,
  instalarNormalizadorDeElementId,
  normalizarIdsPelones,
  normalizarIdsPelonesEnTexto,
  rescatarSalidaConIdPelon,
  resolverFrameDeId,
  textoDeFalloDeEsquema,
} from '../src/normalizador-elementid.js';
import type { Logger } from '../src/logger.js';

/**
 * NORMALIZADOR DEFENSIVO DE elementId SIN PREFIJO (FIX C). El parche de patches/ evita que el arbol
 * OFREZCA ids sin prefijo; esto cubre el otro camino: el modelo que QUITA el prefijo por su cuenta
 * ("6377" en vez de "0-6377"). El frame se RESUELVE buscando el id pelon entre los ids rotulados
 * [frame-id] del arbol enviado: presente en exactamente UN frame se normaliza y se re-valida con el
 * MISMO esquema; presente en varios o en ninguno (ambiguedad real), el error original se propaga tal
 * cual. El caso Gmail (multiples iframes siempre, id valido del frame principal) queda cubierto.
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

/** Mensajes con DOS frames (Gmail con iframes) donde el id 6377 SI existe, solo en el frame 0. */
const mensajesDosFramesConElId = [
  {
    role: 'user',
    content: 'Tree:\n[0-1] RootWebArea\n  [0-6377] button: Redactar\n  [1-40] button: Enviar',
  },
];

/** Mensajes con DOS frames donde el id 6377 NO aparece en ninguno. */
const mensajesDosFramesSinElId = [
  { role: 'user', content: 'Tree:\n[0-1] RootWebArea\n  [1-40] button: Enviar\n  [0-9] link' },
];

/** Mensajes donde el id 6377 aparece en DOS frames a la vez (ambiguedad real). */
const mensajesIdAmbiguo = [
  { role: 'user', content: 'Tree:\n[0-6377] button: A\n  [1-6377] button: B' },
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

describe('framesPorId y resolverFrameDeId', () => {
  it('mapea cada id rotulado a los frames donde aparece', () => {
    const frames = framesPorId(mensajesDosFramesConElId);
    expect(resolverFrameDeId('6377', frames)).toBe('0');
    expect(resolverFrameDeId('40', frames)).toBe('1');
  });
  it('un id ausente o presente en varios frames no se resuelve', () => {
    expect(resolverFrameDeId('6377', framesPorId(mensajesDosFramesSinElId))).toBeNull();
    expect(resolverFrameDeId('6377', framesPorId(mensajesIdAmbiguo))).toBeNull();
    expect(resolverFrameDeId('6377', framesPorId([{ role: 'user', content: 'sin arbol' }]))).toBeNull();
  });
});

describe('normalizarIdsPelones', () => {
  it('normaliza SOLO los elementId de puros digitos, al frame resuelto de cada uno', () => {
    const frames = framesPorId([
      { role: 'user', content: 'Tree:\n[0-6377] a\n[1-88] b\n[0-5] c' },
    ]);
    const { valor, normalizados, sinResolver } = normalizarIdsPelones(
      {
        action: { elementId: '6377' },
        elements: [{ elementId: '0-5' }, { elementId: '88' }],
      },
      frames,
    );
    expect(normalizados).toEqual(['6377 -> 0-6377', '88 -> 1-88']);
    expect(sinResolver).toEqual([]);
    expect(valor).toEqual({
      action: { elementId: '0-6377' },
      elements: [{ elementId: '0-5' }, { elementId: '1-88' }],
    });
  });

  it('un id que no aparece en exactamente un frame queda tal cual y se reporta sin resolver', () => {
    const { valor, normalizados, sinResolver } = normalizarIdsPelones(
      { action: { elementId: '6377' } },
      framesPorId(mensajesIdAmbiguo),
    );
    expect(normalizados).toEqual([]);
    expect(sinResolver).toEqual(['6377']);
    expect(valor).toEqual({ action: { elementId: '6377' } });
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

  it('el caso Gmail: VARIOS frames pero el id existe solo en el frame principal, se normaliza', () => {
    const rescatado = rescatarSalidaConIdPelon({
      error: errorDeEsquema(salidaConIdPelon),
      mensajes: mensajesDosFramesConElId,
      esquema: esquemaAct,
      logger,
    });
    expect(rescatado).not.toBeNull();
    const data = rescatado?.data as typeof salidaConIdPelon;
    expect(data.action.elementId).toBe('0-6377');
  });

  it('un id ausente del arbol, o presente en varios frames, NO se normaliza (ambiguedad real)', () => {
    for (const mensajes of [mensajesDosFramesSinElId, mensajesIdAmbiguo]) {
      expect(
        rescatarSalidaConIdPelon({
          error: errorDeEsquema(salidaConIdPelon),
          mensajes,
          esquema: esquemaAct,
          logger,
        }),
      ).toBeNull();
    }
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

describe('crearMiddlewareDeModelo (FIX B: normalizacion ANTES de validar, en todos los clientes)', () => {
  const middleware = crearMiddlewareDeModelo(logger);

  /** Prompt del AI SDK con el arbol de UN solo frame (la forma que ve el middleware). */
  const promptUnFrame = [
    { role: 'system', content: 'instrucciones del sistema' },
    {
      role: 'user',
      content: [{ type: 'text', text: 'Tree:\n[0-1] RootWebArea\n  [0-5627] textarea: Cuerpo' }],
    },
  ];

  it('el caso del log de produccion: elementId 5627 en un tool-call se normaliza a 0-5627 y valida', async () => {
    // La salida estructurada de Anthropic viaja como tool-call con el JSON en `input`.
    const salida = {
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'json',
          input: JSON.stringify({
            action: { elementId: '5627', description: 'cuerpo del mensaje', method: 'click', arguments: [] },
            twoStep: false,
          }),
        },
      ],
      finishReason: 'stop',
    };
    const resultado = await middleware.wrapGenerate({
      doGenerate: async () => salida,
      params: { prompt: promptUnFrame },
    });
    const parte = (resultado.content as Array<{ input: string }>)[0];
    const parseado = esquemaAct.parse(JSON.parse(parte?.input ?? ''));
    expect(parseado.action?.elementId).toBe('0-5627');
  });

  it('el caso Gmail: varios frames y el id existe solo en uno, se normaliza a ese frame', async () => {
    const salida = {
      content: [{ type: 'text', text: '{"action":{"elementId":"5604"},"twoStep":false}' }],
    };
    const resultado = await middleware.wrapGenerate({
      doGenerate: async () => salida,
      params: {
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Tree:\n[0-5604] a\n[1-40] b' }] },
        ],
      },
    });
    const parte = (resultado.content as Array<{ text: string }>)[0];
    expect(parte?.text).toContain('"elementId":"0-5604"');
  });

  it('un id ausente del arbol (o rotulado en varios frames) no toca la salida', async () => {
    const salida = {
      content: [{ type: 'text', text: '{"action":{"elementId":"5627"},"twoStep":false}' }],
    };
    const resultado = await middleware.wrapGenerate({
      doGenerate: async () => salida,
      params: {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Tree:\n[0-1] a\n[1-40] b' }] }],
      },
    });
    expect(resultado).toBe(salida);
  });

  it('una salida sin ids pelones viaja intacta (misma referencia, cero costo)', async () => {
    const salida = { content: [{ type: 'text', text: '{"action":{"elementId":"0-9"},"twoStep":true}' }] };
    const resultado = await middleware.wrapGenerate({
      doGenerate: async () => salida,
      params: { prompt: promptUnFrame },
    });
    expect(resultado).toBe(salida);
  });

  it('FIX C: una llamada de inferencia sin marcas de cache gana la marca en su mensaje de sistema', async () => {
    const params = await middleware.transformParams({
      type: 'generate',
      params: { prompt: promptUnFrame, temperature: 0 },
    });
    const prompt = params.prompt as Array<{ role: string; providerOptions?: Record<string, unknown> }>;
    expect(prompt[0]?.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
    expect(prompt[1]?.providerOptions).toBeUndefined();
    expect(params['temperature']).toBe(0);
  });

  it('FIX C: las llamadas del bucle del agente (ya marcadas por prepareStep) no se tocan', async () => {
    const marcado = [
      { role: 'system', content: 'sistema' },
      {
        role: 'user',
        content: 'objetivo',
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      },
    ];
    const params = { prompt: marcado };
    expect(await middleware.transformParams({ type: 'generate', params })).toBe(params);
  });

  it('FIX C: sin mensaje de sistema no hay prefijo estable que marcar', async () => {
    const params = { prompt: [{ role: 'user', content: 'hola' }] };
    expect(await middleware.transformParams({ type: 'generate', params })).toBe(params);
  });
});

describe('normalizarIdsPelonesEnTexto', () => {
  it('normaliza los elementId pelones resolubles del texto y deja el resto intacto', () => {
    const frames = framesPorId([{ role: 'user', content: '[0-5627] a [1-88] b [0-4] c' }]);
    const { texto, normalizados, sinResolver } = normalizarIdsPelonesEnTexto(
      '{"action":{"elementId":"5627"},"otros":[{"elementId":"0-4"},{"elementId": "88"},{"elementId":"999"}]}',
      frames,
    );
    expect(normalizados).toEqual(['5627 -> 0-5627', '88 -> 1-88']);
    expect(sinResolver).toEqual(['999']);
    expect(texto).toContain('"elementId":"0-5627"');
    expect(texto).toContain('"elementId": "1-88"');
    expect(texto).toContain('"elementId":"0-4"');
    expect(texto).toContain('"elementId":"999"');
  });
});
