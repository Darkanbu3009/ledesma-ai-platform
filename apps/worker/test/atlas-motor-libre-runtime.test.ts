import { describe, it, expect } from 'vitest';
import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';
import {
  entradasDeCorridaLibre,
  pasosConEstrategiasPercibidas,
  resumenDeCorridaLibre,
  valoresTecleadosDeLaCorrida,
} from '../src/atlas-sitios.js';
import {
  MAX_LINEAS_POR_TURNO,
  PREFIJO_PERCEPCION,
  type ObjetivoDeLectura,
  type PercepcionDePagina,
  type PerceptorDePagina,
} from '../src/percepcion.js';
import { promoverTrayectoria } from '../src/receta-web.js';
import {
  construirOpcionesDeEjecucion,
  crearPercepcionDeCorrida,
  ranurasPorAccion,
} from '../src/stagehand.js';
import { extraerPasosCensurados, type AccionCrudaDeMotor, type PasoCensurado } from '../src/trayectoria.js';
import type { MensajeDeModelo } from '../src/costo-modelo.js';

/**
 * LA CADENA COMPLETA DEL MOTOR LIBRE HASTA EL ATLAS, EN TIEMPO DE EJECUCION.
 *
 * POR QUE EXISTE. En produccion (29 jul 2026) una corrida del motor libre de 16 pasos cerro exitosa,
 * con verificacion superada y accion confirmada, y dejo CERO entradas en aprendizaje_sitios, sin una
 * sola linea de log. El codigo estaba completo y sus tests en verde: lo que fallaba eran los DOS
 * eslabones que ningun test tocaba, los dos fuera de los modulos puros.
 *
 *  1. EL OBJETIVO DE LECTURA NO LLEGABA AL NAVEGADOR. El adaptador cableaba el control con
 *     `percibir: () => perceptor.percibir()`, sin reenviar el objetivo, asi que `percibirPagina`
 *     armaba la expresion de siempre, la lectura fusionada no corria NUNCA y todos los pasos volvian
 *     con la lista vacia. Los tests de PR 267 y 268 construyen el control ellos mismos con un fake
 *     que SI honra el objetivo, asi que ese cableado no lo ejercitaba nadie (vive dentro de
 *     `MotorStagehand.ejecutar`, que ningun test instancia). Aqui se corre por
 *     `crearPercepcionDeCorrida`, que es el cableado real.
 *
 *  2. LA TRAZA TERMINA CON UNA ACCION QUE NADIE ANUNCIA. Cuando el modelo cierra el bucle sin llamar
 *     a la tool `done`, Stagehand la SINTETIZA y la empuja a `state.actions` sin emitir evidencia
 *     (v3AgentHandler.ensureDone), asi que la traza queda con una accion mas que las ranuras
 *     emitidas. `extraerPasosCensurados` empareja por posicion SOLO si las cantidades cuadran, o sea
 *     que esa unica accion final descartaba el aprendizaje de la corrida ENTERA. Los tests anteriores
 *     derivaban la traza de la misma lista de eventos, asi que jamas podian desalinearse.
 *
 * La corrida de abajo reproduce la real: screenshots, un fillFormVision, acts con selector xpath
 * sobre los cinco controles del envio y la accion `done` sintetica al cierre. Todo con fakes: cero
 * navegador, cero modelo.
 */

const DOMINIO = 'mail.google.com';

/** Los valores que la corrida tecleo, contra los que corre la paranoia del invariante 4. */
const DESTINATARIO = 'martin@ejemplo.com';
const ASUNTO = 'Reporte semanal';
const CUERPO = 'Adjunto el resumen de la semana';

/** Un paso de la corrida, en la forma en la que el motor lo emite. */
interface PasoDeLaCorrida {
  tipo: string;
  instruccion?: string;
  metodo?: string;
  argumentos?: string[];
  selector?: string;
  /** Argumentos propios de la tool (fillFormVision lleva sus campos ahi). */
  args?: Record<string, unknown>;
}

/**
 * LOS 16 PASOS DE LA CORRIDA REAL. Los acts llevan selector XPATH POSICIONAL PURO, que es lo que
 * Stagehand resuelve en Gmail y de lo que no se puede aprender nada literal: la unica fuente de esta
 * corrida es la lectura de percepcion. El unico con predicado de atributo es Enviar, que es el caso
 * inverso (el compose ya se desmonto cuando corre su lectura y solo queda el selector).
 */
/** Xpath posicional del boton Redactar, que sigue vivo despues de abrirse el compose. */
const XPATH_REDACTAR = '/html[1]/body[1]/div[7]/div[1]/div[1]/div[2]';

const CORRIDA: PasoDeLaCorrida[] = [
  { tipo: 'goto', instruccion: 'abrir el correo' },
  { tipo: 'screenshot' },
  { tipo: 'ariaTree' },
  {
    tipo: 'act',
    instruccion: 'click en Redactar',
    metodo: 'click',
    selector: `xpath=${XPATH_REDACTAR}`,
  },
  { tipo: 'screenshot' },
  {
    tipo: 'act',
    instruccion: 'escribir el destinatario en el campo Para',
    metodo: 'fill',
    argumentos: [DESTINATARIO],
    selector: 'xpath=/html[1]/body[1]/div[7]/div[3]/div[1]/input[1]',
  },
  {
    tipo: 'act',
    instruccion: 'press Tab key to confirm the recipient',
    metodo: 'press',
    argumentos: ['Tab'],
    selector: 'xpath=/html[1]/body[1]/div[7]/div[3]/div[1]/input[1]',
  },
  // MODO HIBRIDO: llena campos por coordenadas y empuja UNA sola accion a la traza (no es fillForm,
  // que empuja una por campo). No resuelve selector y el atlas no la clasifica.
  {
    tipo: 'fillFormVision',
    args: { fields: [{ label: 'Asunto', value: ASUNTO }] },
  },
  {
    tipo: 'act',
    instruccion: 'escribir el asunto',
    metodo: 'fill',
    argumentos: [ASUNTO],
    selector: 'xpath=/html[1]/body[1]/div[7]/div[3]/div[2]/input[1]',
  },
  { tipo: 'screenshot' },
  {
    tipo: 'act',
    instruccion: 'escribir el cuerpo',
    metodo: 'fill',
    argumentos: [CUERPO],
    selector: 'xpath=/html[1]/body[1]/div[7]/div[3]/div[4]/div[1]',
  },
  { tipo: 'extract', instruccion: 'confirmar que los campos quedaron llenos' },
  { tipo: 'screenshot' },
  {
    tipo: 'act',
    instruccion: 'click en Enviar',
    metodo: 'click',
    selector: `xpath=/html[1]/body[1]/div[7]//div[@aria-label='Enviar']`,
  },
  { tipo: 'extract', instruccion: 'confirmar que el mensaje se envio' },
  { tipo: 'screenshot' },
];

/** Indice de cada control util dentro de la corrida. */
const IDX_REDACTAR = 3;
const IDX_PARA = 5;
const IDX_ASUNTO = 8;
const IDX_CUERPO = 10;
const IDX_ENVIAR = 13;

/** Lo que la percepcion lee del DOM en cada control (nombres reales de Gmail). */
const LEIDO_REDACTAR: EstrategiaLocalizacion = { tipo: 'rol', rol: 'button', nombre: 'Redactar' };
const LEIDO_PARA: EstrategiaLocalizacion = { tipo: 'rol', rol: 'textbox', nombre: 'Para' };
const LEIDO_ASUNTO: EstrategiaLocalizacion = { tipo: 'rol', rol: 'textbox', nombre: 'Asunto' };
const LEIDO_CUERPO: EstrategiaLocalizacion = {
  tipo: 'rol',
  rol: 'textbox',
  nombre: 'Cuerpo del mensaje',
};

/** Las clases que la corrida tiene que dejar en el aprendizaje comun. */
const CLASE_REDACTAR = 'click|rol:button|redactar';
const CLASE_PARA = 'escribir|rol:textbox|para';
const CLASE_ASUNTO = 'escribir|rol:textbox|asunto';
const CLASE_CUERPO = 'escribir|rol:textbox|cuerpo del mensaje';
const CLASE_ENVIAR = 'click|atributo:aria-label|enviar';

function bandeja(estrategias?: EstrategiaLocalizacion[]): PercepcionDePagina {
  return {
    url: `https://${DOMINIO}/mail/u/0/#inbox`,
    titulo: 'Recibidos',
    nodos: 3200,
    foco: 'input text q Buscar correo',
    campos: [{ contexto: 'input text q Buscar correo', valor: '' }],
    ...(estrategias === undefined ? {} : { estrategias }),
  };
}

/**
 * EL NAVEGADOR, con el MISMO contrato que `BrowserbaseAdapter.percibirPagina`: sin objetivo arma la
 * expresion de siempre y por tanto NO devuelve estrategias; con objetivo devuelve las del elemento
 * que ese objetivo apunta. Es lo que convierte el objetivo perdido en un fallo visible.
 *
 * El boton ENVIAR no se lee: el compose ya se desmonto cuando corre su lectura, el xpath no resuelve
 * y la lectura no tiene respaldo al foco a proposito.
 */
function navegadorDeLaCorrida(): {
  perceptor: PerceptorDePagina;
  objetivos: Array<ObjetivoDeLectura | undefined>;
  lecturas: () => number;
} {
  const objetivos: Array<ObjetivoDeLectura | undefined> = [];
  return {
    objetivos,
    lecturas: () => objetivos.length,
    perceptor: {
      percibir: async (objetivo?: ObjetivoDeLectura | undefined) => {
        objetivos.push(objetivo);
        if (objetivo === undefined) return bandeja();
        // El unico xpath que todavia resuelve es el de Redactar: el del boton Enviar apunta a un
        // compose que el propio envio desmonto, y la lectura no tiene respaldo al foco a proposito.
        if (objetivo.tipo === 'xpath') {
          return objetivo.xpath === XPATH_REDACTAR ? bandeja([LEIDO_REDACTAR]) : bandeja();
        }
        if (objetivo.tipo === 'campo') {
          if (objetivo.texto === DESTINATARIO) return bandeja([LEIDO_PARA]);
          if (objetivo.texto === ASUNTO) return bandeja([LEIDO_ASUNTO]);
          if (objetivo.texto === CUERPO) return bandeja([LEIDO_CUERPO]);
        }
        return bandeja();
      },
    },
  };
}

/** La salida de la tool, tal como la ve el bucle del motor. */
function salidaDelPaso(paso: PasoDeLaCorrida): unknown {
  return paso.metodo === undefined
    ? {}
    : {
        playwrightArguments: {
          selector: paso.selector,
          method: paso.metodo,
          arguments: paso.argumentos ?? [],
        },
      };
}

/**
 * La accion CRUDA que Stagehand empuja a su traza por cada tool (mapToolResultToActions): `act` lleva
 * sus playwrightArguments y el resto es la tool con sus argumentos.
 */
function accionCrudaDelPaso(paso: PasoDeLaCorrida): AccionCrudaDeMotor {
  return {
    type: paso.tipo,
    action: paso.instruccion ?? null,
    pageUrl: `https://${DOMINIO}/mail/u/0/`,
    ...(paso.args ?? {}),
    ...(paso.metodo === undefined
      ? {}
      : {
          playwrightArguments: {
            selector: paso.selector,
            method: paso.metodo,
            arguments: paso.argumentos ?? [],
          },
        }),
  };
}

/**
 * LA ACCION `done` QUE NADIE ANUNCIA: el modelo cerro el bucle sin llamar a la tool, asi que
 * `ensureDone` la sintetiza y la empuja a la traza SIN emitir `step_finished`. Va al final, que es
 * donde la empuja Stagehand.
 */
const DONE_SINTETICA: AccionCrudaDeMotor = {
  type: 'done',
  taskCompleted: true,
  pageUrl: `https://${DOMINIO}/mail/u/0/`,
};

/** La traza del motor: una accion por tool mas la `done` sintetica del cierre. */
const TRAZA: AccionCrudaDeMotor[] = [...CORRIDA.map(accionCrudaDelPaso), DONE_SINTETICA];

/**
 * Corre la secuencia entera POR EL CABLEADO REAL: el control se crea como lo crea el adaptador
 * (`crearPercepcionDeCorrida`) y los eventos entran por el bucle real
 * (`construirOpcionesDeEjecucion`). Devuelve lo emitido para el atlas, lo que el modelo habria visto
 * por el canal de percepcion y cuantas veces se leyo la pagina.
 */
async function correrLaCorrida(opciones: { conPerceptor: boolean } = { conPerceptor: true }): Promise<{
  porAccion: EstrategiaLocalizacion[][];
  mensajes: string[];
  lecturas: number;
  objetivos: Array<ObjetivoDeLectura | undefined>;
}> {
  const navegador = navegadorDeLaCorrida();
  const porAccion: EstrategiaLocalizacion[][] = [];
  const percepcion = crearPercepcionDeCorrida({
    perceptor: opciones.conPerceptor ? navegador.perceptor : undefined,
  });
  await percepcion?.inicializar();
  const ejecucion = construirOpcionesDeEjecucion({
    objetivo: 'enviar un correo',
    maxPasos: 40,
    toolTimeoutMs: 1000,
    historialPasos: 8,
    ...(percepcion !== undefined ? { percepcion } : {}),
    registrarEstrategias: (lista) => porAccion.push(...lista),
  });
  const mensajes: string[] = [];
  const base: MensajeDeModelo[] = [{ role: 'user', content: 'objetivo' }];
  for (const paso of CORRIDA) {
    await ejecucion.callbacks?.onEvidence?.({
      type: 'step_finished',
      actionName: paso.tipo,
      actionArgs: { action: paso.instruccion ?? '', ...(paso.args ?? {}) },
      reasoning: '',
      toolOutput: { ok: true, result: salidaDelPaso(paso) },
    } as never);
    const preparado = await ejecucion.callbacks?.prepareStep?.({ messages: base } as never);
    for (const mensaje of (preparado as { messages: MensajeDeModelo[] }).messages) {
      mensajes.push(String(mensaje.content));
    }
  }
  return { porAccion, mensajes, lecturas: navegador.lecturas(), objetivos: navegador.objetivos };
}

/** Los pasos censurados de la corrida, por el camino exacto del handler. */
function pasosDeLaTraza(porAccion: EstrategiaLocalizacion[][]): PasoCensurado[] {
  return extraerPasosCensurados(TRAZA, [], ranurasPorAccion(porAccion, TRAZA.length)).map(
    (paso, idx) => ({ ...paso, idx, dominio: DOMINIO }),
  );
}

/** Las clases que la corrida deja en el atlas, por el camino exacto del handler. */
function clasesEnElAtlas(pasos: PasoCensurado[]): string[] {
  return entradasDeCorridaLibre({
    dominio: DOMINIO,
    pasos: pasosConEstrategiasPercibidas(pasos),
    valores: valoresTecleadosDeLaCorrida({}, pasos),
  }).map((entrada) => entrada.claseDeElemento);
}

describe('cadena completa del motor libre hasta el atlas', () => {
  it('una corrida del motor libre deja en el atlas los controles que uso', async () => {
    const { porAccion } = await correrLaCorrida();
    const clases = clasesEnElAtlas(pasosDeLaTraza(porAccion));

    expect(clases).toEqual([CLASE_REDACTAR, CLASE_PARA, CLASE_ASUNTO, CLASE_CUERPO, CLASE_ENVIAR]);
  });

  it('el objetivo de lectura llega al navegador en cada paso que toca un elemento', async () => {
    const { objetivos } = await correrLaCorrida();

    // La huella inicial no pide objetivo; los cinco controles si, cada uno el suyo.
    expect(objetivos[0]).toBeUndefined();
    expect(objetivos).toContainEqual({ tipo: 'xpath', xpath: XPATH_REDACTAR });
    expect(objetivos).toContainEqual({ tipo: 'campo', texto: DESTINATARIO });
    expect(objetivos).toContainEqual({ tipo: 'campo', texto: ASUNTO });
    expect(objetivos).toContainEqual({ tipo: 'campo', texto: CUERPO });
    expect(objetivos.filter((objetivo) => objetivo !== undefined)).toHaveLength(5);
  });

  it('lo leido queda en el paso que toco ese elemento, no en otro', async () => {
    const pasos = pasosDeLaTraza((await correrLaCorrida()).porAccion);

    expect(pasos[IDX_REDACTAR]?.estrategiasPercibidas).toEqual([LEIDO_REDACTAR]);
    expect(pasos[IDX_PARA]?.estrategiasPercibidas).toEqual([LEIDO_PARA]);
    expect(pasos[IDX_ASUNTO]?.estrategiasPercibidas).toEqual([LEIDO_ASUNTO]);
    expect(pasos[IDX_CUERPO]?.estrategiasPercibidas).toEqual([LEIDO_CUERPO]);
    // El boton Enviar ya no estaba para leerse: lo suyo sale del literal de su propio selector.
    expect(pasos[IDX_ENVIAR]?.estrategiasPercibidas).toEqual([
      { tipo: 'atributo', atributo: 'aria-label', valor: 'Enviar' },
    ]);
    // Y los pasos que no tocan ningun elemento no se inventan uno.
    expect(pasos[0]?.estrategiasPercibidas).toBeUndefined();
    expect(pasos[1]?.estrategiasPercibidas).toBeUndefined();
  });

  it('la accion `done` que Stagehand sintetiza no descarta el aprendizaje de la corrida entera', async () => {
    const { porAccion } = await correrLaCorrida();
    // La traza trae una accion mas que las ranuras emitidas: la `done` que nadie anuncio.
    expect(porAccion).toHaveLength(TRAZA.length - 1);

    // Sin rellenar esa ranura, el emparejamiento posicional se descarta ENTERO y no queda nada.
    const sinRellenar = extraerPasosCensurados(TRAZA, [], porAccion).map((paso) => ({
      ...paso,
      dominio: DOMINIO,
    }));
    expect(clasesEnElAtlas(sinRellenar)).toEqual([]);
    // Con la ranura rellenada (ranurasPorAccion), la corrida aporta lo que uso.
    expect(clasesEnElAtlas(pasosDeLaTraza(porAccion))).toHaveLength(5);
  });

  it('el fillFormVision no desalinea la traza: empuja UNA accion y consume UNA ranura', async () => {
    const { porAccion } = await correrLaCorrida();

    expect(porAccion).toHaveLength(CORRIDA.length);
    expect(porAccion[7]).toEqual([]);
    expect(porAccion[IDX_ASUNTO]).toEqual([LEIDO_ASUNTO]);
  });
});

describe('garantias del PR 267, sostenidas por el cableado real', () => {
  it('el texto de percepcion que llega al modelo es IDENTICO con y sin la lectura fusionada', async () => {
    const con = await correrLaCorrida();
    const sin = await correrLaCorrida({ conPerceptor: false });

    // Sin perceptor no hay canal de percepcion en absoluto: se compara contra la corrida que SI lo
    // tiene pero cuya lectura no aporta nada al texto, que es lo que fija la garantia.
    expect(sin.mensajes.every((mensaje) => !mensaje.includes(PREFIJO_PERCEPCION))).toBe(true);
    for (const mensaje of con.mensajes) {
      expect(mensaje.split('\n').length).toBeLessThanOrEqual(MAX_LINEAS_POR_TURNO);
    }
    // Y el dato del atlas jamas viaja por la cola que ve el modelo.
    expect(con.mensajes.join('\n')).not.toContain('Cuerpo del mensaje');
    expect(con.mensajes.join('\n')).not.toContain('rol:textbox');
  });

  it('cero conexiones CDP adicionales: una lectura por paso que toca la pagina, mas la inicial', async () => {
    const { lecturas } = await correrLaCorrida();

    // Los screenshots, el ariaTree y los extract no pagan lectura: son los cinco pasos que no la
    // piden. La lectura del atlas viaja DENTRO de la que ya corria.
    const sinEfectoEnLaPagina = CORRIDA.filter((paso) =>
      ['screenshot', 'ariaTree', 'extract'].includes(paso.tipo),
    ).length;
    expect(lecturas).toBe(1 + CORRIDA.length - sinEfectoEnLaPagina);
  });

  it('la promocion automatica a recetas sigue sin dispararse por esta via', async () => {
    const pasos = pasosDeLaTraza((await correrLaCorrida()).porAccion);

    // `estrategias` (lo que lee la promocion) sigue vacia en todos los pasos: lo del atlas viaja en
    // su campo aparte y encender la promocion sigue siendo TAREA_WEB_OBSERVADOR_PASOS.
    expect(pasos.every((paso) => paso.estrategias.length === 0)).toBe(true);
    expect(pasos.some((paso) => (paso.estrategiasPercibidas ?? []).length > 0)).toBe(true);
    const promocion = promoverTrayectoria({
      pasos,
      dominio: DOMINIO,
      objetivo: 'enviar un correo',
      estado: 'exitosa',
      exigeVerificacion: true,
    });
    expect(promocion.promovida).toBe(false);
  });
});

describe('ranurasPorAccion', () => {
  it('rellena las acciones que ningun evento anuncio, al final y vacias', () => {
    expect(ranurasPorAccion([[LEIDO_PARA]], 3)).toEqual([[LEIDO_PARA], [], []]);
    expect(ranurasPorAccion([], 2)).toEqual([[], []]);
    expect(ranurasPorAccion([[LEIDO_PARA]], 1)).toEqual([[LEIDO_PARA]]);
  });

  it('con MAS ranuras que acciones no se adivina: lista vacia y no se aprende nada', () => {
    expect(ranurasPorAccion([[LEIDO_PARA], [LEIDO_ASUNTO]], 1)).toEqual([]);
  });
});

describe('resumen de por que una corrida no dejo nada', () => {
  /** Un paso de traza ya censurado, con las estrategias puestas donde el agregador las busca. */
  function paso(estrategias: EstrategiaLocalizacion[]): PasoCensurado {
    return {
      idx: 0,
      accion: { tipo: 'act', instruccion: 'click en algo', metodo: 'click', argumentos: [] },
      selector: null,
      valorCensurado: null,
      url: null,
      exito: true,
      estrategias,
    };
  }

  it('cuenta los pasos que se cayeron por el filtro de tipos', () => {
    const resumen = resumenDeCorridaLibre({
      dominio: DOMINIO,
      pasos: [
        paso([{ tipo: 'xpath', xpath: '/html[1]/body[1]/div[2]' }]),
        paso([{ tipo: 'atributo', atributo: 'id', valor: ':u3' }]),
        paso([LEIDO_REDACTAR]),
      ],
      valores: [],
    });

    expect(resumen).toEqual({
      pasos: 3,
      conEstrategias: 3,
      clasificables: 3,
      conClase: 1,
      sinTipoAdmitido: 2,
      porParanoiaDeValores: 0,
      sinNombreUtilizable: 0,
    });
  });

  it('cuenta los pasos que se cayeron por la paranoia de valores', () => {
    // El texto tecleado CONTIENE el nombre del control, asi que la estrategia se descarta entera.
    const resumen = resumenDeCorridaLibre({
      dominio: DOMINIO,
      pasos: [paso([LEIDO_ASUNTO])],
      valores: ['Asunto de la reunion del lunes'],
    });

    expect(resumen.porParanoiaDeValores).toBe(1);
    expect(resumen.conClase).toBe(0);
  });

  it('distingue los pasos que nunca traen estrategias de los que el atlas no clasifica', () => {
    const sinAccion: PasoCensurado = {
      ...paso([LEIDO_REDACTAR]),
      accion: { tipo: 'scroll', instruccion: null, metodo: null, argumentos: [] },
    };
    const resumen = resumenDeCorridaLibre({
      dominio: DOMINIO,
      pasos: [paso([]), sinAccion],
      valores: [],
    });

    expect(resumen).toEqual({
      pasos: 2,
      conEstrategias: 1,
      clasificables: 0,
      conClase: 0,
      sinTipoAdmitido: 0,
      porParanoiaDeValores: 0,
      sinNombreUtilizable: 0,
    });
  });
});
