import { describe, it, expect } from 'vitest';
import type { EstrategiaLocalizacion } from '@ledesma-platform/shared';
import { claseDeElemento, pasosConEstrategiasPercibidas } from '../src/atlas-sitios.js';
import { plantillaDeLaCorrida } from '../src/plantillas-compartidas.js';
import { promoverTrayectoria } from '../src/receta-web.js';
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
