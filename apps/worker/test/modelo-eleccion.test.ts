import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '../src/logger.js';

/**
 * EL ADAPTADOR de la consulta puntual al modelo (modelo-eleccion.ts): la unica llamada fuera del
 * motor de navegacion. Se mockea `runModel` entero: estos tests jamas llaman a un proveedor.
 *
 * Lo que se fija: la respuesta es el texto crudo del stream, y el COSTO de la llamada (D5/D6) queda
 * logueado con sus tokens y sin una sola letra del contenido.
 */

const runModel = vi.fn();
vi.mock('@ledesma-platform/backend/execution', () => ({
  runModel: (...args: unknown[]) => runModel(...args),
}));

const { crearElectorDeTareaEnsenada } = await import('../src/modelo-eleccion.js');

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function* streamDeRespuesta(): AsyncGenerator<unknown> {
  yield { type: 'text_delta', text: '{"intencion": "enviar", ' };
  yield { type: 'text_delta', text: '"datos": {}}' };
  yield { type: 'stop', reason: 'end_turn', usage: { inputTokens: 321, outputTokens: 17 } };
}

describe('crearElectorDeTareaEnsenada: la consulta puntual y su costo', () => {
  it('devuelve el texto crudo y loguea los tokens de la llamada, nunca el contenido', async () => {
    runModel.mockReturnValueOnce(streamDeRespuesta());
    const logger = makeLogger();
    const elector = crearElectorDeTareaEnsenada({ model: 'anthropic/claude-opus-4-5', logger });

    const respuesta = await elector.consultar({
      peticion: { system: 'reglas', usuario: 'pedido' },
      apiKey: 'sk-owner',
    });

    expect(respuesta).toBe('{"intencion": "enviar", "datos": {}}');
    const costo = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find(
      (llamada) => llamada[0] === 'tarea web: consulta puntual al modelo completada',
    );
    expect(costo?.[1]).toEqual({ tokensIn: 321, tokensOut: 17 });
    // Ni la peticion ni la respuesta viajan al log.
    expect(JSON.stringify((logger.info as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      'pedido',
    );
  });

  it('sin usage en el stop, el costo se loguea con nulls (no se inventa)', async () => {
    async function* sinUsage(): AsyncGenerator<unknown> {
      yield { type: 'text_delta', text: 'x' };
      yield { type: 'stop', reason: 'end_turn' };
    }
    runModel.mockReturnValueOnce(sinUsage());
    const logger = makeLogger();
    const elector = crearElectorDeTareaEnsenada({ model: 'anthropic/claude-opus-4-5', logger });

    await elector.consultar({ peticion: { system: 's', usuario: 'u' }, apiKey: 'sk' });

    const costo = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find(
      (llamada) => llamada[0] === 'tarea web: consulta puntual al modelo completada',
    );
    expect(costo?.[1]).toEqual({ tokensIn: null, tokensOut: null });
  });

  it('si el modelo falla, devuelve vacio y no hay linea de costo', async () => {
    runModel.mockImplementationOnce(() => {
      throw new Error('proveedor caido');
    });
    const logger = makeLogger();
    const elector = crearElectorDeTareaEnsenada({ model: 'anthropic/claude-opus-4-5', logger });

    const respuesta = await elector.consultar({ peticion: { system: 's', usuario: 'u' }, apiKey: 'sk' });

    expect(respuesta).toBe('');
    expect(
      (logger.info as ReturnType<typeof vi.fn>).mock.calls.some(
        (llamada) => llamada[0] === 'tarea web: consulta puntual al modelo completada',
      ),
    ).toBe(false);
  });
});
