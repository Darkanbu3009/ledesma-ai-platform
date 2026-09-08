import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  nombresDeLaFamilia,
  resumenDeIdentidad,
  verificarIdentidadDeElemento,
  type EntradaDeIdentidad,
} from '../src/barrera-identidad.js';
import { esNavegacionDeSoloLectura } from '../src/prompt-tarea-web.js';

/**
 * BARRERA DE IDENTIDAD DEL ELEMENTO (FIX A). Lo que estos tests fijan es la unica pregunta que
 * verificarAccion nunca se hace: ¿el elemento que se va a accionar es el que corresponde?
 *
 * La barrera es ALLOWLIST ESTRICTA porque su asimetria es la INVERSA de la de
 * detectarAccionQueExigeVerificacion: alla lo caro es el falso negativo (dejaria pasar la accion sin
 * compararla), aqui lo caro es el falso positivo (ejecuta la accion equivocada sobre la cuenta real).
 * Por eso no existe un tercer valor y todo lo que no pasa explicitamente, bloquea.
 */

/** La clase que claseDeElemento produce para un click sobre un boton con ese nombre accesible. */
function claseDeBoton(nombre: string): string {
  return `click|rol:button|${nombre}`;
}

/** Entrada con la clase del paso YA corroborada: aisla la comprobacion del verbo. */
function entrada(overrides: Partial<EntradaDeIdentidad> = {}): EntradaDeIdentidad {
  const clase = overrides.claseDeclarada ?? claseDeBoton('enviar');
  return {
    claseDeclarada: clase,
    clasesCorroboradas: new Set([clase]),
    verboDelObjetivo: 'enviar',
    esPasoIrreversible: true,
    nombreAccesible: null,
    ...overrides,
  };
}

/** Caso de la FAMILIA DEL VERBO: el nombre accesible del DOM contra el verbo que pidio el usuario. */
function porNombre(nombreAccesible: string, verboDelObjetivo: string) {
  return verificarIdentidadDeElemento(
    entrada({
      // La clase declara el MISMO nombre que hay en el DOM: aqui no se esta probando la deriva de la
      // clase (eso es el caso 'clase_distinta'), sino si ese nombre es la accion que se pidio.
      claseDeclarada: claseDeBoton(nombreAccesible.toLowerCase()),
      clasesCorroboradas: new Set([claseDeBoton(nombreAccesible.toLowerCase())]),
      verboDelObjetivo,
      nombreAccesible,
    }),
  );
}

describe('verificarIdentidadDeElemento: la familia del verbo contra el nombre accesible', () => {
  it('"Enviar (Ctrl-Enter)" con objetivo enviar: permite (el aria-label real lleva sufijo)', () => {
    expect(porNombre('Enviar (Ctrl-Enter)', 'enviar')).toEqual({ tipo: 'permitir' });
  });

  it('"Send" con objetivo enviar: permite (la familia cruza los dos idiomas)', () => {
    expect(porNombre('Send', 'enviar')).toEqual({ tipo: 'permitir' });
  });

  it('"Eliminar definitivamente" con objetivo enviar: BLOQUEA (es otra familia)', () => {
    expect(porNombre('Eliminar definitivamente', 'enviar')).toEqual({
      tipo: 'bloquear',
      motivo: 'verbo_no_corresponde',
    });
  });

  it('"Delete forever" con objetivo enviar: BLOQUEA (otra familia, en ingles)', () => {
    expect(porNombre('Delete forever', 'enviar')).toEqual({
      tipo: 'bloquear',
      motivo: 'verbo_no_corresponde',
    });
  });

  it('"Archivar" con objetivo enviar: BLOQUEA (no pertenece a ninguna familia)', () => {
    expect(porNombre('Archivar', 'enviar')).toEqual({
      tipo: 'bloquear',
      motivo: 'verbo_no_corresponde',
    });
  });

  it('"Enviar y archivar" con objetivo enviar: permite (contiene la familia pedida)', () => {
    expect(porNombre('Enviar y archivar', 'enviar')).toEqual({ tipo: 'permitir' });
  });

  it('"Descartar borrador" con objetivo enviar: BLOQUEA', () => {
    expect(porNombre('Descartar borrador', 'enviar')).toEqual({
      tipo: 'bloquear',
      motivo: 'verbo_no_corresponde',
    });
  });
});

describe('verificarIdentidadDeElemento: falla cerrada sin excepcion', () => {
  it('nombre accesible null en el paso irreversible: BLOQUEA por elemento no legible', () => {
    expect(verificarIdentidadDeElemento(entrada({ nombreAccesible: null }))).toEqual({
      tipo: 'bloquear',
      motivo: 'elemento_no_legible',
    });
  });

  it('clase que el dominio NO corroboro: BLOQUEA', () => {
    const veredicto = verificarIdentidadDeElemento(
      entrada({
        claseDeclarada: claseDeBoton('enviar'),
        clasesCorroboradas: new Set([claseDeBoton('guardar borrador')]),
        nombreAccesible: 'Enviar (Ctrl-Enter)',
      }),
    );
    expect(veredicto).toEqual({ tipo: 'bloquear', motivo: 'clase_no_corroborada' });
  });

  it('paso sin clase de elemento: BLOQUEA (no hay identidad que comparar)', () => {
    expect(
      verificarIdentidadDeElemento(
        entrada({ claseDeclarada: null, clasesCorroboradas: new Set(), nombreAccesible: 'Enviar' }),
      ),
    ).toEqual({ tipo: 'bloquear', motivo: 'clase_no_corroborada' });
  });

  it('objetivo sin verbo en un paso marcado como irreversible: BLOQUEA', () => {
    expect(
      verificarIdentidadDeElemento(
        entrada({ verboDelObjetivo: null, nombreAccesible: 'Enviar (Ctrl-Enter)' }),
      ),
    ).toEqual({ tipo: 'bloquear', motivo: 'verbo_no_corresponde' });
  });

  it('la clase dice "enviar" y en el DOM hay otro elemento: BLOQUEA por clase distinta', () => {
    // ES EL RIESGO QUE YA CORRE EN PRODUCCION: una receta cuyas estrategias se auto repararon
    // (repararEstrategias) y quedaron apuntando a otro elemento tras un rediseno del sitio.
    const veredicto = verificarIdentidadDeElemento(
      entrada({ nombreAccesible: 'Eliminar definitivamente' }),
    );
    expect(veredicto).toEqual({ tipo: 'bloquear', motivo: 'clase_distinta' });
  });
});

/**
 * EL LIMITE DE PALABRA DE LA COMPARACION DE LA CLASE (FIX defecto 1). La clase se comparaba contra
 * el nombre accesible del DOM con un `startsWith` pelado, asi que cualquier control cuyo nombre
 * CONTINUARA la palabra de la clase pasaba por el mismo control: una clase "para" -- que el atlas
 * escribe de verdad, `claseDeElemento('escribir', [{rol:'textbox', nombre:'Para'}])` -- daba por
 * buena una barra "Parar reproduccion", y una clase "eliminar" un boton "Eliminares".
 *
 * El criterio pasa a ser el MISMO que el del resolutor de estrategias dentro de la pagina
 * (`nombreCoincidePorPrefijo`, localizacion.ts): el prefijo vale si el resto empieza en un caracter
 * no alfanumerico o si lo unico que sobra es la `s` del plural. Tenerlos distintos significaba que
 * la barrera aceptaba identidades que el resolutor jamas habria resuelto.
 */
describe('verificarIdentidadDeElemento: el limite de palabra de la clase', () => {
  /** La clase declara `deLaClase` y en el DOM hay `enElDom`. Aisla la comprobacion (a). */
  function porClase(deLaClase: string, enElDom: string) {
    return verificarIdentidadDeElemento(
      entrada({
        claseDeclarada: claseDeBoton(deLaClase),
        clasesCorroboradas: new Set([claseDeBoton(deLaClase)]),
        // El paso NO es el irreversible: lo que se mide es la clase, no la familia del verbo.
        esPasoIrreversible: false,
        nombreAccesible: enElDom,
      }),
    );
  }

  const PERMITIR = { tipo: 'permitir' } as const;
  const CLASE_DISTINTA = { tipo: 'bloquear', motivo: 'clase_distinta' } as const;

  it('clase "eliminar" contra "Eliminares": BLOQUEA (el resto continua la palabra)', () => {
    expect(porClase('eliminar', 'Eliminares')).toEqual(CLASE_DISTINTA);
  });

  it('clase "para" contra "Parar reproduccion": BLOQUEA (el caso que el DOM ya fijaba)', () => {
    expect(porClase('para', 'Parar reproduccion')).toEqual(CLASE_DISTINTA);
  });

  it('clase "enviar" contra "Enviarme una copia": BLOQUEA (otro control, otra accion)', () => {
    expect(porClase('enviar', 'Enviarme una copia')).toEqual(CLASE_DISTINTA);
  });

  it('clase "eliminar" contra "Eliminar ambiente": permite (sobra un espacio)', () => {
    expect(porClase('eliminar', 'Eliminar ambiente')).toEqual(PERMITIR);
  });

  /**
   * MEDICION QUE NO CAMBIA, y hay que dejarla escrita porque la investigacion la reporto como el
   * caso a bloquear: "Eliminar TODOS los ambientes" YA respeta el limite de palabra (lo que sobra
   * empieza en un espacio), asi que este veredicto es 'permitir' antes y despues del fix. Lo que
   * separa "Eliminar ambiente" de "Eliminar TODOS los ambientes" es el ALCANCE de la accion, no la
   * identidad del control, y ningun criterio de prefijo lo puede ver: el prefijo que si distingue
   * los dos nombres tambien rechazaria "Enviar (Ctrl-Enter)" contra la clase "enviar", que es el
   * caso real de produccion por el que la comparacion es por prefijo y no por igualdad.
   * Quien acota el alcance es la familia del verbo (comprobacion (b)) y la verificacion
   * determinista, no esta comparacion.
   */
  it('clase "eliminar" contra "Eliminar TODOS los ambientes": permite, igual que antes', () => {
    expect(porClase('eliminar', 'Eliminar TODOS los ambientes')).toEqual(PERMITIR);
  });

  it('el plural queda fijado tal como lo define el resolutor: solo la "s" que sobra sola', () => {
    // "destinatario" contra "Destinatarios en Para" es el caso real de Gmail: la s va seguida de un
    // no alfanumerico. "Eliminars" es la s al final. "Eliminares" ya no: hay letra despues de la s.
    expect(porClase('destinatario', 'Destinatarios en Para')).toEqual(PERMITIR);
    expect(porClase('eliminar', 'Eliminars')).toEqual(PERMITIR);
    expect(porClase('eliminar', 'Eliminares')).toEqual(CLASE_DISTINTA);
  });

  it('el sufijo real del boton Enviar de Gmail sigue pasando', () => {
    expect(porClase('enviar', 'Enviar (Ctrl-Enter)')).toEqual(PERMITIR);
  });

  /**
   * REGRESION CONTRA LAS CLASES REALES. Son las que el atlas tiene escritas para mail.google.com
   * (las seis de la corrida de referencia, atlas-sitios.test.ts, mas la variante de eje 'texto' del
   * boton Redactar), con el nombre accesible que la percepcion lee de verdad en el DOM. El
   * endurecimiento no puede cambiarles el veredicto: sus nombres son palabras completas.
   */
  it('las clases reales de mail.google.com conservan su veredicto', () => {
    const reales: Array<[string, string]> = [
      ['click|rol:button|redactar', 'Redactar'],
      ['click|texto|redactar', 'Redactar'],
      ['click|atributo:aria-label|destinatarios en para', 'Destinatarios en Para'],
      ['escribir|atributo:aria-label|destinatarios en para', 'Destinatarios en Para'],
      ['escribir|atributo:aria-label|asunto', 'Asunto'],
      ['escribir|atributo:aria-label|cuerpo del mensaje', 'Cuerpo del mensaje'],
      ['click|atributo:aria-label|enviar', 'Enviar (Ctrl-Enter)'],
    ];
    for (const [clase, nombreAccesible] of reales) {
      const veredicto = verificarIdentidadDeElemento(
        entrada({
          claseDeclarada: clase,
          clasesCorroboradas: new Set([clase]),
          esPasoIrreversible: false,
          nombreAccesible,
        }),
      );
      expect(veredicto, clase).toEqual(PERMITIR);
    }
  });
});

describe('verificarIdentidadDeElemento: el paso que NO es el irreversible', () => {
  it('con la clase corroborada, pasa sin exigir nombre accesible (no se lee el DOM)', () => {
    expect(
      verificarIdentidadDeElemento(entrada({ esPasoIrreversible: false, nombreAccesible: null })),
    ).toEqual({ tipo: 'permitir' });
  });

  it('la clase se comprueba igual: una clase no corroborada bloquea tambien aqui', () => {
    expect(
      verificarIdentidadDeElemento(
        entrada({
          esPasoIrreversible: false,
          clasesCorroboradas: new Set([claseDeBoton('otro')]),
        }),
      ),
    ).toEqual({ tipo: 'bloquear', motivo: 'clase_no_corroborada' });
  });
});

/**
 * FIX C: la barrera NO consulta esNavegacionDeSoloLectura (prompt-tarea-web.ts). Esa funcion existe
 * para que la navegacion y la lectura JAMAS se bloqueen y hoy devuelve true en cuanto la descripcion
 * menciona link, folder, sidebar, carpeta o inbox sin un gatillo de accion. Consultarla aqui
 * convertiria su bypass en un bypass de esta barrera.
 */
describe('la barrera no consulta esNavegacionDeSoloLectura', () => {
  const NOMBRE_EXENTO = 'Mover a la carpeta';

  it('ese nombre SI esta exento para esNavegacionDeSoloLectura', () => {
    expect(esNavegacionDeSoloLectura(NOMBRE_EXENTO)).toBe(true);
  });

  it('y la barrera lo bloquea igual: el bypass de navegacion no la alcanza', () => {
    expect(porNombre(NOMBRE_EXENTO, 'enviar')).toEqual({
      tipo: 'bloquear',
      motivo: 'verbo_no_corresponde',
    });
  });

  it('el modulo de la barrera no nombra esa funcion en ninguna linea', () => {
    const fuente = readFileSync(new URL('../src/barrera-identidad.ts', import.meta.url), 'utf8');
    // Aparece SOLO en el comentario que explica por que no se usa, jamas como llamada.
    expect(/esNavegacionDeSoloLectura\s*\(/.test(fuente)).toBe(false);
  });
});

/**
 * LA ETIQUETA DEL VEREDICTO es UNA sola para los DOS caminos que evaluan la barrera (el ejecutor de
 * recetas y la guardia del motor libre). Estos tests fijan exactamente los valores que el camino de
 * recetas ya escribia antes de que la guardia reusara esta funcion: si cambiaran, la medicion de una
 * corrida por receta dejaria de ser comparable con la de una corrida libre en /actividad.
 */
describe('resumenDeIdentidad: una sola etiqueta para los dos caminos', () => {
  it('permitir es siempre identidad:permitida y exito, en los tres modos', () => {
    for (const modo of ['apagada', 'observacion', 'activa'] as const) {
      expect(resumenDeIdentidad({ tipo: 'permitir' }, modo)).toEqual({
        etiqueta: 'identidad:permitida',
        exito: true,
      });
    }
  });

  it('en OBSERVACION un bloqueo dice HABRIA bloqueado y el paso NO queda como fallido', () => {
    expect(resumenDeIdentidad({ tipo: 'bloquear', motivo: 'clase_distinta' }, 'observacion')).toEqual(
      { etiqueta: 'identidad:habria_bloqueado', exito: true },
    );
  });

  it('en ACTIVA el mismo veredicto es un bloqueo efectivo y el paso queda como fallido', () => {
    expect(resumenDeIdentidad({ tipo: 'bloquear', motivo: 'clase_distinta' }, 'activa')).toEqual({
      etiqueta: 'identidad:bloqueada',
      exito: false,
    });
  });

  it('un fallo de la propia barrera nunca marca el paso como fallido', () => {
    expect(resumenDeIdentidad({ tipo: 'no_evaluable' }, 'activa')).toEqual({
      etiqueta: 'identidad:no_evaluable',
      exito: true,
    });
  });
});

/**
 * NOMBRES DE LA FAMILIA: el unico insumo deterministico que el camino del MOTOR LIBRE tiene para
 * buscar en el DOM el control de la accion que pidio el usuario. Sale de la tabla de verbos, jamas
 * de la descripcion que redacta el modelo.
 */
describe('nombresDeLaFamilia', () => {
  it('trae la familia entera, en los dos idiomas', () => {
    expect(nombresDeLaFamilia('enviar')).toEqual(['enviar', 'send']);
    expect(nombresDeLaFamilia('send')).toEqual(['enviar', 'send']);
    expect(nombresDeLaFamilia('delete')).toEqual(['borrar', 'eliminar', 'delete', 'remove']);
  });

  it('sin verbo, o con un verbo que no esta en la tabla, no hay nada que buscar', () => {
    expect(nombresDeLaFamilia(null)).toEqual([]);
    expect(nombresDeLaFamilia('archivar')).toEqual([]);
  });
});
