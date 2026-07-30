import { describe, it, expect, vi } from 'vitest';
import type { EstrategiaLocalizacion, PasoDeReceta } from '@ledesma-platform/shared';
import {
  ejecutarReceta,
  type BarreraDeIdentidadParaEjecucion,
  type EjecucionPorRecetaDeps,
  type InstruccionDePaso,
  type NavegadorDeterminista,
  type ResultadoDeEjecucionPorReceta,
  type ResultadoPasoDeterminista,
} from '../src/ejecutor-receta.js';
import type { ValoresDeParametros } from '../src/receta-web.js';

/**
 * BARRERA DE IDENTIDAD, CABLEADO (FIX B) y NO REGRESION (FIX C). Todo con FAKES: sin navegador, sin
 * modelo y sin base.
 *
 * Lo que estos tests fijan, y es la condicion para que esto pueda tocar produccion:
 *  - en MODO OBSERVACION el desenlace de una receta es IDENTICO al de hoy, incluido el caso en el que
 *    la barrera HABRIA bloqueado;
 *  - un fallo de la propia barrera no altera nada (queda como IDENTIDAD:NO_EVALUABLE);
 *  - el veredicto queda en la trayectoria con su etiqueta propia, visible en /actividad;
 *  - el nombre accesible se lee UNA sola vez por corrida (solo en el paso irreversible).
 */

const ROL_ENVIAR: EstrategiaLocalizacion = { tipo: 'rol', rol: 'button', nombre: 'Enviar' };
const ROL_PARA: EstrategiaLocalizacion = { tipo: 'rol', rol: 'textbox', nombre: 'Para' };
const XPATH: EstrategiaLocalizacion = { tipo: 'xpath', xpath: '/html[1]/body[1]/button[1]' };
/** Las clases que claseDeElemento produce para los dos pasos con elemento de la receta de abajo. */
const CLASE_ENVIAR = 'click|rol:button|enviar';
const CLASE_PARA = 'escribir|rol:textbox|para';

const SIN_PARAMETROS: ValoresDeParametros = {};

function pasoReceta(overrides: Partial<PasoDeReceta> = {}): PasoDeReceta {
  return {
    idx: 0,
    accion: 'click',
    estrategias: [ROL_ENVIAR, XPATH],
    valor: null,
    teclas: null,
    ruta: null,
    esperaMs: null,
    ...overrides,
  };
}

/** La receta del caso real: abrir, escribir, VERIFICAR y el click que consuma la accion. */
function recetaConVerificacion(): PasoDeReceta[] {
  return [
    pasoReceta({
      idx: 0,
      accion: 'escribir',
      estrategias: [ROL_PARA, XPATH],
      valor: { tipo: 'parametro', parametro: 'destinatario' },
    }),
    pasoReceta({ idx: 1, accion: 'verificar', estrategias: [] }),
    pasoReceta({ idx: 2 }),
  ];
}

/** Navegador fake que ademas cuenta las lecturas del nombre accesible (la unica conexion extra). */
function makeNavegador(ariaLabel: string | null = 'Enviar (Ctrl-Enter)') {
  const ejecutados: InstruccionDePaso[] = [];
  const localizar = vi.fn(async () =>
    ariaLabel === null ? null : { ariaLabel, rol: 'button', candidatos: 1 },
  );
  const navegador: NavegadorDeterminista = {
    ejecutarPasoDeterminista: vi.fn(
      async (_sesion: string, instruccion: InstruccionDePaso): Promise<ResultadoPasoDeterminista> => {
        ejecutados.push(instruccion);
        return { estado: 'ok', estrategias: [], detalle: null };
      },
    ),
    leerEstrategiasDeElemento: vi.fn(async () => []),
    localizarBotonPorAriaLabel: localizar,
  };
  return { navegador, ejecutados, localizar };
}

function barrera(
  overrides: Partial<BarreraDeIdentidadParaEjecucion> = {},
): BarreraDeIdentidadParaEjecucion {
  return {
    modo: 'observacion',
    verboDelObjetivo: 'enviar',
    clasesCorroboradas: () => new Set([CLASE_ENVIAR, CLASE_PARA]),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<EjecucionPorRecetaDeps> = {}): EjecucionPorRecetaDeps {
  const { navegador } = makeNavegador();
  return {
    navegador,
    escalador: { ejecutarPasoConModelo: vi.fn(async () => ({ ok: true, selector: null, tokensIn: 0, tokensOut: 0 })) },
    verificar: vi.fn(async () => ({ tipo: 'ejecutar' as const })),
    sesionExternaId: 'ses-1',
    apiKey: 'sk-owner',
    dominio: 'mail.ejemplo.com',
    ...overrides,
  };
}

/**
 * El desenlace de una corrida SIN los pasos sinteticos de la barrera: es lo que tiene que ser
 * IDENTICO en modo observacion.
 *
 * Se compara todo lo que decide el resultado de la tarea (desenlace, pasos ejecutados, escaladas,
 * ganadoras, reparaciones, tokens) y la traza de los pasos que REALMENTE corrieron, SIN su `idx`: ese
 * campo es la posicion en la trayectoria, y ya se corre solo cuando se intercala cualquier otro paso
 * (las verificaciones lo hacen hoy y la trayectoria los renumera al cerrar). Intercalar la etiqueta de
 * la barrera lo mueve por la misma razon y no cambia nada de lo que la tarea hace.
 */
function desenlaceComparable(resultado: ResultadoDeEjecucionPorReceta) {
  return {
    desenlace: resultado.desenlace,
    pasosEjecutados: resultado.pasosEjecutados,
    escalados: resultado.escalados,
    ganadoras: resultado.ganadoras,
    pasosReparados: resultado.pasosReparados,
    tokensIn: resultado.tokensIn,
    tokensOut: resultado.tokensOut,
    pasosDeReceta: resultado.pasos
      .filter((p) => p.accion.tipo.startsWith('receta:'))
      .map((paso) => ({ ...paso, idx: null })),
  };
}

/** Corre la MISMA receta con la barrera apagada y con la barrera en observacion. */
async function correrLosDosModos(
  overridesDeBarrera: Partial<BarreraDeIdentidadParaEjecucion> = {},
  ariaLabel: string | null = 'Enviar (Ctrl-Enter)',
) {
  const sin = makeNavegador(ariaLabel);
  const conBarrera = makeNavegador(ariaLabel);
  const apagada = await ejecutarReceta(
    recetaConVerificacion(),
    { destinatario: 'ana@otra.com' },
    makeDeps({ navegador: sin.navegador }),
  );
  const observacion = await ejecutarReceta(
    recetaConVerificacion(),
    { destinatario: 'ana@otra.com' },
    makeDeps({
      navegador: conBarrera.navegador,
      barreraIdentidad: barrera({ modo: 'observacion', ...overridesDeBarrera }),
    }),
  );
  return { apagada, observacion, sin, conBarrera };
}

describe('modo observacion: el desenlace es IDENTICO al de hoy (FIX C)', () => {
  it('cuando la barrera PERMITE, nada cambia', async () => {
    const { apagada, observacion, sin, conBarrera } = await correrLosDosModos();

    expect(desenlaceComparable(observacion)).toEqual(desenlaceComparable(apagada));
    expect(observacion.desenlace).toEqual({ tipo: 'completada' });
    // Las MISMAS instrucciones, en el mismo orden, con las mismas estrategias.
    expect(conBarrera.ejecutados).toEqual(sin.ejecutados);
  });

  it('cuando la barrera HABRIA BLOQUEADO, el desenlace sigue siendo identico', async () => {
    // El caso del hueco: el DOM tiene otro boton (la receta se auto reparo hacia otro elemento).
    const { apagada, observacion, sin, conBarrera } = await correrLosDosModos(
      {},
      'Eliminar definitivamente',
    );

    expect(desenlaceComparable(observacion)).toEqual(desenlaceComparable(apagada));
    expect(observacion.desenlace).toEqual({ tipo: 'completada' });
    expect(conBarrera.ejecutados).toEqual(sin.ejecutados);
    // Y sin embargo el veredicto quedo registrado, que es todo lo que hace el modo observacion.
    const etiquetas = observacion.pasos.filter((p) => p.accion.tipo.startsWith('identidad:'));
    expect(etiquetas.some((p) => p.accion.tipo === 'identidad:habria_bloqueado')).toBe(true);
    expect(etiquetas.some((p) => p.accion.argumentos.includes('clase_distinta'))).toBe(true);
  });

  it('cuando el dominio no tiene NINGUNA clase corroborada, el desenlace sigue siendo identico', async () => {
    const { apagada, observacion } = await correrLosDosModos({
      clasesCorroboradas: () => new Set<string>(),
    });

    expect(desenlaceComparable(observacion)).toEqual(desenlaceComparable(apagada));
    expect(
      observacion.pasos.filter((p) => p.accion.argumentos.includes('clase_no_corroborada')).length,
    ).toBeGreaterThan(0);
  });

  it('un fallo de la propia barrera no altera nada y queda como NO_EVALUABLE', async () => {
    const { apagada, observacion } = await correrLosDosModos({
      clasesCorroboradas: () => {
        throw new Error('la lectura de lo aprendido revento');
      },
    });

    expect(desenlaceComparable(observacion)).toEqual(desenlaceComparable(apagada));
    expect(observacion.desenlace).toEqual({ tipo: 'completada' });
    expect(observacion.pasos.some((p) => p.accion.tipo === 'identidad:no_evaluable')).toBe(true);
  });

  it('un fallo de la LECTURA del nombre accesible tampoco altera nada', async () => {
    const { navegador } = makeNavegador();
    navegador.localizarBotonPorAriaLabel = vi.fn(async () => {
      throw new Error('la sesion de navegador se cayo');
    });

    const resultado = await ejecutarReceta(
      recetaConVerificacion(),
      { destinatario: 'ana@otra.com' },
      makeDeps({ navegador, barreraIdentidad: barrera() }),
    );

    expect(resultado.desenlace).toEqual({ tipo: 'completada' });
    expect(resultado.pasos.some((p) => p.accion.tipo === 'identidad:no_evaluable')).toBe(true);
  });
});

describe('costo de la barrera: una lectura por corrida, no por paso', () => {
  it('el nombre accesible se lee SOLO en el paso irreversible', async () => {
    const { navegador, localizar } = makeNavegador();

    await ejecutarReceta(
      recetaConVerificacion(),
      { destinatario: 'ana@otra.com' },
      makeDeps({ navegador, barreraIdentidad: barrera() }),
    );

    // Los dos pasos con elemento se evaluan, pero solo el irreversible abre conexion.
    expect(localizar).toHaveBeenCalledTimes(1);
    expect(localizar).toHaveBeenCalledWith('ses-1', ['enviar']);
  });

  it('sin verbo en el objetivo no hay paso irreversible y no se lee nada del DOM', async () => {
    const { navegador, localizar } = makeNavegador();

    await ejecutarReceta(
      [pasoReceta({ idx: 0 }), pasoReceta({ idx: 1 })],
      SIN_PARAMETROS,
      makeDeps({ navegador, barreraIdentidad: barrera({ verboDelObjetivo: null }) }),
    );

    expect(localizar).not.toHaveBeenCalled();
  });

  it("con la barrera 'apagada' no se evalua ni se registra nada", async () => {
    const { navegador, localizar } = makeNavegador();

    const resultado = await ejecutarReceta(
      recetaConVerificacion(),
      { destinatario: 'ana@otra.com' },
      makeDeps({ navegador, barreraIdentidad: barrera({ modo: 'apagada' }) }),
    );

    expect(localizar).not.toHaveBeenCalled();
    expect(resultado.pasos.every((p) => p.accion.tipo.startsWith('receta:'))).toBe(true);
  });

  it('los pasos que no tocan un elemento (navegar, esperar) no se evaluan', async () => {
    const { navegador } = makeNavegador();

    const resultado = await ejecutarReceta(
      [
        pasoReceta({ idx: 0, accion: 'navegar', estrategias: [], ruta: '/inbox' }),
        pasoReceta({ idx: 1, accion: 'esperar', estrategias: [], esperaMs: 0 }),
      ],
      SIN_PARAMETROS,
      makeDeps({ navegador, barreraIdentidad: barrera() }),
    );

    expect(resultado.pasos.some((p) => p.accion.tipo.startsWith('identidad:'))).toBe(false);
  });
});

describe("modo activa: el bloqueo abandona la receta y la tarea la termina el motor", () => {
  it('un veredicto de bloqueo abandona ANTES de que el navegador actue sobre ese paso', async () => {
    const { navegador, ejecutados } = makeNavegador('Eliminar definitivamente');

    const resultado = await ejecutarReceta(
      recetaConVerificacion(),
      { destinatario: 'ana@otra.com' },
      makeDeps({ navegador, barreraIdentidad: barrera({ modo: 'activa' }) }),
    );

    expect(resultado.desenlace.tipo).toBe('abandonada');
    // La receta NO se declara obsoleta: no es que ya no describa el sitio, es que no se pudo
    // confirmar la identidad del elemento de ese paso.
    expect(resultado.desenlace).toMatchObject({ obsoleta: false });
    // La escritura si corrio; el paso irreversible NO llego al navegador.
    expect(ejecutados).toHaveLength(1);
    expect(resultado.pasos.at(-1)?.accion.tipo).toBe('identidad:bloqueada');
  });

  it('con la identidad confirmada la receta se completa igual que en observacion', async () => {
    const { navegador, ejecutados } = makeNavegador('Enviar (Ctrl-Enter)');

    const resultado = await ejecutarReceta(
      recetaConVerificacion(),
      { destinatario: 'ana@otra.com' },
      makeDeps({ navegador, barreraIdentidad: barrera({ modo: 'activa' }) }),
    );

    expect(resultado.desenlace).toEqual({ tipo: 'completada' });
    expect(ejecutados).toHaveLength(2);
  });
});
