import type { ModelProvider, ProviderStreamInput } from '../provider/provider.js';
import type { ProviderStreamEvent } from '../provider/events.js';

/**
 * Adaptador FALSO para tests del contrato y del loop agentico (P2).
 * No llama a ninguna API: emite eventos pre-programados y registra cada llamada
 * recibida, de modo que los tests verifiquen que la entrada (incluida la credencial
 * BYOK) fluye sin alteraciones a traves del contrato.
 *
 * Cada llamada a stream() consume el siguiente guion de la lista, lo que permite
 * simular conversaciones de varios turnos (turno 1 pide tool, turno 2 responde).
 */
export class FakeProvider implements ModelProvider {
  public readonly id = 'fake';
  public readonly calls: ProviderStreamInput[] = [];

  private readonly scripts: ProviderStreamEvent[][];
  private callIndex = 0;

  constructor(scripts: ProviderStreamEvent[][]) {
    this.scripts = scripts;
  }

  async *stream(input: ProviderStreamInput): AsyncIterable<ProviderStreamEvent> {
    this.calls.push(input);
    const script = this.scripts[this.callIndex] ?? [];
    this.callIndex += 1;
    for (const event of script) {
      yield event;
    }
  }
}
