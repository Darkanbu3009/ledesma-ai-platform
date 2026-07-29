import { describe, it, expect, vi } from 'vitest';
import type { EstrategiaLocalizacion, PasoDeReceta } from '@ledesma-platform/shared';
import {
  ejecutarReceta,
  type EjecucionPorRecetaDeps,
  type InstruccionDePaso,
  type NavegadorDeterminista,
  type ResultadoPasoDeterminista,
} from '../src/ejecutor-receta.js';
import type { ValoresDeParametros } from '../src/receta-web.js';

/**
 * INYECTOR DEL EJECUTOR DE RECETAS (ATLAS DE SITIOS, V040). Lo que estos tests fijan:
 *  - las estrategias PROPIAS del paso se prueban primero, siempre;
 *  - si fallan y el atlas tiene una pista para la clase equivalente, se prueba ANTES de escalar al
 *    modelo, y el paso queda etiquetado RECETA:ATLAS en la trayectoria;
 *  - si el atlas tampoco resuelve, la corrida escala exactamente como antes de V040;
 *  - sin atlas cableado, el comportamiento es identico al de siempre.
 *
 * Todo con FAKES: sin navegador, sin modelo y sin base.
 */

const PROPIA: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'id', valor: ':u3' };
const DEL_ATLAS: EstrategiaLocalizacion = { tipo: 'rol', rol: 'button', nombre: 'Enviar' };
const FRESCAS: EstrategiaLocalizacion[] = [
  { tipo: 'atributo', atributo: 'data-testid', valor: 'send' },
];

/** El paso lleva su clase por el rol; el atlas conoce esa clase y ofrece OTRO localizador. */
function pasoReceta(overrides: Partial<PasoDeReceta> = {}): PasoDeReceta {
  return {
    idx: 0,
    accion: 'click',
    dominio: null,
    estrategias: [PROPIA, DEL_ATLAS],
    valor: null,
    teclas: null,
    ruta: null,
    esperaMs: null,
    ...overrides,
  };
}

const PISTA: EstrategiaLocalizacion = {
  tipo: 'atributo',
  atributo: 'aria-label',
  valor: 'Enviar mensaje',
};

/**
 * Navegador fake: no localiza NADA salvo cuando la instruccion trae exactamente las estrategias que
 * `resuelveCon` declara. Es lo que permite distinguir "resolvio con lo suyo" de "resolvio con la
 * pista del atlas" sin mirar contadores.
 */
function makeNavegador(resuelveCon: EstrategiaLocalizacion[] | null) {
  const ejecutados: InstruccionDePaso[] = [];
  const navegador: NavegadorDeterminista = {
    ejecutarPasoDeterminista: vi.fn(
      async (_sesion: string, instruccion: InstruccionDePaso): Promise<ResultadoPasoDeterminista> => {
        ejecutados.push(instruccion);
        const coincide =
          resuelveCon !== null &&
          JSON.stringify(instruccion.estrategias) === JSON.stringify(resuelveCon);
        return coincide
          ? { estado: 'ok', estrategias: FRESCAS, detalle: null }
          : { estado: 'no_localizado', estrategias: [], detalle: 'sin elemento' };
      },
    ),
    leerEstrategiasDeElemento: vi.fn(async () => FRESCAS),
  };
  return { navegador, ejecutados };
}

function makeEscalador() {
  return {
    ejecutarPasoConModelo: vi.fn(async () => ({
      ok: true,
      selector: '/html[1]/body[1]/button[1]',
      tokensIn: 900,
      tokensOut: 40,
    })),
  };
}

function makeDeps(overrides: Partial<EjecucionPorRecetaDeps> = {}): EjecucionPorRecetaDeps {
  const { navegador } = makeNavegador(null);
  return {
    navegador,
    escalador: makeEscalador(),
    verificar: vi.fn(async () => ({ tipo: 'ejecutar' as const })),
    sesionExternaId: 'ses-1',
    apiKey: 'sk-owner',
    dominio: 'mail.ejemplo.com',
    ...overrides,
  };
}

const SIN_PARAMETROS: ValoresDeParametros = {};

describe('ejecutor de recetas con atlas de sitios', () => {
  it('estrategias propias FALLAN, el atlas resuelve, el paso queda etiquetado RECETA:ATLAS', async () => {
    const { navegador, ejecutados } = makeNavegador([PISTA]);
    const escalador = makeEscalador();
    const resultado = await ejecutarReceta(
      [pasoReceta()],
      SIN_PARAMETROS,
      makeDeps({
        navegador,
        escalador,
        atlas: { pistasParaPaso: () => [PISTA] },
      }),
    );

    expect(resultado.desenlace).toEqual({ tipo: 'completada' });
    // Primero lo suyo, despues la pista: nunca al reves.
    expect(ejecutados.map((i) => i.estrategias)).toEqual([[PROPIA, DEL_ATLAS], [PISTA]]);
    // El modelo NO se toco: la pista evito la escalada entera.
    expect(escalador.ejecutarPasoConModelo).not.toHaveBeenCalled();
    expect(resultado.escalados).toBe(0);
    expect(resultado.tokensIn).toBe(0);
    expect(resultado.pasos[0]?.accion.tipo).toBe('receta:atlas');
    expect(resultado.pasos[0]?.exito).toBe(true);
  });

  it('un paso resuelto por el atlas NO registra ganadora (una entrada no se corrobora a si misma)', async () => {
    const { navegador } = makeNavegador([PISTA]);
    const resultado = await ejecutarReceta(
      [pasoReceta()],
      SIN_PARAMETROS,
      makeDeps({ navegador, atlas: { pistasParaPaso: () => [PISTA] } }),
    );
    expect(resultado.ganadoras).toEqual([]);
  });

  it('la receta APRENDE la pista: el paso queda reparado con lo que el elemento expone hoy', async () => {
    const { navegador } = makeNavegador([PISTA]);
    const resultado = await ejecutarReceta(
      [pasoReceta()],
      SIN_PARAMETROS,
      makeDeps({ navegador, atlas: { pistasParaPaso: () => [PISTA] } }),
    );
    expect(resultado.pasosReparados?.[0]?.estrategias).toEqual(FRESCAS);
  });

  it('si el atlas tampoco resuelve, la corrida escala al modelo como antes de V040', async () => {
    const { navegador, ejecutados } = makeNavegador(null);
    const escalador = makeEscalador();
    const resultado = await ejecutarReceta(
      [pasoReceta()],
      SIN_PARAMETROS,
      makeDeps({ navegador, escalador, atlas: { pistasParaPaso: () => [PISTA] } }),
    );
    expect(ejecutados).toHaveLength(2);
    expect(escalador.ejecutarPasoConModelo).toHaveBeenCalledTimes(1);
    expect(resultado.escalados).toBe(1);
    expect(resultado.pasos[0]?.accion.tipo).toBe('receta:escalado');
  });

  it('sin pistas para ese elemento no se paga una evaluacion de mas en la pagina', async () => {
    const { navegador, ejecutados } = makeNavegador(null);
    await ejecutarReceta(
      [pasoReceta()],
      SIN_PARAMETROS,
      makeDeps({ navegador, atlas: { pistasParaPaso: () => [] } }),
    );
    expect(ejecutados).toHaveLength(1);
  });

  it('sin atlas cableado el ejecutor se comporta exactamente igual que antes', async () => {
    const { navegador, ejecutados } = makeNavegador(null);
    const escalador = makeEscalador();
    const resultado = await ejecutarReceta([pasoReceta()], SIN_PARAMETROS, makeDeps({ navegador, escalador }));
    expect(ejecutados).toHaveLength(1);
    expect(escalador.ejecutarPasoConModelo).toHaveBeenCalledTimes(1);
    expect(resultado.pasos[0]?.accion.tipo).toBe('receta:escalado');
  });

  it('el atlas NO se consulta cuando el paso ENCONTRO su elemento y fallo al actuar sobre el', async () => {
    const navegador: NavegadorDeterminista = {
      ejecutarPasoDeterminista: vi.fn(async () => ({
        estado: 'fallo' as const,
        estrategias: [],
        detalle: 'el click reboto',
      })),
      leerEstrategiasDeElemento: vi.fn(async () => FRESCAS),
    };
    const pistas = vi.fn(() => [PISTA]);
    await ejecutarReceta(
      [pasoReceta()],
      SIN_PARAMETROS,
      makeDeps({ navegador, atlas: { pistasParaPaso: pistas } }),
    );
    expect(pistas).not.toHaveBeenCalled();
  });

  it('la VERIFICACION determinista sigue resolviendo por su cuenta, ignorante del atlas', async () => {
    const { navegador } = makeNavegador([PISTA]);
    const verificar = vi.fn(async () => ({ tipo: 'detener' as const, mensaje: 'no coincide' }));
    const resultado = await ejecutarReceta(
      [
        pasoReceta(),
        { ...pasoReceta({ idx: 1 }), accion: 'verificar' as const, estrategias: [] },
      ],
      SIN_PARAMETROS,
      makeDeps({ navegador, verificar, atlas: { pistasParaPaso: () => [PISTA] } }),
    );
    // El atlas ayudo a localizar el primer paso y aun asi la verificacion detuvo la tarea.
    expect(resultado.pasos[0]?.accion.tipo).toBe('receta:atlas');
    expect(resultado.desenlace).toEqual({ tipo: 'detenida', mensaje: 'no coincide' });
    expect(verificar).toHaveBeenCalledTimes(1);
  });
});
