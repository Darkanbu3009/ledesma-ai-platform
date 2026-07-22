import { describe, it, expect } from 'vitest';
import { Stagehand, ExperimentalNotConfiguredError } from '@browserbasehq/stagehand';
import { validateExperimentalFeatures } from '@browserbasehq/stagehand/lib/v3/agent/utils/validateExperimentalFeatures.js';
import { construirOpcionesStagehand } from '../src/stagehand.js';

/**
 * La configuracion del motor pasa un abort signal a agent.execute() (el deadline de pared de
 * runTimeoutMs). Stagehand 3.6.0 exige experimental: true para aceptar ese signal, y el modo de
 * operacion del worker exige disableAPI: true (inferencia local con la key del owner). Estos tests
 * validan la configuracion REAL del worker contra la validacion REAL de Stagehand
 * (validateExperimentalFeatures, el mismo chequeo que corre agent.execute), sin abrir un navegador.
 */
describe('construirOpcionesStagehand', () => {
  const opciones = construirOpcionesStagehand({
    apiKey: 'bb-test',
    projectId: 'proj-test',
    sesionExternaId: 'ses-1',
    model: 'anthropic/claude-sonnet-4-6',
    modelApiKey: 'sk-test',
  });

  it('lleva los dos flags que exige el abort signal: experimental y disableAPI', () => {
    expect(opciones.experimental).toBe(true);
    expect(opciones.disableAPI).toBe(true);
  });

  it('con un abort signal, la validacion real de Stagehand NO lanza ExperimentalNotConfiguredError', () => {
    const signal = new AbortController().signal;
    expect(() =>
      validateExperimentalFeatures({
        isExperimental: opciones.experimental ?? false,
        executeOptions: { signal },
      }),
    ).not.toThrow();
  });

  it('control negativo: sin experimental, la misma validacion SI lanza (el test vigila lo correcto)', () => {
    const signal = new AbortController().signal;
    expect(() =>
      validateExperimentalFeatures({
        isExperimental: false,
        executeOptions: { signal },
      }),
    ).toThrow(ExperimentalNotConfiguredError);
  });

  it('el constructor de Stagehand acepta las opciones sin lanzar', () => {
    expect(() => new Stagehand(opciones)).not.toThrow();
  });
});
