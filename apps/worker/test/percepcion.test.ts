import { describe, it, expect } from 'vitest';
import {
  campoDondeAterrizo,
  coincideConObjetivoDeclarado,
  crearControlDePercepcion,
  interpretarPaso,
  lineasDeAterrizaje,
  MAX_LINEAS_POR_TURNO,
  mismaHuella,
  parsearPercepcion,
  PREFIJO_PERCEPCION,
  type PercepcionDePagina,
} from '../src/percepcion.js';
import { construirOpcionesDeEjecucion } from '../src/stagehand.js';
import type { MensajeDeModelo } from '../src/costo-modelo.js';

/**
 * PERCEPCION DE EFECTO Y DE CAMPOS (FIX A y B): los tres escenarios OBSERVADOS en las grabaciones
 * de Browserbase del 27 jul 2026, reproducidos con fakes (cero navegador, cero modelo):
 *  1. click en Redactar que NO abre el compose -> se reporta "SIN efecto visible", no exito.
 *  2. TYPE que aterriza en la barra de busqueda de Gmail -> se reporta el aterrizaje y la
 *     discrepancia con el campo declarado (Para).
 *  3. chip confirmado en el campo Para -> se reporta como valor presente (chip confirmado), no como
 *     campo vacio.
 */

/** Percepcion de una bandeja de Gmail (sin compose): la barra de busqueda es el unico campo. */
function bandeja(extra?: Partial<PercepcionDePagina>): PercepcionDePagina {
  return {
    url: 'https://mail.google.com/mail/u/0/#inbox',
    titulo: 'Recibidos',
    nodos: 3200,
    foco: null,
    campos: [],
    ...extra,
  };
}

describe('mismaHuella (FIX A: efecto de un click)', () => {
  it('la misma pagina (URL, titulo, nodos y campos identicos) es la misma huella', () => {
    expect(mismaHuella(bandeja(), bandeja({ foco: 'div role=button' }))).toBe(true);
  });

  it('la aparicion de nodos o de campos (el compose abierto) cambia la huella', () => {
    expect(mismaHuella(bandeja(), bandeja({ nodos: 3900 }))).toBe(false);
    expect(
      mismaHuella(
        bandeja(),
        bandeja({ campos: [{ contexto: 'input text Para', valor: '' }] }),
      ),
    ).toBe(false);
  });
});

describe('control de percepcion: click en Redactar sin efecto (escenario 1)', () => {
  it('reporta "SIN efecto visible" cuando la pagina no cambio tras el click', async () => {
    // La pagina es LA MISMA antes y despues del click: el compose nunca se abrio.
    const control = crearControlDePercepcion({ percibir: async () => bandeja() });
    await control.inicializar();
    await control.alTerminarPaso({
      actionName: 'act',
      actionArgs: { action: 'click the Redactar button' },
      toolOutput: {
        result: {
          playwrightArguments: {
            selector: '/html[1]/body[1]/div[6]/div[3]/div[1]',
            method: 'click',
            arguments: [],
          },
        },
      },
    });
    const lineas = control.tomarLineas();
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain('SIN efecto visible');
    expect(lineas[0]).toContain('click the Redactar button');
    expect(lineas[0]).toContain(PREFIJO_PERCEPCION);
    // Las lineas se DRENAN: el turno siguiente no las repite.
    expect(control.tomarLineas()).toHaveLength(0);
  });

  it('NO reporta nada cuando el click SI cambio la pagina (el compose aparecio)', async () => {
    const estados = [
      bandeja(),
      bandeja({
        nodos: 4100,
        campos: [{ contexto: 'input text to Destinatarios en Para', valor: '' }],
      }),
    ];
    const control = crearControlDePercepcion({
      percibir: async () => estados.shift() ?? bandeja({ nodos: 4100 }),
    });
    await control.inicializar();
    await control.alTerminarPaso({
      actionName: 'click',
      actionArgs: { describe: 'the Compose button', coordinates: [40, 120] },
      toolOutput: { result: {} },
    });
    expect(control.tomarLineas()).toHaveLength(0);
  });
});

describe('aterrizaje del texto tecleado (escenario 2: la barra de busqueda de Gmail)', () => {
  const conBusqueda = bandeja({
    foco: 'input text q gmail-search Buscar correo',
    campos: [
      { contexto: 'input text q gmail-search Buscar correo Search mail', valor: 'ana@ejemplo.com' },
    ],
  });

  it('reporta donde aterrizo y la discrepancia con el campo declarado', () => {
    const lineas = lineasDeAterrizaje({
      percepcion: conBusqueda,
      texto: 'ana@ejemplo.com',
      descripcion: 'type "ana@ejemplo.com" into the To field',
    });
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toContain('texto aterrizo en:');
    expect(lineas[0]).toContain('gmail-search');
    expect(lineas[1]).toContain('NO parece ser el objetivo que declaraste');
  });

  it('en espanol tambien: "escribe ... en el campo Para" contra la barra de busqueda', () => {
    const lineas = lineasDeAterrizaje({
      percepcion: conBusqueda,
      texto: 'ana@ejemplo.com',
      descripcion: 'escribe ana@ejemplo.com en el campo Para',
    });
    expect(lineas).toHaveLength(2);
    expect(lineas[1]).toContain('NO parece ser el objetivo');
  });

  it('sin discrepancia cuando el texto aterrizo en el campo declarado', () => {
    const percepcion = bandeja({
      campos: [{ contexto: 'input text to Destinatarios en Para To recipients', valor: 'ana@ejemplo.com' }],
    });
    const lineas = lineasDeAterrizaje({
      percepcion,
      texto: 'ana@ejemplo.com',
      descripcion: 'type "ana@ejemplo.com" into the To field',
    });
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain('texto aterrizo en:');
  });

  it('si el texto no aparece en ningun campo, lo dice y muestra el foco', () => {
    const lineas = lineasDeAterrizaje({
      percepcion: bandeja({ foco: 'div role=textbox Cuerpo del mensaje' }),
      texto: 'hola',
      descripcion: 'type "hola" into the body',
    });
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain('NO aparece en ningun campo legible');
    expect(lineas[0]).toContain('foco actual');
  });
});

describe('chip confirmado (escenario 3: el campo Para de Gmail)', () => {
  it('un valor que salio de chips se reporta como chip confirmado, no como campo vacio', () => {
    const percepcion = bandeja({
      campos: [
        {
          contexto: 'input text to Destinatarios en Para',
          valor: 'ana@ejemplo.com',
          porChips: true,
        },
      ],
    });
    const lineas = lineasDeAterrizaje({
      percepcion,
      texto: 'ana@ejemplo.com',
      descripcion: 'type "ana@ejemplo.com" into the To field',
    });
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain('(chip confirmado)');
  });

  it('campoDondeAterrizo prefiere la coincidencia exacta y acepta la contenida', () => {
    const percepcion = bandeja({
      campos: [
        { contexto: 'input text q Buscar', valor: 'algo con ana@ejemplo.com adentro' },
        { contexto: 'input text to Para', valor: 'ana@ejemplo.com' },
      ],
    });
    expect(campoDondeAterrizo(percepcion, 'ana@ejemplo.com')?.contexto).toContain('to Para');
  });
});

describe('coincideConObjetivoDeclarado', () => {
  it('devuelve null (sin juicio) cuando la descripcion no aporta tokens utiles', () => {
    expect(coincideConObjetivoDeclarado('type into the field', '', 'input text q')).toBeNull();
  });

  it('reconoce el campo por un token capitalizado corto (To)', () => {
    expect(
      coincideConObjetivoDeclarado(
        'type "x" into the To field',
        'x',
        'input text to destinatarios en para to recipients',
      ),
    ).toBe(true);
  });
});

describe('equivalencias de campo (caso literal de produccion: falso aviso de discrepancia)', () => {
  // El aria-label real del campo Para de Gmail en espanol NO contiene el token "to": sin la tabla
  // de equivalencias el matcher reportaba discrepancia y sugeria deshacer un tecleo correcto.
  it('objetivo "the To field" y contexto "Destinatarios en Para" son el mismo campo', () => {
    expect(
      coincideConObjetivoDeclarado(
        'type "ana@ejemplo.com" into the To field',
        'ana@ejemplo.com',
        'Destinatarios en Para',
      ),
    ).toBe(true);
  });

  it('el caso literal en lineasDeAterrizaje: conserva la linea de aterrizaje y suprime el aviso', () => {
    const percepcion = bandeja({
      campos: [{ contexto: 'Destinatarios en Para', valor: 'ana@ejemplo.com' }],
    });
    const lineas = lineasDeAterrizaje({
      percepcion,
      texto: 'ana@ejemplo.com',
      descripcion: 'type "ana@ejemplo.com" into the To field',
    });
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain('texto aterrizo en:');
    expect(lineas[0]).toContain('Destinatarios en Para');
  });

  it('subject/asunto y body/cuerpo tambien son equivalentes', () => {
    expect(coincideConObjetivoDeclarado('type "hola" into the Subject field', 'hola', 'Asunto')).toBe(true);
    expect(
      coincideConObjetivoDeclarado('type "hola" into the body', 'hola', 'div role=textbox Cuerpo del mensaje'),
    ).toBe(true);
  });

  it('la equivalencia es por palabra completa: "to" no matchea dentro de "editor"', () => {
    expect(
      coincideConObjetivoDeclarado('escribe "hola" en el campo Para', 'hola', 'editor principal'),
    ).toBe(false);
  });

  it('la discrepancia real se sigue reportando (barra de busqueda vs campo Para)', () => {
    expect(
      coincideConObjetivoDeclarado(
        'type "ana@ejemplo.com" into the To field',
        'ana@ejemplo.com',
        'input text q gmail-search Buscar correo Search mail',
      ),
    ).toBe(false);
  });
});

describe('interpretarPaso', () => {
  it('act con method click es un click; con fill es una escritura con su texto', () => {
    expect(
      interpretarPaso({
        actionName: 'act',
        actionArgs: { action: 'click the Send button' },
        toolOutput: { result: { playwrightArguments: { method: 'click', arguments: [] } } },
      }),
    ).toEqual({ tipo: 'click', descripcion: 'click the Send button' });
    expect(
      interpretarPaso({
        actionName: 'act',
        actionArgs: { action: 'type "hola" into the subject' },
        toolOutput: { result: { playwrightArguments: { method: 'fill', arguments: ['hola'] } } },
      }),
    ).toEqual({ tipo: 'escritura', descripcion: 'type "hola" into the subject', texto: 'hola' });
  });

  it('las tools nativas click y type (por coordenadas) tambien se interpretan', () => {
    expect(
      interpretarPaso({
        actionName: 'click',
        actionArgs: { describe: 'the Compose button', coordinates: [10, 20] },
        toolOutput: { result: {} },
      }),
    ).toEqual({ tipo: 'click', descripcion: 'the Compose button' });
    expect(
      interpretarPaso({
        actionName: 'type',
        actionArgs: { describe: 'the To field', text: 'ana@ejemplo.com', coordinates: [1, 2] },
        toolOutput: { result: {} },
      }),
    ).toEqual({ tipo: 'escritura', descripcion: 'the To field', texto: 'ana@ejemplo.com' });
  });

  it('screenshot / extract / ariaTree no pagan lectura; goto solo refresca', () => {
    expect(interpretarPaso({ actionName: 'screenshot', actionArgs: {}, toolOutput: {} })).toEqual({
      tipo: 'ignorar',
    });
    expect(interpretarPaso({ actionName: 'goto', actionArgs: {}, toolOutput: {} })).toEqual({
      tipo: 'refrescar',
    });
  });
});

describe('tope de lineas por turno y tolerancia a fallos', () => {
  it('tomarLineas corta en MAX_LINEAS_POR_TURNO', async () => {
    const control = crearControlDePercepcion({
      percibir: async () =>
        bandeja({ campos: [{ contexto: 'input text q Buscar', valor: 'x' }] }),
    });
    await control.inicializar();
    for (let i = 0; i < 12; i++) {
      await control.alTerminarPaso({
        actionName: 'type',
        actionArgs: { describe: 'the To field', text: 'x' },
        toolOutput: { result: {} },
      });
    }
    expect(control.tomarLineas().length).toBeLessThanOrEqual(MAX_LINEAS_POR_TURNO);
  });

  it('una lectura que falla deja el paso sin percepcion y no lanza', async () => {
    const control = crearControlDePercepcion({
      percibir: async () => {
        throw new Error('sesion caida');
      },
    });
    await control.inicializar();
    await control.alTerminarPaso({
      actionName: 'click',
      actionArgs: { describe: 'x' },
      toolOutput: { result: {} },
    });
    expect(control.tomarLineas()).toHaveLength(0);
  });
});

describe('parsearPercepcion', () => {
  it('parsea la salida de la expresion y tolera basura', () => {
    const crudo = JSON.stringify({
      url: 'https://a',
      titulo: 't',
      nodos: 5,
      foco: 'input text q',
      campos: [{ contexto: 'c', valor: 'v', porChips: true }, { malo: true }],
    });
    const percepcion = parsearPercepcion(crudo);
    expect(percepcion?.campos).toEqual([{ contexto: 'c', valor: 'v', porChips: true }]);
    expect(parsearPercepcion('no-json')).toBeNull();
    expect(parsearPercepcion(null)).toBeNull();
  });
});

describe('integracion con el bucle del motor (stagehand.ts)', () => {
  const base = {
    objetivo: 'x',
    maxPasos: 5,
    toolTimeoutMs: 1000,
    historialPasos: 8,
  };

  it('onEvidence corre la percepcion y prepareStep adjunta las lineas como mensaje de usuario', async () => {
    const estados = [bandeja(), bandeja()];
    const control = crearControlDePercepcion({
      percibir: async () => estados.shift() ?? bandeja(),
    });
    await control.inicializar();
    const opciones = construirOpcionesDeEjecucion({ ...base, percepcion: control });
    expect(opciones.callbacks?.onEvidence).toBeDefined();
    await opciones.callbacks?.onEvidence?.({
      type: 'step_finished',
      actionName: 'act',
      actionArgs: { action: 'click the Redactar button' },
      reasoning: '',
      toolOutput: {
        ok: true,
        result: { playwrightArguments: { method: 'click', arguments: [] } },
      },
    } as never);
    const mensajes: MensajeDeModelo[] = [{ role: 'user', content: 'objetivo' }];
    const preparado = await opciones.callbacks?.prepareStep?.({ messages: mensajes } as never);
    const enviados = (preparado as { messages: MensajeDeModelo[] }).messages;
    const ultimo = enviados[enviados.length - 1];
    expect(ultimo?.role).toBe('user');
    expect(String(ultimo?.content)).toContain('SIN efecto visible');
    // El turno siguiente ya no arrastra las lineas.
    const segundo = await opciones.callbacks?.prepareStep?.({ messages: mensajes } as never);
    const otraVez = (segundo as { messages: MensajeDeModelo[] }).messages;
    expect(String(otraVez[otraVez.length - 1]?.content)).not.toContain('SIN efecto visible');
  });

  it('sin percepcion, prepareStep no agrega ningun mensaje', async () => {
    const opciones = construirOpcionesDeEjecucion(base);
    const mensajes: MensajeDeModelo[] = [{ role: 'user', content: 'objetivo' }];
    const preparado = await opciones.callbacks?.prepareStep?.({ messages: mensajes } as never);
    expect((preparado as { messages: MensajeDeModelo[] }).messages).toHaveLength(1);
  });
});
