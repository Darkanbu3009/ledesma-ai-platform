import { describe, it, expect } from 'vitest';
import {
  MARCADORES_ABIERTOS,
  MARCADORES_NUCLEO,
  esMarcadorDeNucleo,
  marcadoresAbiertos,
  marcadoresClave,
  marcadoresDeNucleo,
  type MarcadorParametro,
} from '@ledesma-platform/shared';
import { verificarAccion, type EstadoDeLaPagina, type PoliticaVigente } from '../src/verificacion.js';
import type { ParametrosDeclarados } from '../src/parametros-objetivo.js';
import {
  MAX_CLAVES_DE_MARCADORES,
  clavesDeMarcadoresContenidos,
  identidadDeConsumo,
} from '../src/plantillas-compartidas.js';

/**
 * D4: EL CRITERIO DE PERTENENCIA AL NUCLEO, FIJADO POR UN TEST QUE LO DERIVA DEL CODIGO.
 *
 * La regla es una sola y no se asume: un marcador pertenece al NUCLEO CERRADO si y solo si existe
 * COMPARACION DETERMINISTA ESCRITA para el, o sea si `compararParametros` (dentro de `verificarAccion`,
 * apps/worker/src/verificacion.ts) sabe compararlo contra el DOM antes de la accion irreversible.
 *
 * POR QUE ESTE TEST Y NO UNA LISTA REVISADA A MANO: lo que la clave de identidad de una plantilla
 * puede llevar decide el TOPE COMBINATORIO de la busqueda por contencion (2^N sobre el numero de
 * marcadores). Un marcador agregado a la clave sin su comparacion duplica ese tope y no aporta una
 * sola comparacion determinista. Aqui el nucleo no se declara: se DERIVA de lo que la verificacion
 * comparo de verdad, y la lista de `packages/shared` tiene que coincidir exactamente con eso.
 *
 * NO TOCA la verificacion determinista: solo la corre y mira que parametros compara.
 */

const POLITICA: PoliticaVigente = {
  ejecutarAccionesIrreversibles: true,
  topeMontoSinConfirmacion: 1000,
  sitiosExcluidos: [],
};

/** Un objetivo que declara LOS SEIS datos del contrato de `ParametrosDeclarados`. */
const DECLARADOS: ParametrosDeclarados = {
  destinatarios: ['ana@ejemplo.com'],
  monto: { valor: 100, moneda: 'MXN', texto: '100 MXN' },
  producto: 'libro azul',
  cantidad: 3,
  asunto: 'hola',
  cuerpo: 'texto del cuerpo',
};

/** Una pagina donde los seis datos declarados estan escritos y coinciden. */
const PAGINA: EstadoDeLaPagina = {
  campos: [
    { contexto: 'Para', valor: 'ana@ejemplo.com' },
    { contexto: 'Monto', valor: '100' },
    { contexto: 'Cantidad', valor: '3' },
    { contexto: 'Asunto', valor: 'hola' },
    { contexto: 'Cuerpo del mensaje', valor: 'texto del cuerpo' },
  ],
  texto: 'carrito con el libro azul',
};

/**
 * EL NUCLEO DERIVADO: los parametros que la verificacion COMPARO de verdad con un objetivo que
 * declara todo lo declarable. Sale de correr el codigo, no de leer una lista.
 */
function nucleoDerivadoDeLaComparacion(): Set<string> {
  const veredicto = verificarAccion({
    politica: POLITICA,
    dominio: 'mail.ejemplo.com',
    verbo: null,
    parametros: DECLARADOS,
    pagina: PAGINA,
  });
  // Con los seis datos en la pagina y coincidiendo, la verificacion se supera: si esto dejara de ser
  // cierto, el fixture (y no el criterio) seria lo que hay que arreglar.
  expect(veredicto.tipo).toBe('ejecutar');
  return new Set(veredicto.comparaciones.map((comparacion) => comparacion.parametro));
}

describe('D4: el nucleo es lo que la verificacion determinista sabe comparar', () => {
  const comparados = nucleoDerivadoDeLaComparacion();

  it('MARCADORES_NUCLEO es EXACTAMENTE el conjunto de marcadores con comparacion escrita', () => {
    expect([...comparados].sort()).toEqual([...MARCADORES_NUCLEO].sort());
  });

  it('ningun marcador ABIERTO tiene comparacion escrita (por eso viaja fuera de la clave)', () => {
    for (const marcador of MARCADORES_ABIERTOS) {
      expect(comparados.has(marcador)).toBe(false);
      expect(esMarcadorDeNucleo(marcador)).toBe(false);
    }
    // Hoy son los tres de la interpretacion natural, que no existen en `ParametrosDeclarados`.
    expect([...MARCADORES_ABIERTOS]).toEqual(['fecha', 'lugar', 'nombre']);
  });

  it('un marcador agregado al nucleo SIN comparacion escrita rompe la regla', () => {
    // La demostracion de que el test de arriba muerde: si alguien sumara 'fecha' al nucleo, quedaria
    // en la clave un dato que nada compara contra el DOM, y la igualdad de conjuntos fallaria.
    const nucleoHipotetico = [...MARCADORES_NUCLEO, 'fecha'] as MarcadorParametro[];
    const sinComparacion = nucleoHipotetico.filter((marcador) => !comparados.has(marcador));
    expect(sinComparacion).toEqual(['fecha']);
  });

  it('la particion es total: nucleo mas abiertos es el vocabulario completo y no se solapan', () => {
    const juntos = [...MARCADORES_NUCLEO, ...MARCADORES_ABIERTOS];
    expect(new Set(juntos).size).toBe(juntos.length);
    expect([...juntos].sort()).toEqual(
      ['asunto', 'cantidad', 'cuerpo', 'destinatario', 'fecha', 'lugar', 'monto', 'nombre', 'producto'],
    );
  });
});

describe('D5: el tope combinatorio se deriva del NUCLEO y no del vocabulario', () => {
  it('el tope es 2^(tamano del nucleo) y hoy son 64 claves', () => {
    expect(MAX_CLAVES_DE_MARCADORES).toBe(2 ** MARCADORES_NUCLEO.length);
    expect(MAX_CLAVES_DE_MARCADORES).toBe(64);
  });

  it('declarar los NUEVE marcadores produce 64 claves, no 512', () => {
    const todos = clavesDeMarcadoresContenidos([...MARCADORES_NUCLEO, ...MARCADORES_ABIERTOS]);
    expect(todos).toHaveLength(MAX_CLAVES_DE_MARCADORES);
    // Y ninguna clave nombra un dato abierto: la busqueda no puede preguntar por lo que no esta ahi.
    for (const abierto of MARCADORES_ABIERTOS) {
      expect(todos.some((clave) => clave.includes(abierto))).toBe(false);
    }
  });

  it('agregar un marcador ABIERTO no hace crecer la lista de subconjuntos', () => {
    const sinAbierto = clavesDeMarcadoresContenidos(['destinatario', 'cuerpo']);
    const conAbierto = clavesDeMarcadoresContenidos(['destinatario', 'cuerpo', 'fecha']);
    expect(conAbierto).toEqual(sinAbierto);
    expect(conAbierto).toHaveLength(4);
  });

  it('la identidad del consumo parte lo declarado: el nucleo busca, lo abierto acompana', () => {
    const identidad = identidadDeConsumo({
      dominios: ['mail.ejemplo.com'],
      verboBloqueado: 'enviar',
      marcadores: ['destinatario', 'fecha', 'lugar'],
    });
    expect(identidad?.marcadoresClave).toBe('destinatario');
    expect(identidad?.marcadoresAbiertos).toEqual(['fecha', 'lugar']);
    expect(identidad?.marcadoresPosibles.some((clave) => clave.includes('fecha'))).toBe(false);
  });
});

describe('la particion como funciones puras (lo que construye las dos columnas)', () => {
  it('marcadoresDeNucleo se queda con el nucleo y marcadoresAbiertos con el resto', () => {
    const exigidos: MarcadorParametro[] = ['fecha', 'destinatario', 'cuerpo', 'nombre'];
    expect(marcadoresDeNucleo(exigidos)).toEqual(['cuerpo', 'destinatario']);
    expect(marcadoresAbiertos(exigidos)).toEqual(['fecha', 'nombre']);
    // La clave sale del nucleo, ordenada y unida con '+': es lo que va a `marcadores_clave`.
    expect(marcadoresClave(marcadoresDeNucleo(exigidos))).toBe('cuerpo+destinatario');
  });

  it('sin datos abiertos la lista queda vacia, que es el default de la columna', () => {
    expect(marcadoresAbiertos(['destinatario', 'asunto', 'cuerpo'])).toEqual([]);
  });
});
