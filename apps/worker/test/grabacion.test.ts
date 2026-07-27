import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Job, PasoGrabado } from '@ledesma-platform/shared';
import { parsearPasosGrabados } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import type { Grabacion } from '@ledesma-platform/backend/grabaciones';
import {
  AcumuladorDeGrabacion,
  parsearEventoCapturado,
  posicionDeVerificacion,
  procesarJobDeGrabacion,
  promoverGrabacion,
  type GrabacionDeps,
  type NavegadorParaGrabacion,
} from '../src/grabacion.js';
import { VALOR_CENSURADO } from '../src/censura.js';
import type { Logger } from '../src/logger.js';

/**
 * GRABACION DE TAREAS de punta a punta, todo por fakes: cero navegador, cero base y -- el punto -- CERO
 * MODELO. Lo que estos tests fijan y no debe poder cambiar en silencio:
 *
 *  1. una grabacion sobre un sitio ACTIVO captura los pasos con sus estrategias de localizacion;
 *  2. la aparicion de un campo de contrasena DETIENE la grabacion y DESCARTA lo capturado;
 *  3. los valores marcados como datos que cambian cada vez NO quedan persistidos en ningun lado;
 *  4. la grabacion no hace ninguna llamada al modelo (ni tiene por donde hacerla);
 *  5. una receta grabada de un objetivo con accion irreversible se guarda CON su punto de
 *     verificacion, para que no pueda saltarse la comparacion previa.
 */

const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';
const GRABACION_ID = '88888888-8888-4888-8888-888888888888';
const DOMINIO = 'correo.ejemplo.com';
const CONTEXTO_PLANO = JSON.stringify({ formato: 'cookies-cdp-v1', cookies: [] });

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(payload: unknown): Job {
  return {
    id: 'job-1',
    agentId: null,
    ownerId: 'user-1',
    credentialId: null,
    status: 'running',
    payload,
    scheduledFor: null,
    attempts: 1,
    lastError: null,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    startedAt: '2026-07-24T00:00:00.000Z',
    finishedAt: null,
  };
}

function makeSitio(overrides: Partial<SitioConectado> = {}): SitioConectado {
  return {
    id: CONNECTION_ID,
    ownerId: 'user-1',
    dominio: DOMINIO,
    urlLogin: `https://${DOMINIO}/login`,
    contextoExternoId: 'ctx-1',
    proxyRef: 'browserbase',
    proxyCountry: 'MX',
    proxyState: null,
    egressIp: '203.0.113.7',
    fingerprintRef: 'contexto:ctx-1',
    sesionExternaId: null,
    vistaEnVivoUrl: null,
    estado: 'activo',
    tieneContexto: true,
    creadoEn: '2026-07-16T00:00:00.000Z',
    ultimoUsoEn: null,
    expiraEn: null,
    ...overrides,
  };
}

function makeGrabacion(overrides: Partial<Grabacion> = {}): Grabacion {
  return {
    id: GRABACION_ID,
    ownerId: 'user-1',
    connectionId: CONNECTION_ID,
    dominio: DOMINIO,
    descripcion: 'mandar el reporte semanal',
    estado: 'grabando',
    motivo: null,
    pasos: [],
    vistaEnVivoUrl: null,
    creadaEn: '2026-07-24T00:00:00.000Z',
    actualizadaEn: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

/** Estrategias tal como las emite el guion grabador desde la pagina. */
const ESTRATEGIAS_BOTON = [
  { tipo: 'atributo', atributo: 'id', valor: 'enviar' },
  { tipo: 'rol', rol: 'button', nombre: 'Enviar' },
  { tipo: 'xpath', xpath: '/html[1]/body[1]/button[1]' },
];
const ESTRATEGIAS_CAMPO = [
  { tipo: 'atributo', atributo: 'name', valor: 'to' },
  { tipo: 'xpath', xpath: '/html[1]/body[1]/input[1]' },
];

/**
 * Fakes del entorno de la grabacion. `eventos` es la secuencia que el guion emitiria; el fake la
 * entrega en cuanto se instala la captura, igual que haria el navegador.
 */
function makeDeps(opciones: {
  eventos?: unknown[];
  grabacion?: Grabacion;
  sitio?: SitioConectado | null;
  hayPantallaDeLogin?: boolean;
  sondeos?: number;
} = {}) {
  const grabacionActual = opciones.grabacion ?? makeGrabacion();
  const pasosGuardados: PasoGrabado[][] = [];
  const descartes: string[] = [];
  const resultados: unknown[] = [];
  const detener = vi.fn(async () => {});
  const cerrarSesion = vi.fn(async () => {});
  // El usuario dice "ya termine" tras `sondeos` vueltas del bucle.
  let sondeosRestantes = opciones.sondeos ?? 1;

  const navegador: NavegadorParaGrabacion = {
    abrirSesionParaGrabacion: vi.fn(async () => ({
      sesionExternaId: 'ses-1',
      vistaEnVivoUrl: 'https://vista-en-vivo',
      egressIp: '203.0.113.7',
      egressCountry: 'MX',
    })),
    inyectarContexto: vi.fn(async () => {}),
    detectarPantallaDeLogin: vi.fn(async () => opciones.hayPantallaDeLogin === true),
    iniciarCaptura: vi.fn(async (_sesion: string, alRecibir: (crudo: string) => void) => {
      for (const evento of opciones.eventos ?? []) alRecibir(JSON.stringify(evento));
      return { detener };
    }),
    cerrarSesion,
  };

  const deps: GrabacionDeps = {
    repo: {
      obtenerPorId: vi.fn(async () =>
        opciones.sitio === undefined ? makeSitio() : opciones.sitio,
      ),
      obtenerContextoDescifrado: vi.fn(async () => CONTEXTO_PLANO),
    },
    grabaciones: {
      obtener: vi.fn(async () => grabacionActual),
      publicarVistaEnVivo: vi.fn(async () => {}),
      sigueGrabando: vi.fn(async () => {
        sondeosRestantes -= 1;
        return sondeosRestantes > 0;
      }),
      guardarPasos: vi.fn(async (_id: string, _owner: string, pasos: PasoGrabado[]) => {
        pasosGuardados.push(pasos);
      }),
      descartar: vi.fn(async (_id: string, _owner: string, motivo: string) => {
        descartes.push(motivo);
      }),
    },
    recetas: { promover: vi.fn(async () => null) },
    navegador,
    vaultSecret: 'x'.repeat(64),
    guardarResultado: vi.fn(async (_jobId: string, resultado: unknown) => {
      resultados.push(resultado);
    }),
    esperar: vi.fn(async () => {}),
    logger: makeLogger(),
  };

  return { deps, navegador, pasosGuardados, descartes, resultados, detener, cerrarSesion };
}

const PAYLOAD_GRABAR = {
  kind: 'grabar_tarea',
  connectionId: CONNECTION_ID,
  grabacionId: GRABACION_ID,
};

describe('la grabacion captura pasos con sus estrategias de localizacion', () => {
  it('sobre un sitio activo guarda la pagina de inicio, los clics y lo que el usuario escribio', async () => {
    const { deps, pasosGuardados, descartes } = makeDeps({
      eventos: [
        { tipo: 'navegacion', url: `https://${DOMINIO}/inbox` },
        { tipo: 'clic', url: `https://${DOMINIO}/inbox`, estrategias: ESTRATEGIAS_BOTON },
        {
          tipo: 'escritura',
          url: `https://${DOMINIO}/inbox`,
          estrategias: ESTRATEGIAS_CAMPO,
          valor: 'ana@ejemplo.com',
          contexto: 'input text to Para',
        },
        { tipo: 'tecla', url: `https://${DOMINIO}/inbox`, teclas: 'Enter', estrategias: [] },
      ],
    });

    await procesarJobDeGrabacion(deps, makeJob(PAYLOAD_GRABAR));

    expect(descartes).toEqual([]);
    const pasos = pasosGuardados[0];
    expect(pasos).toBeDefined();
    expect(pasos?.map((p) => p.accion)).toEqual(['navegar', 'click', 'escribir', 'teclas']);
    // La pagina de inicio queda como RUTA relativa, jamas como URL.
    expect(pasos?.[0]?.ruta).toBe('/inbox');
    // Las estrategias llegan saneadas y ORDENADAS por el orden del sistema de recetas.
    expect(pasos?.[1]?.estrategias.map((e) => e.tipo)).toEqual(['atributo', 'rol', 'xpath']);
    expect(pasos?.[2]?.valor).toBe('ana@ejemplo.com');
    // Y lo guardado valida contra el contrato compartido.
    expect(parsearPasosGrabados(pasos)).not.toBeNull();
  });

  it('la vista en vivo se publica DESPUES de instalar la captura (no se pierde el primer paso)', async () => {
    const { deps } = makeDeps();
    const orden: string[] = [];
    const captura = deps.navegador.iniciarCaptura;
    (deps.navegador as { iniciarCaptura: unknown }).iniciarCaptura = vi.fn(async (...args: never[]) => {
      orden.push('captura');
      return (captura as (...a: never[]) => Promise<{ detener(): Promise<void> }>)(...args);
    });
    (deps.grabaciones as { publicarVistaEnVivo: unknown }).publicarVistaEnVivo = vi.fn(async () => {
      orden.push('vista');
    });

    await procesarJobDeGrabacion(deps, makeJob(PAYLOAD_GRABAR));
    expect(orden).toEqual(['captura', 'vista']);
  });

  it('la sesion se cierra siempre al terminar', async () => {
    const { deps, cerrarSesion, detener } = makeDeps();
    await procesarJobDeGrabacion(deps, makeJob(PAYLOAD_GRABAR));
    expect(detener).toHaveBeenCalledTimes(1);
    expect(cerrarSesion).toHaveBeenCalledWith('ses-1');
  });

  it('publica la sesion del proveedor como resultado INTERMEDIO (para el token del relay) y el desenlace la sobreescribe', async () => {
    const { deps, resultados } = makeDeps();
    await procesarJobDeGrabacion(deps, makeJob(PAYLOAD_GRABAR));
    // Mientras la grabacion corre, el backend puede leer la sesion viva para acunar el token del
    // relay de teclado movil. El desenlace final NO conserva el id de sesion.
    expect(resultados[0]).toEqual({
      estado: 'grabando',
      grabacionId: GRABACION_ID,
      sesionExternaId: 'ses-1',
    });
    expect(resultados[resultados.length - 1]).toEqual({
      estado: 'grabada',
      grabacionId: GRABACION_ID,
      pasos: expect.any(Number),
    });
  });
});

describe('EL INVARIANTE: el login jamas se graba', () => {
  it('un campo de contrasena a mitad de la grabacion la detiene y DESCARTA lo capturado', async () => {
    const { deps, pasosGuardados, descartes, resultados } = makeDeps({
      eventos: [
        { tipo: 'navegacion', url: `https://${DOMINIO}/inbox` },
        { tipo: 'clic', url: `https://${DOMINIO}/inbox`, estrategias: ESTRATEGIAS_BOTON },
        { tipo: 'contrasena' },
        // Todo lo que llegara despues del corte se ignora.
        {
          tipo: 'escritura',
          url: `https://${DOMINIO}/login`,
          estrategias: ESTRATEGIAS_CAMPO,
          valor: 'hunter2',
          contexto: 'input password Clave',
        },
      ],
    });

    await procesarJobDeGrabacion(deps, makeJob(PAYLOAD_GRABAR));

    expect(descartes).toEqual(['contrasena']);
    // NADA se guarda: ni los pasos que ya se habian capturado antes del campo de contrasena.
    expect(pasosGuardados).toEqual([]);
    expect(deps.grabaciones.guardarPasos).not.toHaveBeenCalled();
    // El desenlace (descartada) SOBREESCRIBE el resultado intermedio de la sesion del relay.
    expect(resultados[resultados.length - 1]).toEqual({
      estado: 'descartada',
      grabacionId: GRABACION_ID,
      motivo: 'contrasena',
    });
  });

  it('si el sitio YA pide login al abrir, no se instala la captura siquiera', async () => {
    const { deps, descartes, navegador } = makeDeps({ hayPantallaDeLogin: true });
    await procesarJobDeGrabacion(deps, makeJob(PAYLOAD_GRABAR));
    expect(descartes).toEqual(['contrasena']);
    expect(navegador.iniciarCaptura).not.toHaveBeenCalled();
  });

  it('una grabacion sobre un sitio que no esta activo no abre ninguna sesion', async () => {
    const { deps, navegador } = makeDeps({ sitio: makeSitio({ estado: 'esperando_login' }) });
    await expect(procesarJobDeGrabacion(deps, makeJob(PAYLOAD_GRABAR))).rejects.toThrow(
      /no esta conectado/,
    );
    expect(navegador.abrirSesionParaGrabacion).not.toHaveBeenCalled();
  });

  it('un valor tecleado en un campo sensible llega YA censurado (censura existente)', () => {
    const evento = parsearEventoCapturado(
      JSON.stringify({
        tipo: 'escritura',
        url: `https://${DOMINIO}/x`,
        estrategias: ESTRATEGIAS_CAMPO,
        valor: 'hunter2',
        contexto: 'input text clave Contrasena',
      }),
    );
    expect(evento?.valor).toBe(VALOR_CENSURADO);
  });

  it('un numero con pinta de tarjeta se censura aunque el campo no lo delate', () => {
    const evento = parsearEventoCapturado(
      JSON.stringify({
        tipo: 'escritura',
        url: `https://${DOMINIO}/x`,
        estrategias: ESTRATEGIAS_CAMPO,
        valor: '4111 1111 1111 1111',
        contexto: 'input text numero',
      }),
    );
    expect(evento?.valor).toBe(VALOR_CENSURADO);
  });
});

describe('cero llamadas al modelo', () => {
  it('el modulo de grabacion no importa NINGUN cliente de modelo ni el motor de navegacion', () => {
    const fuente = readFileSync(new URL('../src/grabacion.ts', import.meta.url), 'utf8');
    for (const prohibido of ['stagehand', 'anthropic', 'openai', 'prompt-tarea-web.js.*apiKey']) {
      expect(fuente.toLowerCase()).not.toContain(prohibido.toLowerCase());
    }
    // Tampoco existe el import del adaptador del motor ni del escalador de pasos.
    expect(fuente).not.toContain("from './stagehand.js'");
    expect(fuente).not.toContain("from './ejecutor-receta.js'");
  });

  it('las dependencias de la grabacion no tienen motor, escalador, credencial ni modelo', async () => {
    const { deps } = makeDeps();
    await procesarJobDeGrabacion(deps, makeJob(PAYLOAD_GRABAR));
    const claves = Object.keys(deps);
    for (const prohibida of ['motor', 'escalador', 'model', 'apiKey', 'resolveCredential']) {
      expect(claves).not.toContain(prohibida);
    }
  });

  it('el job de grabacion se ejecuta sin credencial (credentialId null)', async () => {
    const { deps } = makeDeps();
    const job = makeJob(PAYLOAD_GRABAR);
    expect(job.credentialId).toBeNull();
    await expect(procesarJobDeGrabacion(deps, job)).resolves.toBeUndefined();
  });
});

describe('AcumuladorDeGrabacion (reglas deterministas de la captura)', () => {
  function evento(crudo: unknown) {
    const parseado = parsearEventoCapturado(JSON.stringify(crudo));
    if (parseado === null) throw new Error('el evento del fixture no parsea');
    return parseado;
  }

  it('solo la PRIMERA navegacion es un paso: las posteriores son consecuencia de los clics', () => {
    const acumulador = new AcumuladorDeGrabacion(DOMINIO);
    acumulador.agregar(evento({ tipo: 'navegacion', url: `https://${DOMINIO}/inbox` }));
    acumulador.agregar(evento({ tipo: 'clic', url: `https://${DOMINIO}/inbox`, estrategias: ESTRATEGIAS_BOTON }));
    acumulador.agregar(evento({ tipo: 'navegacion', url: `https://${DOMINIO}/redactar` }));
    expect(acumulador.pasos().map((p) => p.accion)).toEqual(['navegar', 'click']);
  });

  it('una cadena de redirecciones antes de la primera interaccion colapsa en la ultima URL', () => {
    const acumulador = new AcumuladorDeGrabacion(DOMINIO);
    acumulador.agregar(evento({ tipo: 'navegacion', url: `https://${DOMINIO}/` }));
    acumulador.agregar(evento({ tipo: 'navegacion', url: `https://${DOMINIO}/inbox` }));
    expect(acumulador.pasos()).toHaveLength(1);
    expect(acumulador.pasos()[0]?.ruta).toBe('/inbox');
  });

  it('una navegacion FUERA del dominio de la conexion no se graba', () => {
    const acumulador = new AcumuladorDeGrabacion(DOMINIO);
    acumulador.agregar(evento({ tipo: 'navegacion', url: 'https://otro.com/x' }));
    expect(acumulador.pasos()).toEqual([]);
  });

  it('escribir dos veces en el mismo campo deja el valor FINAL, no dos pasos', () => {
    const acumulador = new AcumuladorDeGrabacion(DOMINIO);
    const escritura = (valor: string) =>
      evento({
        tipo: 'escritura',
        url: `https://${DOMINIO}/x`,
        estrategias: ESTRATEGIAS_CAMPO,
        valor,
        contexto: 'input text to Para',
      });
    acumulador.agregar(escritura('ana@'));
    acumulador.agregar(evento({ tipo: 'tecla', url: `https://${DOMINIO}/x`, teclas: 'Tab', estrategias: [] }));
    acumulador.agregar(escritura('ana@ejemplo.com'));
    const pasos = acumulador.pasos();
    expect(pasos.map((p) => p.accion)).toEqual(['escribir', 'teclas']);
    expect(pasos[0]?.valor).toBe('ana@ejemplo.com');
  });

  it('volver al mismo campo DESPUES de otra interaccion si es un paso nuevo', () => {
    const acumulador = new AcumuladorDeGrabacion(DOMINIO);
    const escritura = evento({
      tipo: 'escritura',
      url: `https://${DOMINIO}/x`,
      estrategias: ESTRATEGIAS_CAMPO,
      valor: 'ana@ejemplo.com',
      contexto: 'input text to Para',
    });
    acumulador.agregar(escritura);
    acumulador.agregar(evento({ tipo: 'clic', url: `https://${DOMINIO}/x`, estrategias: ESTRATEGIAS_BOTON }));
    acumulador.agregar(escritura);
    expect(acumulador.pasos().map((p) => p.accion)).toEqual(['escribir', 'click', 'escribir']);
  });

  it('una interaccion sin ninguna estrategia utilizable corta la grabacion entera', () => {
    const acumulador = new AcumuladorDeGrabacion(DOMINIO);
    const sinEstrategias = parsearEventoCapturado(
      JSON.stringify({ tipo: 'clic', url: `https://${DOMINIO}/x`, estrategias: [] }),
    );
    expect(acumulador.agregar(sinEstrategias!)).toBe('no_repetible');
  });

  it('el paso que CONFIRMA una escritura no se localiza por el dato que se acaba de escribir', () => {
    const acumulador = new AcumuladorDeGrabacion(DOMINIO);
    acumulador.agregar(
      evento({
        tipo: 'escritura',
        url: `https://${DOMINIO}/x`,
        estrategias: ESTRATEGIAS_CAMPO,
        valor: 'ana@ejemplo.com',
        contexto: 'input text to Para',
      }),
    );
    // La sugerencia del autocompletado: su texto ES el correo, y ademas esta en el nombre accesible.
    acumulador.agregar(
      evento({
        tipo: 'clic',
        url: `https://${DOMINIO}/x`,
        estrategias: [
          { tipo: 'texto', texto: 'ana@ejemplo.com ana@ejemplo.com' },
          { tipo: 'rol', rol: 'option', nombre: 'ana@ejemplo.com' },
          { tipo: 'xpath', xpath: '/html[1]/body[1]/div[2]/div[1]' },
        ],
      }),
    );
    const confirmacion = acumulador.pasos()[1];
    expect(confirmacion?.accion).toBe('click');
    // Queda la POSICION en la lista de sugerencias, que sirve con cualquier otro destinatario.
    expect(confirmacion?.estrategias).toEqual([
      { tipo: 'xpath', xpath: '/html[1]/body[1]/div[2]/div[1]' },
    ]);
  });

  it('si la confirmacion SOLO se localiza por el dato y ya hubo Tab, la tecla es el paso', () => {
    const acumulador = new AcumuladorDeGrabacion(DOMINIO);
    acumulador.agregar(
      evento({
        tipo: 'escritura',
        url: `https://${DOMINIO}/x`,
        estrategias: ESTRATEGIAS_CAMPO,
        valor: 'ana@ejemplo.com',
        contexto: 'input text to Para',
      }),
    );
    acumulador.agregar(evento({ tipo: 'tecla', url: `https://${DOMINIO}/x`, teclas: 'Tab', estrategias: [] }));
    const clicSoloPorElDato = evento({
      tipo: 'clic',
      url: `https://${DOMINIO}/x`,
      estrategias: [{ tipo: 'texto', texto: 'ana@ejemplo.com' }],
    });
    expect(acumulador.agregar(clicSoloPorElDato)).toBe('ignorado');
    expect(acumulador.pasos().map((p) => p.accion)).toEqual(['escribir', 'teclas']);
  });

  it('si la confirmacion SOLO se localiza por el dato y no hubo tecla, la grabacion no sirve', () => {
    const acumulador = new AcumuladorDeGrabacion(DOMINIO);
    acumulador.agregar(
      evento({
        tipo: 'escritura',
        url: `https://${DOMINIO}/x`,
        estrategias: ESTRATEGIAS_CAMPO,
        valor: 'ana@ejemplo.com',
        contexto: 'input text to Para',
      }),
    );
    const clicSoloPorElDato = evento({
      tipo: 'clic',
      url: `https://${DOMINIO}/x`,
      estrategias: [{ tipo: 'texto', texto: 'ana@ejemplo.com' }],
    });
    expect(acumulador.agregar(clicSoloPorElDato)).toBe('no_repetible');
  });

  it('un campo que solo se localiza por lo que se escribio dentro no es repetible', () => {
    const acumulador = new AcumuladorDeGrabacion(DOMINIO);
    const soloPorSuTexto = evento({
      tipo: 'escritura',
      url: `https://${DOMINIO}/x`,
      estrategias: [{ tipo: 'texto', texto: 'llego el paquete' }],
      valor: 'llego el paquete',
      contexto: 'div',
    });
    expect(acumulador.agregar(soloPorSuTexto)).toBe('no_repetible');
  });
});

describe('los datos marcados como variables NO quedan persistidos', () => {
  const PASOS: PasoGrabado[] = [
    { idx: 0, accion: 'navegar', estrategias: [], valor: null, teclas: null, ruta: '/redactar' },
    {
      idx: 1,
      accion: 'escribir',
      estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'to' }],
      valor: 'ana@ejemplo.com',
      teclas: null,
      ruta: null,
    },
    {
      idx: 2,
      accion: 'escribir',
      estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'filtro' }],
      valor: 'Bandeja de entrada',
      teclas: null,
      ruta: null,
    },
    {
      idx: 3,
      accion: 'click',
      estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'enviar' }],
      valor: null,
      teclas: null,
      ruta: null,
    },
  ];

  it('la receta guarda el MARCADOR y la grabacion deja de tener el dato', () => {
    const promocion = promoverGrabacion({
      pasos: PASOS,
      descripcion: 'mandar un correo',
      variables: [{ idx: 1, marcador: 'destinatario' }],
    });
    expect(promocion.promovida).toBe(true);
    if (!promocion.promovida) return;

    const serializado = JSON.stringify(promocion);
    expect(serializado).not.toContain('ana@ejemplo.com');
    expect(promocion.pasos[1]?.valor).toEqual({ tipo: 'parametro', parametro: 'destinatario' });
    expect(promocion.grabados[1]?.valor).toBe('<destinatario>');
    // Lo que NO se marco es parte fija del procedimiento y se conserva tal cual.
    expect(promocion.pasos[2]?.valor).toEqual({ tipo: 'literal', texto: 'Bandeja de entrada' });
  });

  it('la promocion escribe la grabacion re escrita ANTES de crear la receta', async () => {
    const grabacion = makeGrabacion({ estado: 'terminada', pasos: PASOS });
    const { deps, pasosGuardados } = makeDeps({ grabacion });
    await procesarJobDeGrabacion(
      deps,
      makeJob({
        kind: 'promover_grabacion',
        grabacionId: GRABACION_ID,
        variables: [{ idx: 1, marcador: 'destinatario' }],
      }),
    );
    expect(JSON.stringify(pasosGuardados)).not.toContain('ana@ejemplo.com');
    expect(pasosGuardados[0]?.[1]?.valor).toBe('<destinatario>');
    expect(deps.recetas.promover).toHaveBeenCalledWith(
      expect.objectContaining({ dominio: DOMINIO, origen: 'grabacion' }),
    );
  });

  it('el dato marcado tampoco queda dentro de NINGUNA localizacion, ni en la de otro paso', () => {
    // Es el caso de produccion: el paso que escribia el cuerpo conservaba una estrategia de texto
    // con el cuerpo entero, y el paso siguiente se localizaba por ese mismo texto.
    const promocion = promoverGrabacion({
      pasos: [
        {
          idx: 0,
          accion: 'escribir',
          estrategias: [
            { tipo: 'atributo', atributo: 'aria-label', valor: 'Cuerpo del mensaje' },
            { tipo: 'texto', texto: 'llego el paquete' },
          ],
          valor: 'llego el paquete',
          teclas: null,
          ruta: null,
        },
        {
          idx: 1,
          accion: 'click',
          estrategias: [
            { tipo: 'rol', rol: 'option', nombre: 'llego el paquete' },
            { tipo: 'xpath', xpath: '/html[1]/body[1]/button[1]' },
          ],
          valor: null,
          teclas: null,
          ruta: null,
        },
      ],
      descripcion: 'mandar un mensaje',
      variables: [{ idx: 0, marcador: 'cuerpo' }],
    });
    expect(promocion.promovida).toBe(true);
    if (!promocion.promovida) return;
    // Ni en la receta ni en la grabacion re escrita queda rastro del dato, en ningun campo.
    expect(JSON.stringify(promocion)).not.toContain('llego el paquete');
    expect(promocion.pasos[0]?.estrategias).toEqual([
      { tipo: 'atributo', atributo: 'aria-label', valor: 'Cuerpo del mensaje' },
    ]);
    // El paso de confirmacion (la receta lleva ademas su punto de verificacion, por el verbo).
    const confirmacion = promocion.pasos.find((paso) => paso.accion === 'click');
    expect(confirmacion?.estrategias).toEqual([
      { tipo: 'xpath', xpath: '/html[1]/body[1]/button[1]' },
    ]);
    expect(promocion.grabados[0]?.estrategias).toEqual(promocion.pasos[0]?.estrategias);
  });

  it('un dato SENSIBLE que no se marco como variable no se guarda como texto fijo: se rechaza', () => {
    const promocion = promoverGrabacion({
      pasos: [
        {
          idx: 0,
          accion: 'escribir',
          estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'campo' }],
          valor: VALOR_CENSURADO,
          teclas: null,
          ruta: null,
        },
      ],
      descripcion: 'algo',
      variables: [],
    });
    expect(promocion.promovida).toBe(false);
  });
});

describe('la receta grabada NO se salta la verificacion previa', () => {
  const PASOS: PasoGrabado[] = [
    { idx: 0, accion: 'navegar', estrategias: [], valor: null, teclas: null, ruta: '/redactar' },
    {
      idx: 1,
      accion: 'escribir',
      estrategias: [{ tipo: 'atributo', atributo: 'name', valor: 'to' }],
      valor: 'ana@ejemplo.com',
      teclas: null,
      ruta: null,
    },
    {
      idx: 2,
      accion: 'click',
      estrategias: [{ tipo: 'atributo', atributo: 'id', valor: 'enviar' }],
      valor: null,
      teclas: null,
      ruta: null,
    },
  ];

  it('un objetivo con accion irreversible se promueve CON su punto de verificacion, antes del clic final', () => {
    const promocion = promoverGrabacion({
      pasos: PASOS,
      descripcion: 'enviar un correo a ana@ejemplo.com',
      variables: [{ idx: 1, marcador: 'destinatario' }],
    });
    expect(promocion.promovida).toBe(true);
    if (!promocion.promovida) return;
    expect(promocion.pasos.map((p) => p.accion)).toEqual([
      'navegar',
      'escribir',
      'verificar',
      'click',
    ]);
    // Los indices quedan correlativos, que es lo que el contrato de recetas exige.
    expect(promocion.pasos.map((p) => p.idx)).toEqual([0, 1, 2, 3]);
  });

  it('un objetivo SIN accion irreversible no agrega ningun paso de verificacion', () => {
    const promocion = promoverGrabacion({
      pasos: PASOS,
      descripcion: 'abrir el resumen de la semana',
      variables: [],
    });
    expect(promocion.promovida).toBe(true);
    if (!promocion.promovida) return;
    expect(promocion.pasos.some((p) => p.accion === 'verificar')).toBe(false);
  });

  it('la verificacion se coloca despues de la ultima escritura, no al final', () => {
    expect(
      posicionDeVerificacion([
        { idx: 0, accion: 'escribir', estrategias: [], valor: null, teclas: null, ruta: null, esperaMs: null },
        { idx: 1, accion: 'click', estrategias: [], valor: null, teclas: null, ruta: null, esperaMs: null },
        { idx: 2, accion: 'click', estrategias: [], valor: null, teclas: null, ruta: null, esperaMs: null },
      ]),
    ).toBe(1);
  });

  it('sin ninguna escritura, la verificacion va ANTES del ultimo paso (el que compromete)', () => {
    expect(
      posicionDeVerificacion([
        { idx: 0, accion: 'click', estrategias: [], valor: null, teclas: null, ruta: null, esperaMs: null },
        { idx: 1, accion: 'click', estrategias: [], valor: null, teclas: null, ruta: null, esperaMs: null },
      ]),
    ).toBe(1);
  });
});

describe('promover una grabacion que no sirve', () => {
  it('una grabacion vacia no se promueve', () => {
    expect(promoverGrabacion({ pasos: [], descripcion: 'algo', variables: [] })).toMatchObject({
      promovida: false,
    });
  });

  it('una grabacion que no esta terminada no se puede promover', async () => {
    const { deps } = makeDeps({ grabacion: makeGrabacion({ estado: 'grabando' }) });
    await expect(
      procesarJobDeGrabacion(
        deps,
        makeJob({ kind: 'promover_grabacion', grabacionId: GRABACION_ID, variables: [] }),
      ),
    ).rejects.toThrow(/no esta lista/);
    expect(deps.recetas.promover).not.toHaveBeenCalled();
  });
});
