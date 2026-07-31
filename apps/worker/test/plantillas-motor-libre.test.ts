import { describe, it, expect } from 'vitest';
import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';
import { claseDeElemento, pasosConEstrategiasPercibidas } from '../src/atlas-sitios.js';
import { plantillaDeLaCorrida } from '../src/plantillas-compartidas.js';
import { promoverTrayectoria } from '../src/receta-web.js';
import { construirPasoDeBloqueo } from '../src/verificacion.js';
import { resumenDeIdentidad } from '../src/barrera-identidad.js';
import type { PasoCensurado } from '../src/trayectoria.js';

/**
 * LA CADENA DE PUBLICACION DEL MOTOR LIBRE sobre la TRAYECTORIA REAL DE REFERENCIA, con la
 * configuracion de PRODUCCION: el observador de pasos APAGADO, o sea `estrategias` vacia en los 28
 * pasos, y las estrategias llegando por donde llegan de verdad, `estrategiasPercibidas`, que puebla
 * la lectura fusionada de la percepcion (percepcion.ts) y complementa el selector cuando el elemento
 * ya no existe (el boton Enviar, que se lleva por delante su propio compose).
 *
 * ES LA MISMA CORRIDA que fija `receta-web.test.ts` ("corrida real del 30 jul 06:14 UTC"), con sus
 * 28 pasos: el `fillFormVision` VACIO de la posicion 3, los trece clicks de enfoque con los que el
 * agente peleo por enfocar el cuerpo y el `clickAndHold` del paso 21. Alli se fija que CONVIERTE;
 * aqui se fija que, ademas, PUBLICA.
 *
 * Los nombres de las clases son los del DOM y en ESPANOL ("asunto", "cuerpo del mensaje",
 * "destinatarios en para"), que es la diferencia entera con la fuente anterior: las estrategias que
 * el modelo derivaba de su propia descripcion salian en ingles y sobre otro eje ("field", "message
 * body", "compose window") y no coincidian con ninguna entrada del atlas.
 *
 * Cadena EXACTA del handler, sin nada propio de este test:
 *   pasosConEstrategiasPercibidas -> promoverTrayectoria -> plantillaDeLaCorrida.
 */

const DOMINIO = 'mail.google.com';

const DESTINATARIO = 'martin.ledesm91@gmail.com';
const ASUNTO = 'Trayectoria fresca';
const CUERPO = 'Este correo lo envio el sistema';
const OBJETIVO =
  `Enviar un correo electronico a ${DESTINATARIO} con el asunto "${ASUNTO}" y el siguiente cuerpo ` +
  `del mensaje "${CUERPO}". La tarea termina cuando el correo haya sido enviado exitosamente.`;

/** Lo que la PERCEPCION lee del DOM de Gmail: nombres accesibles literales, en espanol. */
const LEIDO_REDACTAR: EstrategiaLocalizacion = { tipo: 'rol', rol: 'button', nombre: 'Redactar' };
const LEIDO_PARA: EstrategiaLocalizacion = {
  tipo: 'atributo',
  atributo: 'aria-label',
  valor: 'Destinatarios en Para',
};
const LEIDO_ASUNTO: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'aria-label', valor: 'Asunto' };
const LEIDO_CUERPO: EstrategiaLocalizacion = {
  tipo: 'atributo',
  atributo: 'aria-label',
  valor: 'Cuerpo del mensaje',
};
/** El boton Enviar: su compose ya se desmonto, asi que esto sale del selector (el complemento). */
const LEIDO_ENVIAR: EstrategiaLocalizacion = { tipo: 'atributo', atributo: 'aria-label', valor: 'Enviar' };

/** El xpath posicional de la sesion, que viaja en cada paso y que la publicacion descarta. */
const xpath = (ruta: string): EstrategiaLocalizacion => ({ tipo: 'xpath', xpath: ruta });

function paso(overrides: Partial<PasoCensurado> = {}): PasoCensurado {
  return {
    idx: 0,
    accion: { tipo: 'act', instruccion: null, metodo: 'click', argumentos: [] },
    selector: null,
    valorCensurado: null,
    // OBSERVADOR APAGADO: en produccion esta lista esta VACIA en los 28 pasos.
    estrategias: [],
    // El gestor de sesiones deja la pagina en la RAIZ del sitio antes de correr el motor
    // (`urlInicial`, tarea-web.ts), asi que la navegacion de entrada de la traza es a '/'.
    url: `https://${DOMINIO}/`,
    exito: true,
    ...overrides,
  };
}

/** Un click de enfoque sobre el cuerpo: sin selector, sin estrategias y sin nada que leer. */
const foco = (idx: number, metodo: string | null = 'click'): PasoCensurado =>
  paso({
    idx,
    accion: { tipo: 'act', instruccion: 'click the message body area', metodo, argumentos: [] },
  });

/** LOS 28 PASOS, tal como el motor libre los deja hoy en produccion. */
function corridaReal(): PasoCensurado[] {
  return [
    paso({ idx: 0, accion: { tipo: 'goto', instruccion: null, metodo: null, argumentos: [] } }),
    paso({ idx: 1, accion: { tipo: 'screenshot', instruccion: null, metodo: null, argumentos: [] } }),
    // POSICION 3: el llenado por vision que no dejo constancia de haber llenado nada.
    paso({
      idx: 2,
      accion: { tipo: 'fillFormVision', instruccion: 'llenar los campos del correo', metodo: null, argumentos: [] },
    }),
    paso({
      idx: 3,
      accion: { tipo: 'act', instruccion: 'click the Compose button', metodo: 'click', argumentos: [] },
      selector: '/html/body/div/div[3]',
      estrategiasPercibidas: [LEIDO_REDACTAR, xpath('/html/body/div/div[3]')],
    }),
    paso({ idx: 4, accion: { tipo: 'think', instruccion: null, metodo: null, argumentos: [] } }),
    paso({
      idx: 5,
      accion: { tipo: 'act', instruccion: 'click the Para input field', metodo: 'click', argumentos: [] },
    }),
    paso({
      idx: 6,
      accion: {
        tipo: 'act',
        instruccion: `type "${DESTINATARIO}" into the Para input field`,
        metodo: 'fill',
        argumentos: [DESTINATARIO],
      },
      selector: '/html/body/div[7]/div[3]/div/form/input[1]',
      valorCensurado: DESTINATARIO,
      estrategiasPercibidas: [LEIDO_PARA, xpath('/html/body/div[7]/div[3]/div/form/input[1]')],
    }),
    paso({
      idx: 7,
      accion: {
        tipo: 'act',
        instruccion: 'press Tab key to confirm the recipient',
        metodo: 'press',
        argumentos: ['Tab'],
      },
      selector: '/html/body/div[7]/div[3]/div/form/input[1]',
      estrategiasPercibidas: [LEIDO_PARA],
    }),
    paso({
      idx: 8,
      accion: { tipo: 'act', instruccion: 'click the Asunto input field', metodo: 'click', argumentos: [] },
    }),
    paso({
      idx: 9,
      accion: {
        tipo: 'act',
        instruccion: `type "${ASUNTO}" into the Asunto input field`,
        metodo: 'fill',
        argumentos: [ASUNTO],
      },
      selector: '/html/body/div[7]/div[3]/div/form/input[2]',
      valorCensurado: ASUNTO,
      estrategiasPercibidas: [LEIDO_ASUNTO, xpath('/html/body/div[7]/div[3]/div/form/input[2]')],
    }),
    paso({
      idx: 10,
      accion: { tipo: 'act', instruccion: 'click the full screen button', metodo: 'click', argumentos: [] },
      selector: '/html/body/div/div[9]',
      estrategiasPercibidas: [xpath('/html/body/div/div[9]')],
    }),
    foco(11), foco(12), foco(13), foco(14, null), foco(15),
    foco(16), foco(17), foco(18), foco(19), foco(20),
    paso({
      idx: 21,
      accion: {
        tipo: 'clickAndHold',
        instruccion: 'click and hold on the message body',
        metodo: null,
        argumentos: [],
      },
    }),
    foco(22), foco(23), foco(24),
    paso({
      idx: 25,
      accion: {
        tipo: 'act',
        instruccion: `type "${CUERPO}" into the message body to finish the email`,
        metodo: 'fill',
        argumentos: [CUERPO],
      },
      selector: '/html/body/div[7]/div[3]/div/form/div[1]',
      valorCensurado: CUERPO,
      estrategiasPercibidas: [LEIDO_CUERPO, xpath('/html/body/div[7]/div[3]/div/form/div[1]')],
    }),
    paso({ idx: 26, accion: { tipo: 'verificacion', instruccion: 'ok', metodo: null, argumentos: [] } }),
    paso({
      idx: 27,
      accion: { tipo: 'act', instruccion: 'click the Send button', metodo: 'click', argumentos: [] },
      selector: '/html/body/div/form/div[2]',
      estrategiasPercibidas: [LEIDO_ENVIAR, xpath('/html/body/div/form/div[2]')],
    }),
  ];
}

/** El material publicable, por la cadena EXACTA del handler. */
function pasosPublicables() {
  const promocion = promoverTrayectoria({
    pasos: pasosConEstrategiasPercibidas(corridaReal()),
    dominio: DOMINIO,
    objetivo: OBJETIVO,
    estado: 'exitosa',
    exigeVerificacion: true,
  });
  if (!promocion.promovida) throw new Error(`la conversion rechazo: ${promocion.motivo}`);
  return promocion.pasos;
}

/** Las clases que cada paso declara, con la MISMA funcion que alimenta el atlas. */
function clasesDeLosPasos(): Array<string | null> {
  return pasosPublicables().map((p) => claseDeElemento(p.accion, p.estrategias));
}

function publicar(clasesCorroboradas: ReadonlySet<string>) {
  return plantillaDeLaCorrida({
    pasos: pasosPublicables(),
    dominio: DOMINIO,
    dominios: [DOMINIO],
    verboBloqueado: 'enviar',
    clasesCorroboradas,
  });
}

// -------------------------------------------------------------------------------------------------

describe('la trayectoria real de referencia, con el observador apagado', () => {
  it('llega a la conversion con las clases del DOM y en espanol', () => {
    expect(corridaReal()).toHaveLength(28);
    // Los 28 pasos llegan sin `estrategias`: sin la fuente de la percepcion no habria nada.
    expect(corridaReal().every((p) => p.estrategias.length === 0)).toBe(true);

    // COBERTURA: de los 7 pasos que la conversion conserva, los 5 que actuan sobre un elemento
    // declaran clase. El que no la tiene es el click de pantalla completa (paso 10): su unica
    // estrategia percibida es el xpath posicional, del que no se puede aprender nada.
    expect(clasesDeLosPasos()).toEqual([
      null, // navegar
      'click|rol:button|redactar',
      'escribir|atributo:aria-label|destinatarios en para',
      null, // teclas
      'escribir|atributo:aria-label|asunto',
      'escribir|atributo:aria-label|cuerpo del mensaje',
      null, // verificar
      'click|atributo:aria-label|enviar',
    ]);
  });

  it('el click de pantalla completa se destila fuera: solo traia el xpath de la sesion', () => {
    // Es el unico paso con elemento que la percepcion no supo nombrar, y no llega a la plantilla.
    const acciones = pasosPublicables().map((p) => p.accion);
    expect(acciones).toEqual([
      'navegar', 'click', 'escribir', 'teclas', 'escribir', 'escribir', 'verificar', 'click',
    ]);
  });

  it('con las clases corroboradas por el atlas, la corrida PUBLICA', () => {
    const corroboradas = new Set(clasesDeLosPasos().filter((clase): clase is string => clase !== null));
    const veredicto = publicar(corroboradas);

    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    // La navegacion inicial a la raiz se descarta; viajan los otros siete.
    expect(veredicto.plantilla.pasos).toHaveLength(7);
    expect(veredicto.plantilla.codigoDeIntencion).toBe('enviar');
    expect(veredicto.plantilla.dominiosClave).toBe(DOMINIO);
    expect(veredicto.plantilla.marcadoresClave).toBe('asunto+cuerpo+destinatario');
  });

  it('lo publicado no lleva ni un valor de la persona, ni un xpath, ni una ruta', () => {
    const corroboradas = new Set(clasesDeLosPasos().filter((clase): clase is string => clase !== null));
    const veredicto = publicar(corroboradas);
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;

    const serializado = JSON.stringify(veredicto.plantilla);
    for (const prohibido of [DESTINATARIO, ASUNTO, CUERPO, 'xpath', 'ruta', 'literal', '/html']) {
      expect(serializado, prohibido).not.toContain(prohibido);
    }
    // Los tres datos declarados viajan como marcadores, jamas como valores.
    expect(veredicto.plantilla.pasos.filter((p) => p.accion === 'escribir').map((p) => p.valor)).toEqual([
      { tipo: 'parametro', parametro: 'destinatario' },
      { tipo: 'parametro', parametro: 'asunto' },
      { tipo: 'parametro', parametro: 'cuerpo' },
    ]);
  });

  it('sin las clases corroboradas el motivo es legible y dice QUE paso la rechazo', () => {
    const veredicto = publicar(new Set());
    expect(veredicto.publicable).toBe(false);
    if (veredicto.publicable) return;
    expect(veredicto.motivo).toBe('clase_no_corroborada');
    // El indice es el del PRIMER paso con elemento, que es el click de Redactar.
    expect(veredicto.idx).toBe(pasosPublicables()[1]?.idx);
  });

  it('si la corrida entra por una ruta que no es la raiz, la plantilla se rechaza', () => {
    // LA OTRA PUERTA QUE HAY QUE MIRAR EN PRODUCCION: `esPublicable` descarta la navegacion inicial
    // SOLO cuando su ruta es '/'. Hoy eso se cumple porque el gestor de sesiones abre el sitio en su
    // raiz, pero una corrida que arranque mas adentro no publica, y este es el motivo con el que se
    // reconoce en `jobs.resultado`.
    const pasos = pasosConEstrategiasPercibidas(corridaReal());
    const primero = pasos[0];
    if (primero === undefined) throw new Error('la corrida de referencia perdio su primer paso');
    pasos[0] = { ...primero, url: `https://${DOMINIO}/mail` };
    const promocion = promoverTrayectoria({
      pasos,
      dominio: DOMINIO,
      objetivo: OBJETIVO,
      estado: 'exitosa',
      exigeVerificacion: true,
    });
    if (!promocion.promovida) throw new Error(promocion.motivo);
    const veredicto = plantillaDeLaCorrida({
      pasos: promocion.pasos,
      dominio: DOMINIO,
      dominios: [DOMINIO],
      verboBloqueado: 'enviar',
      clasesCorroboradas: new Set(clasesDeLosPasos().filter((c): c is string => c !== null)),
    });
    expect(veredicto.publicable).toBe(false);
    if (veredicto.publicable) return;
    expect(veredicto.motivo).toBe('ruta_con_identificador');
  });

  it('una sola clase sin corroborar tumba la plantilla ENTERA, y nombra ese paso', () => {
    // Fail-closed: no se publica el resto sin el paso raro, porque seria otro procedimiento.
    const todas = clasesDeLosPasos().filter((clase): clase is string => clase !== null);
    const veredicto = publicar(new Set(todas.filter((clase) => !clase.endsWith('enviar'))));
    expect(veredicto.publicable).toBe(false);
    if (veredicto.publicable) return;
    expect(veredicto.motivo).toBe('clase_no_corroborada');
    expect(veredicto.idx).toBe(pasosPublicables()[7]?.idx);
  });
});

// -------------------------------------------------------------------------------------------------

/**
 * LA CORRIDA REAL DE LAS 20:51 DEL 30 JUL 2026: correo enviado, verificacion previa superada, efecto
 * confirmado -- y `{"idx":null,"clases":5,"motivo":"sin_procedimiento_repetible","publicada":false}`
 * en el resultado del job. Sus 24 pasos, en la forma con la que la traza los deja en produccion.
 *
 * LO QUE LA DISTINGUE de la corrida de referencia de arriba: el agente peleo con el foco del cuerpo
 * del mensaje con OCHO clicks seguidos, y uno de ellos lo emitio POR COORDENADAS. Un click por
 * coordenadas no trae selector (Stagehand no resuelve ninguno para el) ni instruccion (sus argumentos
 * son `describe` y `coordinates`, no `action`), asi que las dos vias con las que la destilacion
 * reconoce "el mismo campo" -- selector identico y descripcion equivalente -- no lo alcanzaban, y se
 * colaba en el procedimiento como un paso propio. Lo que SI trae es el nombre accesible que la
 * percepcion leyo del elemento sobre el que cayo, y por ahi es por donde se colapsa ahora.
 *
 * El `fillFormVision` de la posicion 3 es el intento de llenado por vision que NO lleno ningun campo:
 * se descarta como metodo no representable y no reclama la cobertura de ningun dato.
 */
describe('la corrida real de las 20:51, con el observador apagado', () => {
  /** Un click de enfoque sobre el cuerpo resuelto por vision: sin selector, con lo leido del DOM. */
  const focoDelCuerpo = (idx: number): PasoCensurado =>
    paso({
      idx,
      accion: { tipo: 'act', instruccion: 'click the message body area', metodo: 'click', argumentos: [] },
      estrategiasPercibidas: [LEIDO_CUERPO],
    });

  /** EL CLICK POR COORDENADAS: sin selector, sin instruccion y con metodo derivado de la tool. */
  const focoPorCoordenadas = (idx: number): PasoCensurado =>
    paso({
      idx,
      accion: { tipo: 'click', instruccion: null, metodo: 'click', argumentos: [] },
      estrategiasPercibidas: [LEIDO_CUERPO],
    });

  function corridaDeLas2051(): PasoCensurado[] {
    return [
      paso({ idx: 0, accion: { tipo: 'goto', instruccion: null, metodo: null, argumentos: [] } }),
      paso({ idx: 1, accion: { tipo: 'screenshot', instruccion: null, metodo: null, argumentos: [] } }),
      // POSICION 3: el llenado por vision, ANTES de que el agente escribiera nada.
      paso({
        idx: 2,
        accion: { tipo: 'fillFormVision', instruccion: 'llenar los campos del correo', metodo: null, argumentos: [] },
      }),
      paso({
        idx: 3,
        accion: { tipo: 'act', instruccion: 'click the Compose button', metodo: 'click', argumentos: [] },
        selector: '/html/body/div/div[3]',
        estrategiasPercibidas: [LEIDO_REDACTAR, xpath('/html/body/div/div[3]')],
      }),
      paso({ idx: 4, accion: { tipo: 'think', instruccion: null, metodo: null, argumentos: [] } }),
      paso({
        idx: 5,
        accion: { tipo: 'act', instruccion: 'click the Para input field', metodo: 'click', argumentos: [] },
        estrategiasPercibidas: [LEIDO_PARA],
      }),
      paso({
        idx: 6,
        accion: {
          tipo: 'act',
          instruccion: `type "${DESTINATARIO}" into the Para input field`,
          metodo: 'fill',
          argumentos: [DESTINATARIO],
        },
        selector: '/html/body/div[7]/div[3]/div/form/input[1]',
        valorCensurado: DESTINATARIO,
        estrategiasPercibidas: [LEIDO_PARA, xpath('/html/body/div[7]/div[3]/div/form/input[1]')],
      }),
      paso({
        idx: 7,
        accion: {
          tipo: 'act',
          instruccion: 'press Tab key to confirm the recipient',
          metodo: 'press',
          argumentos: ['Tab'],
        },
        selector: '/html/body/div[7]/div[3]/div/form/input[1]',
        estrategiasPercibidas: [LEIDO_PARA],
      }),
      paso({
        idx: 8,
        accion: {
          tipo: 'act',
          instruccion: `type "${ASUNTO}" into the Asunto input field`,
          metodo: 'fill',
          argumentos: [ASUNTO],
        },
        selector: '/html/body/div[7]/div[3]/div/form/input[2]',
        valorCensurado: ASUNTO,
        estrategiasPercibidas: [LEIDO_ASUNTO, xpath('/html/body/div[7]/div[3]/div/form/input[2]')],
      }),
      // PASOS 9 A 17: los ocho clicks de enfoque sobre el cuerpo, con el de coordenadas en medio.
      focoDelCuerpo(9),
      focoDelCuerpo(10),
      focoDelCuerpo(11),
      focoPorCoordenadas(12),
      focoDelCuerpo(13),
      focoDelCuerpo(14),
      focoDelCuerpo(15),
      focoDelCuerpo(16),
      paso({ idx: 17, accion: { tipo: 'screenshot', instruccion: null, metodo: null, argumentos: [] } }),
      paso({
        idx: 18,
        accion: {
          tipo: 'act',
          instruccion: `type "${CUERPO}" into the message body to finish the email`,
          metodo: 'fill',
          argumentos: [CUERPO],
        },
        selector: '/html/body/div[7]/div[3]/div/form/div[1]',
        valorCensurado: CUERPO,
        estrategiasPercibidas: [LEIDO_CUERPO, xpath('/html/body/div[7]/div[3]/div/form/div[1]')],
      }),
      paso({ idx: 19, accion: { tipo: 'think', instruccion: null, metodo: null, argumentos: [] } }),
      paso({ idx: 20, accion: { tipo: 'extract', instruccion: null, metodo: null, argumentos: [] } }),
      paso({ idx: 21, accion: { tipo: 'verificacion', instruccion: 'ok', metodo: null, argumentos: [] } }),
      paso({
        idx: 22,
        accion: { tipo: 'act', instruccion: 'click the Send button', metodo: 'click', argumentos: [] },
        selector: '/html/body/div/form/div[2]',
        estrategiasPercibidas: [LEIDO_ENVIAR, xpath('/html/body/div/form/div[2]')],
      }),
      paso({ idx: 23, accion: { tipo: 'done', instruccion: null, metodo: null, argumentos: [] } }),
    ];
  }

  function procedimiento() {
    return promoverTrayectoria({
      pasos: pasosConEstrategiasPercibidas(corridaDeLas2051()),
      dominio: DOMINIO,
      objetivo: OBJETIVO,
      estado: 'exitosa',
      exigeVerificacion: true,
    });
  }

  /**
   * LAS CINCO CLASES QUE EL ATLAS TENIA CORROBORADAS ese dia, tal como salieron del veredicto:
   * Redactar, Asunto, Cuerpo del mensaje y Destinatarios en Para en sus DOS acciones. El boton
   * Enviar NO esta, y eso es un problema DISTINTO (ver el ultimo test de este bloque).
   */
  const CINCO_CLASES = new Set([
    'click|rol:button|redactar',
    'click|atributo:aria-label|destinatarios en para',
    'escribir|atributo:aria-label|destinatarios en para',
    'escribir|atributo:aria-label|asunto',
    'escribir|atributo:aria-label|cuerpo del mensaje',
  ]);

  function publicarCon(clases: ReadonlySet<string>) {
    const material = procedimiento();
    if (!material.promovida) throw new Error(`la conversion rechazo: ${material.motivo}`);
    return plantillaDeLaCorrida({
      pasos: material.pasos,
      dominio: DOMINIO,
      dominios: [DOMINIO],
      verboBloqueado: 'enviar',
      clasesCorroboradas: clases,
    });
  }

  it('la traza son 24 pasos y ninguno llega con estrategias propias', () => {
    expect(corridaDeLas2051()).toHaveLength(24);
    expect(corridaDeLas2051().every((p) => p.estrategias.length === 0)).toBe(true);
  });

  it('ARMA EL PROCEDIMIENTO: los ocho clicks de enfoque se colapsan, el de coordenadas incluido', () => {
    const material = procedimiento();
    expect(material.promovida).toBe(true);
    if (!material.promovida) return;
    // Ni un click sobrante: el unico que queda entre la escritura del asunto y la del cuerpo seria
    // el de coordenadas, que es el que la destilacion no alcanzaba a reconocer.
    expect(material.pasos.map((p) => p.accion)).toEqual([
      'navegar',
      'click',
      'escribir',
      'teclas',
      'escribir',
      'escribir',
      'verificar',
      'click',
    ]);
    // El llenado por vision se descarto sin abortar y sin reclamar cobertura de ningun dato.
    expect(material.metodosDescartados).toEqual(['fillFormVision']);
  });

  it('con las seis clases corroboradas, la corrida PUBLICA', () => {
    const veredicto = publicarCon(new Set([...CINCO_CLASES, 'click|atributo:aria-label|enviar']));
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    expect(veredicto.plantilla.pasos).toHaveLength(7);
    expect(veredicto.plantilla.codigoDeIntencion).toBe('enviar');
    expect(veredicto.plantilla.marcadoresClave).toBe('asunto+cuerpo+destinatario');
    // Ni un valor de la persona, ni un xpath, ni una ruta.
    const serializado = JSON.stringify(veredicto.plantilla);
    for (const prohibido of [DESTINATARIO, ASUNTO, CUERPO, 'xpath', 'ruta', '/html']) {
      expect(serializado, prohibido).not.toContain(prohibido);
    }
  });

  it('con las CINCO clases reales el rechazo es el del boton Enviar, y es OTRO problema', () => {
    // PROBLEMA DISTINTO Y CONOCIDO: `clasesParaPublicar` exige DOS origenes independientes, y la
    // clase del boton Enviar no los tiene todavia. No es un fallo de la conversion -- el
    // procedimiento se arma entero -- y se fija aqui como el comportamiento esperado: el motivo es
    // de la puerta de publicacion y NOMBRA el paso, que es justo lo que el rechazo anterior
    // (`sin_procedimiento_repetible` con idx null) no podia decir.
    const veredicto = publicarCon(CINCO_CLASES);
    expect(veredicto.publicable).toBe(false);
    if (veredicto.publicable) return;
    expect(veredicto.motivo).toBe('clase_no_corroborada');
    const material = procedimiento();
    if (!material.promovida) throw new Error(material.motivo);
    expect(veredicto.idx).toBe(material.pasos[7]?.idx);
  });
});

// -------------------------------------------------------------------------------------------------

/**
 * LA CORRIDA REAL DE LAS 01:02 DEL 31 JUL 2026: 24 pasos, correo enviado, verificacion previa
 * superada y efecto confirmado -- y en el resultado del job
 * `{"idx":12,"clases":5,"motivo":"sin_procedimiento_repetible","publicada":false,"submotivo":"paso_fallido"}`.
 *
 * EL IDX 12 ES EL RECHAZO DE LA GUARDIA que introdujo el PR 279: el agente propuso clickear el
 * control "Pantalla completa" del compose, la guardia no lo dejo salir al navegador y la corrida
 * siguio (los pasos posteriores conservan el mismo prefijo del DOM, que es la prueba de que el
 * compose no se destruyo). La guardia hizo exactamente lo que debia; lo que estaba mal era leer su
 * rechazo como un paso FALLIDO del procedimiento. Una accion que nunca ocurrio sobre la pagina no
 * aporta nada que repetir y no puede impedir armar el procedimiento (ver el bloque de pasos
 * sinteticos fallidos en receta-web.test.ts, donde se fija la categoria entera).
 *
 * LO QUE LA DISTINGUE de las dos corridas de arriba: el rechazo de la guardia en el idx 12 y DOS
 * `fillFormVision` (el agente reintento el llenado por vision despues de abrir el compose), ninguno
 * de los cuales dejo constancia de haber llenado un campo.
 */
describe('la corrida real de las 01:02 del 31 jul (rechazo de la guardia en el idx 12)', () => {
  /** Un click de enfoque sobre el cuerpo, con lo que la percepcion leyo del elemento. */
  const focoDelCuerpo = (idx: number): PasoCensurado =>
    paso({
      idx,
      accion: { tipo: 'act', instruccion: 'click the message body area', metodo: 'click', argumentos: [] },
      estrategiasPercibidas: [LEIDO_CUERPO],
    });

  /**
   * EL PASO 12: el rechazo de la guardia, tal como construirPasoDeBloqueo lo deja en la traza
   * (verificacion.ts). Se construye con la funcion REAL para que el fixture no pueda desincronizarse
   * del productor.
   */
  const rechazoDeLaGuardia = (idx: number): PasoCensurado => ({
    ...construirPasoDeBloqueo(
      'guardia: la accion NO se ejecuto (control de ventana fuera del alcance de la tarea: pantalla completa): click button Pantalla completa',
    ),
    idx,
    url: `https://${DOMINIO}/`,
  });

  function corridaDeLas0102(): PasoCensurado[] {
    return [
      paso({ idx: 0, accion: { tipo: 'goto', instruccion: null, metodo: null, argumentos: [] } }),
      paso({ idx: 1, accion: { tipo: 'screenshot', instruccion: null, metodo: null, argumentos: [] } }),
      // PRIMER llenado por vision, antes de abrir el compose: no lleno nada.
      paso({
        idx: 2,
        accion: { tipo: 'fillFormVision', instruccion: 'llenar los campos del correo', metodo: null, argumentos: [] },
      }),
      paso({
        idx: 3,
        accion: { tipo: 'act', instruccion: 'click the Compose button', metodo: 'click', argumentos: [] },
        selector: '/html/body/div/div[3]',
        estrategiasPercibidas: [LEIDO_REDACTAR, xpath('/html/body/div/div[3]')],
      }),
      paso({ idx: 4, accion: { tipo: 'think', instruccion: null, metodo: null, argumentos: [] } }),
      paso({
        idx: 5,
        accion: { tipo: 'act', instruccion: 'click the Para input field', metodo: 'click', argumentos: [] },
        estrategiasPercibidas: [LEIDO_PARA],
      }),
      paso({
        idx: 6,
        accion: {
          tipo: 'act',
          instruccion: `type "${DESTINATARIO}" into the Para input field`,
          metodo: 'fill',
          argumentos: [DESTINATARIO],
        },
        selector: '/html/body/div[7]/div[3]/div/form/input[1]',
        valorCensurado: DESTINATARIO,
        estrategiasPercibidas: [LEIDO_PARA, xpath('/html/body/div[7]/div[3]/div/form/input[1]')],
      }),
      paso({
        idx: 7,
        accion: {
          tipo: 'act',
          instruccion: 'press Tab key to confirm the recipient',
          metodo: 'press',
          argumentos: ['Tab'],
        },
        selector: '/html/body/div[7]/div[3]/div/form/input[1]',
        estrategiasPercibidas: [LEIDO_PARA],
      }),
      paso({
        idx: 8,
        accion: {
          tipo: 'act',
          instruccion: `type "${ASUNTO}" into the Asunto input field`,
          metodo: 'fill',
          argumentos: [ASUNTO],
        },
        selector: '/html/body/div[7]/div[3]/div/form/input[2]',
        valorCensurado: ASUNTO,
        estrategiasPercibidas: [LEIDO_ASUNTO, xpath('/html/body/div[7]/div[3]/div/form/input[2]')],
      }),
      paso({ idx: 9, accion: { tipo: 'screenshot', instruccion: null, metodo: null, argumentos: [] } }),
      // SEGUNDO llenado por vision, ya con el compose abierto: tampoco dejo constancia de nada.
      paso({
        idx: 10,
        accion: { tipo: 'fillFormVision', instruccion: 'llenar el cuerpo del mensaje', metodo: null, argumentos: [] },
      }),
      focoDelCuerpo(11),
      // IDX 12: el rechazo de la guardia. Los pasos 13 en adelante conservan el MISMO prefijo del DOM
      // que los de antes (/html/body/div[7]/div[3]/div/form), que es la prueba de produccion de que
      // el compose no se destruyo porque la accion no se ejecuto.
      rechazoDeLaGuardia(12),
      focoDelCuerpo(13),
      focoDelCuerpo(14),
      paso({
        idx: 15,
        accion: {
          tipo: 'act',
          instruccion: `type "${CUERPO}" into the message body to finish the email`,
          metodo: 'fill',
          argumentos: [CUERPO],
        },
        selector: '/html/body/div[7]/div[3]/div/form/div[1]',
        valorCensurado: CUERPO,
        estrategiasPercibidas: [LEIDO_CUERPO, xpath('/html/body/div[7]/div[3]/div/form/div[1]')],
      }),
      paso({ idx: 16, accion: { tipo: 'screenshot', instruccion: null, metodo: null, argumentos: [] } }),
      paso({ idx: 17, accion: { tipo: 'think', instruccion: null, metodo: null, argumentos: [] } }),
      paso({ idx: 18, accion: { tipo: 'extract', instruccion: null, metodo: null, argumentos: [] } }),
      paso({ idx: 19, accion: { tipo: 'screenshot', instruccion: null, metodo: null, argumentos: [] } }),
      paso({ idx: 20, accion: { tipo: 'think', instruccion: null, metodo: null, argumentos: [] } }),
      paso({ idx: 21, accion: { tipo: 'verificacion', instruccion: 'ok', metodo: null, argumentos: [] } }),
      paso({
        idx: 22,
        accion: { tipo: 'act', instruccion: 'click the Send button', metodo: 'click', argumentos: [] },
        selector: '/html/body/div/form/div[2]',
        estrategiasPercibidas: [LEIDO_ENVIAR, xpath('/html/body/div/form/div[2]')],
      }),
      paso({ idx: 23, accion: { tipo: 'done', instruccion: null, metodo: null, argumentos: [] } }),
    ];
  }

  function procedimiento() {
    return promoverTrayectoria({
      pasos: pasosConEstrategiasPercibidas(corridaDeLas0102()),
      dominio: DOMINIO,
      objetivo: OBJETIVO,
      estado: 'exitosa',
      exigeVerificacion: true,
    });
  }

  /** Las MISMAS cinco clases que el atlas tenia corroboradas: el boton Enviar sigue sin estar. */
  const CINCO_CLASES = new Set([
    'click|rol:button|redactar',
    'click|atributo:aria-label|destinatarios en para',
    'escribir|atributo:aria-label|destinatarios en para',
    'escribir|atributo:aria-label|asunto',
    'escribir|atributo:aria-label|cuerpo del mensaje',
  ]);

  function publicarCon(clases: ReadonlySet<string>) {
    const material = procedimiento();
    if (!material.promovida) throw new Error(`la conversion rechazo: ${material.motivo}`);
    return plantillaDeLaCorrida({
      pasos: material.pasos,
      dominio: DOMINIO,
      dominios: [DOMINIO],
      verboBloqueado: 'enviar',
      clasesCorroboradas: clases,
    });
  }

  it('la traza son 24 pasos, con el rechazo de la guardia en el idx 12 y dos fillFormVision', () => {
    const pasos = corridaDeLas0102();
    expect(pasos).toHaveLength(24);
    expect(pasos.every((p) => p.estrategias.length === 0)).toBe(true);
    // El unico paso de la corrida con exito false, y es el que tumbaba la publicacion.
    const fallidos = pasos.filter((p) => !p.exito);
    expect(fallidos.map((p) => p.idx)).toEqual([12]);
    expect(fallidos[0]?.accion.instruccion).toContain('la accion NO se ejecuto');
    expect(fallidos[0]?.accion.instruccion).toContain('pantalla completa');
    expect(pasos.filter((p) => p.accion.tipo === 'fillFormVision')).toHaveLength(2);
    expect(pasos[22]?.accion.instruccion).toBe('click the Send button');
  });

  it('ARMA EL PROCEDIMIENTO: el rechazo de la guardia se descarta y no aborta nada', () => {
    const material = procedimiento();
    expect(material.promovida).toBe(true);
    if (!material.promovida) return;
    // Ni un paso 'verificar' de mas por el rechazo: el unico que queda es la verificacion previa que
    // SI comparo y dejo pasar el envio (idx 21).
    expect(material.pasos.map((p) => p.accion)).toEqual([
      'navegar',
      'click',
      'escribir',
      'teclas',
      'escribir',
      'escribir',
      'verificar',
      'click',
    ]);
    // Los DOS llenados por vision se descartan sin abortar y sin reclamar cobertura de ningun dato.
    expect(material.metodosDescartados).toEqual(['fillFormVision', 'fillFormVision']);
    // Los tres datos declarados viajan como marcadores, jamas como valores.
    expect(material.pasos.filter((p) => p.accion === 'escribir').map((p) => p.valor)).toEqual([
      { tipo: 'parametro', parametro: 'destinatario' },
      { tipo: 'parametro', parametro: 'asunto' },
      { tipo: 'parametro', parametro: 'cuerpo' },
    ]);
  });

  it('las clases que declara son las mismas cinco del atlas mas la del boton Enviar', () => {
    const material = procedimiento();
    if (!material.promovida) throw new Error(material.motivo);
    expect(material.pasos.map((p) => claseDeElemento(p.accion, p.estrategias))).toEqual([
      null, // navegar
      'click|rol:button|redactar',
      'escribir|atributo:aria-label|destinatarios en para',
      null, // teclas
      'escribir|atributo:aria-label|asunto',
      'escribir|atributo:aria-label|cuerpo del mensaje',
      null, // verificar
      'click|atributo:aria-label|enviar',
    ]);
  });

  it('con las seis clases corroboradas, la corrida PUBLICA', () => {
    const veredicto = publicarCon(new Set([...CINCO_CLASES, 'click|atributo:aria-label|enviar']));
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    expect(veredicto.plantilla.pasos).toHaveLength(7);
    expect(veredicto.plantilla.codigoDeIntencion).toBe('enviar');
    expect(veredicto.plantilla.dominiosClave).toBe(DOMINIO);
    expect(veredicto.plantilla.marcadoresClave).toBe('asunto+cuerpo+destinatario');
    const serializado = JSON.stringify(veredicto.plantilla);
    for (const prohibido of [DESTINATARIO, ASUNTO, CUERPO, 'xpath', 'ruta', '/html', 'Pantalla completa']) {
      expect(serializado, prohibido).not.toContain(prohibido);
    }
  });

  it('con las CINCO clases reales el unico rechazo que queda es el del boton Enviar', () => {
    // EL PROBLEMA CONOCIDO Y DISTINTO que queda en pie despues de este arreglo, fijado aqui como el
    // comportamiento esperado: `clasesParaPublicar` exige DOS origenes independientes y la clase del
    // boton Enviar no los tiene todavia. Ya no es un fallo de la conversion -- el procedimiento se
    // arma entero -- y el motivo es el de la puerta de publicacion y NOMBRA el paso, en lugar del
    // `sin_procedimiento_repetible` / `paso_fallido` con el idx 12 que devolvia produccion.
    const veredicto = publicarCon(CINCO_CLASES);
    expect(veredicto.publicable).toBe(false);
    if (veredicto.publicable) return;
    expect(veredicto.motivo).toBe('clase_no_corroborada');
    const material = procedimiento();
    if (!material.promovida) throw new Error(material.motivo);
    expect(veredicto.idx).toBe(material.pasos[7]?.idx);
  });

  it('un paso del MOTOR que SI fallo en la pagina sigue tumbando la publicacion de esta corrida', () => {
    // El contrapunto sobre la MISMA traza real: si el click de Enviar hubiera llegado al navegador y
    // fallado, la plantilla no se publica. Es la mitad de la regla que no se afloja.
    const pasos = pasosConEstrategiasPercibidas(corridaDeLas0102());
    const envio = pasos[22];
    if (envio === undefined) throw new Error('la corrida de referencia perdio el click de Enviar');
    pasos[22] = { ...envio, exito: false };
    const material = promoverTrayectoria({
      pasos,
      dominio: DOMINIO,
      objetivo: OBJETIVO,
      estado: 'exitosa',
      exigeVerificacion: true,
    });
    expect(material.promovida).toBe(false);
    if (material.promovida) return;
    expect(material.regla).toBe('paso_fallido');
    expect(material.paso).toBe(22);
  });
});

// -------------------------------------------------------------------------------------------------

/**
 * LA CORRIDA REAL DE LAS 03:27 DEL 31 JUL 2026: 17 pasos, correo enviado, verificacion previa
 * superada y efecto confirmado -- y en el resultado del job
 * `{"idx":14,"clases":5,"motivo":"sin_procedimiento_repetible","publicada":false,"submotivo":"click_sin_localizacion_sin_cobertura"}`.
 *
 * QUE TRAE DE NUEVO frente a la corrida de las 01:02: los pasos SINTETICOS que quedan en la traza con
 * exito TRUE. El de la BARRERA DE IDENTIDAD (idx 14) va JUSTO ANTES del click de Enviar (idx 15) --
 * la barrera se interpone en el ultimo punto por el que la accion irreversible sale al navegador --
 * y se registra sin estrategias y sin metodo. La barrera no acciona nada: LEE el DOM y emite un
 * veredicto. Aun asi, la conversion lo clasificaba por su FORMA junto con los gestos del motor, que
 * es la misma clase de error que el rechazo de la guardia del PR 281: un veredicto no es un paso del
 * procedimiento y no puede impedir armar la plantilla (ver el bloque de pasos sinteticos en
 * receta-web.test.ts, donde se fija la categoria entera con todos sus productores).
 *
 * LAS CLASES DEL ATLAS son las de esta corrida: la del boton de envio ya entro como
 * 'click|rol:button|enviar (ctrl-enter)' -- rol mas nombre accesible COMPLETO, sin marcas invisibles
 * de direccion -- que es lo que dejo el PR 282.
 */
describe('la corrida real de las 03:27 del 31 jul (paso sintetico de la barrera en el idx 14)', () => {
  /** Lo que la percepcion lee del boton de envio: rol y nombre accesible COMPLETO (PR 282). */
  const LEIDO_ENVIO: EstrategiaLocalizacion = {
    tipo: 'rol',
    rol: 'button',
    nombre: 'Enviar (Ctrl-Enter)',
  };

  /**
   * EL PASO 14: el veredicto de la barrera, con la forma EXACTA de `construirPasoDeIdentidad`
   * (tarea-web.ts) y sellado como sintetico por el canal que lo intercala en la traza
   * (`intercalarVerificaciones`). La etiqueta y el `exito` salen de `resumenDeIdentidad`, que es la
   * fuente compartida por el camino de recetas y el del motor libre, para que el fixture no pueda
   * desincronizarse de lo que produce el sistema.
   */
  const barreraDeIdentidad = (idx: number): PasoCensurado => {
    const { etiqueta, exito } = resumenDeIdentidad(
      { tipo: 'bloquear', motivo: 'clase_no_corroborada' },
      'observacion',
    );
    return paso({
      idx,
      sintetico: true,
      accion: {
        tipo: etiqueta,
        instruccion: 'barrera de identidad sobre la accion del motor: click the Enviar button',
        metodo: null,
        argumentos: ['clase_no_corroborada'],
      },
      selector: null,
      url: null,
      exito,
    });
  };

  /** El paso 13: la verificacion previa que SI comparo y dejo pasar el envio. */
  const verificacionSuperada = (idx: number): PasoCensurado =>
    paso({
      idx,
      sintetico: true,
      accion: {
        tipo: 'verificacion',
        instruccion: 'verificacion previa: los datos coinciden con lo pedido',
        metodo: null,
        argumentos: [],
      },
      url: null,
    });

  /** El click de Enviar del idx 15, con lo que la percepcion leyo del control que consumo la accion. */
  const clickDeEnvio = (estrategiasPercibidas: EstrategiaLocalizacion[]): PasoCensurado =>
    paso({
      idx: 15,
      accion: { tipo: 'act', instruccion: 'click the Enviar button', metodo: 'click', argumentos: [] },
      selector: '/html/body/div[7]/div[3]/div/form/div[2]',
      estrategiasPercibidas,
    });

  function corridaDeLas0327(envio = clickDeEnvio([LEIDO_ENVIO])): PasoCensurado[] {
    return [
      paso({ idx: 0, accion: { tipo: 'goto', instruccion: null, metodo: null, argumentos: [] } }),
      paso({ idx: 1, accion: { tipo: 'screenshot', instruccion: null, metodo: null, argumentos: [] } }),
      paso({
        idx: 2,
        accion: { tipo: 'act', instruccion: 'click the Compose button', metodo: 'click', argumentos: [] },
        selector: '/html/body/div/div[3]',
        estrategiasPercibidas: [LEIDO_REDACTAR, xpath('/html/body/div/div[3]')],
      }),
      paso({ idx: 3, accion: { tipo: 'think', instruccion: null, metodo: null, argumentos: [] } }),
      paso({
        idx: 4,
        accion: { tipo: 'act', instruccion: 'click the Para input field', metodo: 'click', argumentos: [] },
        estrategiasPercibidas: [LEIDO_PARA],
      }),
      paso({
        idx: 5,
        accion: {
          tipo: 'act',
          instruccion: `type "${DESTINATARIO}" into the Para input field`,
          metodo: 'fill',
          argumentos: [DESTINATARIO],
        },
        selector: '/html/body/div[7]/div[3]/div/form/input[1]',
        valorCensurado: DESTINATARIO,
        estrategiasPercibidas: [LEIDO_PARA, xpath('/html/body/div[7]/div[3]/div/form/input[1]')],
      }),
      paso({
        idx: 6,
        accion: {
          tipo: 'act',
          instruccion: 'press Tab key to confirm the recipient',
          metodo: 'press',
          argumentos: ['Tab'],
        },
        selector: '/html/body/div[7]/div[3]/div/form/input[1]',
        estrategiasPercibidas: [LEIDO_PARA],
      }),
      paso({
        idx: 7,
        accion: {
          tipo: 'act',
          instruccion: `type "${ASUNTO}" into the Asunto input field`,
          metodo: 'fill',
          argumentos: [ASUNTO],
        },
        selector: '/html/body/div[7]/div[3]/div/form/input[2]',
        valorCensurado: ASUNTO,
        estrategiasPercibidas: [LEIDO_ASUNTO, xpath('/html/body/div[7]/div[3]/div/form/input[2]')],
      }),
      paso({ idx: 8, accion: { tipo: 'screenshot', instruccion: null, metodo: null, argumentos: [] } }),
      paso({
        idx: 9,
        accion: { tipo: 'act', instruccion: 'click the message body area', metodo: 'click', argumentos: [] },
        estrategiasPercibidas: [LEIDO_CUERPO],
      }),
      paso({
        idx: 10,
        accion: {
          tipo: 'act',
          instruccion: `type "${CUERPO}" into the message body to finish the email`,
          metodo: 'fill',
          argumentos: [CUERPO],
        },
        selector: '/html/body/div[7]/div[3]/div/form/div[1]',
        valorCensurado: CUERPO,
        estrategiasPercibidas: [LEIDO_CUERPO, xpath('/html/body/div[7]/div[3]/div/form/div[1]')],
      }),
      paso({ idx: 11, accion: { tipo: 'screenshot', instruccion: null, metodo: null, argumentos: [] } }),
      paso({ idx: 12, accion: { tipo: 'think', instruccion: null, metodo: null, argumentos: [] } }),
      // Los DOS pasos del SISTEMA, en el orden en que el canal los intercala: primero la verificacion
      // que comparo, despues el veredicto de la barrera, y detras el click que consumo el envio.
      verificacionSuperada(13),
      barreraDeIdentidad(14),
      envio,
      paso({ idx: 16, accion: { tipo: 'done', instruccion: null, metodo: null, argumentos: [] } }),
    ];
  }

  function procedimiento(pasos = corridaDeLas0327()) {
    return promoverTrayectoria({
      pasos: pasosConEstrategiasPercibidas(pasos),
      dominio: DOMINIO,
      objetivo: OBJETIVO,
      estado: 'exitosa',
      exigeVerificacion: true,
    });
  }

  /** Las cinco clases que el atlas tenia corroboradas ANTES de que entrara la del boton de envio. */
  const CINCO_CLASES = new Set([
    'click|rol:button|redactar',
    'click|atributo:aria-label|destinatarios en para',
    'escribir|atributo:aria-label|destinatarios en para',
    'escribir|atributo:aria-label|asunto',
    'escribir|atributo:aria-label|cuerpo del mensaje',
  ]);

  /** La sexta, la que el PR 282 dejo en el atlas: rol mas nombre accesible completo. */
  const CLASE_DEL_ENVIO = 'click|rol:button|enviar (ctrl-enter)';

  function publicarCon(clases: ReadonlySet<string>) {
    const material = procedimiento();
    if (!material.promovida) throw new Error(`la conversion rechazo: ${material.motivo}`);
    return plantillaDeLaCorrida({
      pasos: material.pasos,
      dominio: DOMINIO,
      dominios: [DOMINIO],
      verboBloqueado: 'enviar',
      clasesCorroboradas: clases,
    });
  }

  it('la traza son 17 pasos, con la barrera en el idx 14 y el click de Enviar en el 15', () => {
    const pasos = corridaDeLas0327();
    expect(pasos).toHaveLength(17);
    expect(pasos.every((p) => p.estrategias.length === 0)).toBe(true);
    // Ningun paso de la corrida viene con exito false: el bloqueo del PR 281 ya no aplica aqui, y por
    // eso este caso quedaba fuera de aquel arreglo.
    expect(pasos.filter((p) => !p.exito)).toEqual([]);
    expect(pasos[14]?.accion.tipo).toBe('identidad:habria_bloqueado');
    expect(pasos[14]?.accion.instruccion).toContain('barrera de identidad sobre la accion del motor');
    expect(pasos[14]?.estrategias).toEqual([]);
    expect(pasos[15]?.accion.instruccion).toBe('click the Enviar button');
    // Los DOS pasos del sistema llegan sellados; los quince del motor, no.
    expect(pasos.filter((p) => p.sintetico === true).map((p) => p.idx)).toEqual([13, 14]);
  });

  it('ARMA EL PROCEDIMIENTO: el veredicto de la barrera se descarta y no aborta nada', () => {
    const material = procedimiento();
    expect(material.promovida).toBe(true);
    if (!material.promovida) return;
    expect(material.pasos.map((p) => p.accion)).toEqual([
      'navegar',
      'click',
      'escribir',
      'teclas',
      'escribir',
      'escribir',
      'verificar',
      'click',
    ]);
    // El veredicto no deja rastro de metodo descartado: nunca fue un metodo, ni un gesto, ni un paso.
    expect(material.metodosDescartados).toBeUndefined();
    // Los tres datos declarados viajan como marcadores, jamas como valores.
    expect(material.pasos.filter((p) => p.accion === 'escribir').map((p) => p.valor)).toEqual([
      { tipo: 'parametro', parametro: 'destinatario' },
      { tipo: 'parametro', parametro: 'asunto' },
      { tipo: 'parametro', parametro: 'cuerpo' },
    ]);
  });

  it('las clases que declara incluyen la del boton de envio que el atlas ya tiene', () => {
    const material = procedimiento();
    if (!material.promovida) throw new Error(material.motivo);
    expect(material.pasos.map((p) => claseDeElemento(p.accion, p.estrategias))).toEqual([
      null, // navegar
      'click|rol:button|redactar',
      'escribir|atributo:aria-label|destinatarios en para',
      null, // teclas
      'escribir|atributo:aria-label|asunto',
      'escribir|atributo:aria-label|cuerpo del mensaje',
      null, // verificar
      CLASE_DEL_ENVIO,
    ]);
  });

  it('con las seis clases corroboradas, INCLUIDA la del boton de envio, la corrida PUBLICA', () => {
    const veredicto = publicarCon(new Set([...CINCO_CLASES, CLASE_DEL_ENVIO]));
    expect(veredicto.publicable).toBe(true);
    if (!veredicto.publicable) return;
    expect(veredicto.plantilla.pasos).toHaveLength(7);
    expect(veredicto.plantilla.codigoDeIntencion).toBe('enviar');
    expect(veredicto.plantilla.dominiosClave).toBe(DOMINIO);
    expect(veredicto.plantilla.marcadoresClave).toBe('asunto+cuerpo+destinatario');
    const serializado = JSON.stringify(veredicto.plantilla);
    for (const prohibido of [DESTINATARIO, ASUNTO, CUERPO, 'xpath', 'ruta', '/html', 'identidad']) {
      expect(serializado, prohibido).not.toContain(prohibido);
    }
  });

  it('sin la clase del boton de envio el rechazo es el de la puerta de publicacion, no el de la conversion', () => {
    const veredicto = publicarCon(CINCO_CLASES);
    expect(veredicto.publicable).toBe(false);
    if (veredicto.publicable) return;
    expect(veredicto.motivo).toBe('clase_no_corroborada');
  });

  it('el mismo veredicto SIN el sello, como vuelve de la base, tambien se descarta', () => {
    // pasos_trayectoria no persiste la marca (V030 no tiene columna), asi que el job de guardar como
    // tarea aprendida reconstruye estos pasos sin ella. La cola por tipo de esPasoSintetico los cubre.
    const pasos = corridaDeLas0327().map((p) => {
      if (p.sintetico !== true) return p;
      const sinSello: PasoCensurado = { ...p };
      delete sinSello.sintetico;
      return sinSello;
    });
    expect(pasos.some((p) => p.sintetico === true)).toBe(false);
    const material = procedimiento(pasos);
    expect(material.promovida).toBe(true);
    if (!material.promovida) return;
    expect(material.pasos.map((p) => p.accion)).toEqual([
      'navegar',
      'click',
      'escribir',
      'teclas',
      'escribir',
      'escribir',
      'verificar',
      'click',
    ]);
  });

  it('el click de Enviar que SI llego al navegador y fallo sigue tumbando la publicacion', () => {
    // La mitad de la regla que no se afloja: la accion irreversible la ejecuto el navegador, asi que
    // un fallo suyo es un fallo real del procedimiento.
    const pasos = corridaDeLas0327({ ...clickDeEnvio([LEIDO_ENVIO]), exito: false });
    const material = procedimiento(pasos);
    expect(material.promovida).toBe(false);
    if (material.promovida) return;
    expect(material.regla).toBe('paso_fallido');
    expect(material.paso).toBe(15);
  });

  it('EL OTRO RECHAZO, que este arreglo no toca: el click de Enviar SIN localizacion', () => {
    // Con el control ya desmontado y sin nada que derivar del selector, el click de Enviar queda sin
    // una sola estrategia. Ese paso SI llego al navegador, asi que la conversion lo sigue rechazando
    // con 'click_sin_localizacion_sin_cobertura' y NOMBRANDO SU PROPIO indice (15), no el 14 del
    // veredicto de la barrera. Queda fijado aqui para que los dos rechazos no se vuelvan a confundir:
    // el de la barrera es el que este PR cierra, este otro es un problema de localizacion del control
    // final y se arregla dandole al paso su localizador, no descartandolo.
    const material = procedimiento(corridaDeLas0327(clickDeEnvio([])));
    expect(material.promovida).toBe(false);
    if (material.promovida) return;
    expect(material.regla).toBe('click_sin_localizacion_sin_cobertura');
    expect(material.paso).toBe(15);
  });
});
