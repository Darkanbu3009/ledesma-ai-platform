import { describe, it, expect, vi } from 'vitest';
import type { Job } from '@ledesma-platform/shared';
import type { SitioConectado } from '@ledesma-platform/backend/sitios';
import {
  barrerLoginsVencidos,
  CONTEXTO_TTL_DIAS_DEFAULT,
  esErrorDeRecursoInexistente,
  expiracionDeContexto,
  LOGIN_TIMEOUT_MS,
  procesarJobDeSitio,
  SalidaDeRedNoDisponibleError,
} from '../src/sitios.js';
import type { NavegadorRemoto, RepositorioSitios, SitiosJobDeps } from '../src/sitios.js';
import { PermanentExecutionError } from '../src/errores.js';
import type { Logger } from '../src/logger.js';

const VAULT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const CONNECTION_ID = '99999999-9999-4999-8999-999999999999';

// El contexto en claro que JAMAS puede tocar la base ni los logs sin cifrar.
const CONTEXTO_PLANO = JSON.stringify({
  formato: 'cookies-cdp-v1',
  cookies: [{ name: 'session', value: 'cookie-secreta-del-usuario', domain: 'app.ejemplo.com' }],
});

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeJob(payload: unknown, overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    agentId: 'agent-1',
    ownerId: 'user-1',
    credentialId: 'cred-1',
    status: 'running',
    payload,
    scheduledFor: null,
    attempts: 1,
    lastError: null,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    startedAt: '2026-07-16T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

function makeSitio(overrides: Partial<SitioConectado> = {}): SitioConectado {
  return {
    id: CONNECTION_ID,
    ownerId: 'user-1',
    dominio: 'app.ejemplo.com',
    urlLogin: 'https://app.ejemplo.com/login',
    contextoExternoId: 'ctx-1',
    proxyRef: 'browserbase',
    proxyCountry: 'AR',
    proxyState: null,
    egressIp: '203.0.113.7',
    fingerprintRef: 'contexto:ctx-1',
    sesionExternaId: 'ses-1',
    vistaEnVivoUrl: 'https://live.browserbase.com/ses-1',
    estado: 'esperando_login',
    tieneContexto: false,
    creadoEn: '2026-07-16T00:00:00.000Z',
    ultimoUsoEn: null,
    expiraEn: null,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<RepositorioSitios> = {}): RepositorioSitios {
  return {
    obtenerPorDominio: vi.fn(async () => null),
    obtenerPorId: vi.fn(async () => null),
    registrarSesionDeLogin: vi.fn(async () => makeSitio()),
    pinearPais: vi.fn(async () => makeSitio()),
    reabrirParaLogin: vi.fn(async () => makeSitio()),
    guardarContexto: vi.fn(async () => makeSitio({ estado: 'activo', tieneContexto: true })),
    cerrarLogin: vi.fn(async () => makeSitio({ estado: 'error' })),
    listarEsperandoLoginVencidas: vi.fn(async () => []),
    borrar: vi.fn(async () => ({ id: CONNECTION_ID, dominio: 'app.ejemplo.com', contextoExternoId: 'ctx-1' })),
    ...overrides,
  };
}

function makeNavegador(overrides: Partial<NavegadorRemoto> = {}): NavegadorRemoto {
  return {
    abrirSesionParaLogin: vi.fn(async () => ({
      sesionExternaId: 'ses-nueva',
      contextoExternoId: 'ctx-nuevo',
      vistaEnVivoUrl: 'https://live.browserbase.com/ses-nueva',
      proxyRef: 'browserbase',
      egressIp: '203.0.113.7',
      egressCountry: 'AR',
      fingerprintRef: 'contexto:ctx-nuevo',
      expiraEn: '2026-07-16T00:15:00.000Z',
    })),
    estadoDeSesion: vi.fn(async () => 'viva' as const),
    extraerContexto: vi.fn(async () => CONTEXTO_PLANO),
    cerrarSesion: vi.fn(async () => {}),
    borrarContexto: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeDeps(
  repo: RepositorioSitios = makeRepo(),
  navegador: NavegadorRemoto = makeNavegador(),
): SitiosJobDeps {
  return {
    repo,
    navegador,
    vaultSecret: VAULT_SECRET,
    registrarDesconexionArco: vi.fn(async () => {}),
    logger: makeLogger(),
  };
}

describe('procesarJobDeSitio: guardas', () => {
  it('sin deps de sitios (falta env de Browserbase) falla PERMANENTE con mensaje accionable', async () => {
    const job = makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' });
    await expect(procesarJobDeSitio(undefined, job)).rejects.toThrow(PermanentExecutionError);
    await expect(procesarJobDeSitio(undefined, job)).rejects.toThrow(/BROWSERBASE_API_KEY/);
  });

  it('payload malformado falla PERMANENTE (no gasta reintentos)', async () => {
    const deps = makeDeps();
    const job = makeJob({ kind: 'conectar_sitio', url: 'no-es-una-url' });
    await expect(procesarJobDeSitio(deps, job)).rejects.toThrow(PermanentExecutionError);
    expect(deps.navegador.abrirSesionParaLogin).not.toHaveBeenCalled();
  });
});

describe('conectar_sitio', () => {
  it('abre la sesion con contexto NUEVO, persiste el registro pineado y TERMINA (sin esperar al humano)', async () => {
    const repo = makeRepo();
    const deps = makeDeps(repo);
    const job = makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login?next=/inicio', pais: 'AR' });

    const inicio = Date.now();
    await procesarJobDeSitio(deps, job);
    const duracionMs = Date.now() - inicio;

    // El job NO espera al humano: con puertos instantaneos termina de inmediato. Un sleep o un loop
    // de polling escondido en el handler rompe esta cota.
    expect(duracionMs).toBeLessThan(500);

    expect(deps.navegador.abrirSesionParaLogin).toHaveBeenCalledWith({
      url: 'https://app.ejemplo.com/login?next=/inicio',
      contextoExternoId: null,
      proxyRef: null,
      proxyCountry: 'AR',
    });
    expect(repo.registrarSesionDeLogin).toHaveBeenCalledWith({
      ownerId: 'user-1',
      dominio: 'app.ejemplo.com',
      urlLogin: 'https://app.ejemplo.com/login?next=/inicio',
      contextoExternoId: 'ctx-nuevo',
      proxyRef: 'browserbase',
      proxyCountry: 'AR',
      egressIp: '203.0.113.7',
      fingerprintRef: 'contexto:ctx-nuevo',
      sesionExternaId: 'ses-nueva',
      vistaEnVivoUrl: 'https://live.browserbase.com/ses-nueva',
    });
    expect(repo.reabrirParaLogin).not.toHaveBeenCalled();
    // La sesion queda VIVA para el humano: conectar jamas la cierra en el camino feliz.
    expect(deps.navegador.cerrarSesion).not.toHaveBeenCalled();
  });

  it('reconexion: reusa contexto, salida y PAIS PINEADOS, reabre la fila y NO re-pinea', async () => {
    const existente = makeSitio({ sesionExternaId: null, estado: 'error', proxyRef: 'browserbase' });
    const repo = makeRepo({ obtenerPorDominio: vi.fn(async () => existente) });
    const deps = makeDeps(repo);
    // El payload trae OTRO pais (el usuario viajo o cambio su navegador): el pin manda igual.
    await procesarJobDeSitio(deps, makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'BR' }));

    expect(deps.navegador.abrirSesionParaLogin).toHaveBeenCalledWith({
      url: 'https://app.ejemplo.com/login',
      contextoExternoId: 'ctx-1',
      proxyRef: 'browserbase',
      proxyCountry: 'AR',
    });
    expect(repo.reabrirParaLogin).toHaveBeenCalledWith(CONNECTION_ID, 'user-1', {
      urlLogin: 'https://app.ejemplo.com/login',
      sesionExternaId: 'ses-nueva',
      vistaEnVivoUrl: 'https://live.browserbase.com/ses-nueva',
    });
    expect(repo.registrarSesionDeLogin).not.toHaveBeenCalled();
    // El pais ya estaba pineado: JAMAS se reescribe.
    expect(repo.pinearPais).not.toHaveBeenCalled();
  });

  it('reconexion con IP DISTINTA pero MISMO pais: NO aborta (rotacion normal del pool)', async () => {
    const existente = makeSitio({ egressIp: '203.0.113.7', proxyCountry: 'AR', sesionExternaId: null });
    const repo = makeRepo({ obtenerPorDominio: vi.fn(async () => existente) });
    const navegador = makeNavegador({
      abrirSesionParaLogin: vi.fn(async () => ({
        sesionExternaId: 'ses-nueva',
        contextoExternoId: 'ctx-1',
        vistaEnVivoUrl: 'https://live.browserbase.com/ses-nueva',
        proxyRef: 'browserbase',
        egressIp: '198.51.100.9',
        egressCountry: 'AR',
        fingerprintRef: 'contexto:ctx-1',
        expiraEn: null,
      })),
    });
    const deps = makeDeps(repo, navegador);

    await procesarJobDeSitio(deps, makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' }));

    // La IP cambio (203.0.113.7 -> 198.51.100.9) pero el pais es el pineado: el flujo sigue.
    expect(repo.reabrirParaLogin).toHaveBeenCalled();
    expect(navegador.cerrarSesion).not.toHaveBeenCalled();
  });

  it('fila LEGADA sin pais pineado: pinea el pais del payload en la reconexion', async () => {
    const existente = makeSitio({ proxyCountry: null, sesionExternaId: null, estado: 'error' });
    const repo = makeRepo({ obtenerPorDominio: vi.fn(async () => existente) });
    const deps = makeDeps(repo);
    await procesarJobDeSitio(deps, makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' }));

    expect(deps.navegador.abrirSesionParaLogin).toHaveBeenCalledWith(
      expect.objectContaining({ proxyCountry: 'AR' }),
    );
    expect(repo.pinearPais).toHaveBeenCalledWith(CONNECTION_ID, 'user-1', 'AR');
  });

  it('PAIS observado DISTINTO al pineado: cierra la sesion y FALLA permanente, sin degradar', async () => {
    const existente = makeSitio({ proxyCountry: 'AR', sesionExternaId: null });
    const repo = makeRepo({ obtenerPorDominio: vi.fn(async () => existente) });
    const navegador = makeNavegador({
      abrirSesionParaLogin: vi.fn(async () => ({
        sesionExternaId: 'ses-nueva',
        contextoExternoId: 'ctx-1',
        vistaEnVivoUrl: 'https://live.browserbase.com/ses-nueva',
        proxyRef: 'browserbase',
        egressIp: '198.51.100.9',
        egressCountry: 'BR',
        fingerprintRef: 'contexto:ctx-1',
        expiraEn: null,
      })),
    });
    const deps = makeDeps(repo, navegador);

    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' })),
    ).rejects.toThrow(SalidaDeRedNoDisponibleError);
    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' })),
    ).rejects.toThrow(/no hay ruta de red disponible/);

    // Jamas se reintenta con otro pais. La sesion desviada se cierra y nada se persiste.
    expect(navegador.cerrarSesion).toHaveBeenCalledWith('ses-nueva');
    expect(repo.reabrirParaLogin).not.toHaveBeenCalled();
    expect(repo.registrarSesionDeLogin).not.toHaveBeenCalled();
  });

  it('conexion NUEVA cuyo pais observado no es el pedido (sin cobertura): falla claro, no degrada', async () => {
    const repo = makeRepo();
    const navegador = makeNavegador({
      abrirSesionParaLogin: vi.fn(async () => ({
        sesionExternaId: 'ses-nueva',
        contextoExternoId: 'ctx-nuevo',
        vistaEnVivoUrl: 'https://live.browserbase.com/ses-nueva',
        proxyRef: 'browserbase',
        egressIp: '198.51.100.9',
        // El proveedor enruto por el pais "mas cercano" por falta de cobertura: inaceptable.
        egressCountry: 'CL',
        fingerprintRef: 'contexto:ctx-nuevo',
        expiraEn: null,
      })),
    });
    const deps = makeDeps(repo, navegador);
    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' })),
    ).rejects.toThrow(/no hay ruta de red disponible.*[Rr]eintenta mas tarde/s);
    expect(navegador.cerrarSesion).toHaveBeenCalledWith('ses-nueva');
    expect(repo.registrarSesionDeLogin).not.toHaveBeenCalled();
  });

  it('pais NO OBSERVABLE: tambien falla (no se puede verificar el pin)', async () => {
    const existente = makeSitio({ proxyCountry: 'AR', sesionExternaId: null });
    const repo = makeRepo({ obtenerPorDominio: vi.fn(async () => existente) });
    const navegador = makeNavegador({
      abrirSesionParaLogin: vi.fn(async () => ({
        sesionExternaId: 'ses-nueva',
        contextoExternoId: 'ctx-1',
        vistaEnVivoUrl: 'https://live.browserbase.com/ses-nueva',
        proxyRef: 'browserbase',
        egressIp: null,
        egressCountry: null,
        fingerprintRef: null,
        expiraEn: null,
      })),
    });
    const deps = makeDeps(repo, navegador);
    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' })),
    ).rejects.toThrow(SalidaDeRedNoDisponibleError);
    expect(navegador.cerrarSesion).toHaveBeenCalledWith('ses-nueva');
  });

  it('el proveedor no puede abrir por la salida pineada: el fallo se propaga sin persistir nada', async () => {
    const existente = makeSitio({ sesionExternaId: null });
    const repo = makeRepo({ obtenerPorDominio: vi.fn(async () => existente) });
    const navegador = makeNavegador({
      abrirSesionParaLogin: vi.fn(async () => {
        throw new SalidaDeRedNoDisponibleError('el proxy pineado ya no esta configurado');
      }),
    });
    const deps = makeDeps(repo, navegador);
    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' })),
    ).rejects.toThrow(SalidaDeRedNoDisponibleError);
    expect(repo.reabrirParaLogin).not.toHaveBeenCalled();
    expect(repo.registrarSesionDeLogin).not.toHaveBeenCalled();
  });

  it('si persistir la fila falla, la sesion recien abierta se cierra (nunca queda colgada)', async () => {
    const repo = makeRepo({
      registrarSesionDeLogin: vi.fn(async () => {
        throw new Error('db caida');
      }),
    });
    const deps = makeDeps(repo);
    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' })),
    ).rejects.toThrow('db caida');
    expect(deps.navegador.cerrarSesion).toHaveBeenCalledWith('ses-nueva');
  });

  it('si habia un login previo en curso, cierra su sesion vieja antes de abrir la nueva', async () => {
    const existente = makeSitio({ sesionExternaId: 'ses-vieja' });
    const repo = makeRepo({ obtenerPorDominio: vi.fn(async () => existente) });
    const deps = makeDeps(repo);
    await procesarJobDeSitio(deps, makeJob({ kind: 'conectar_sitio', url: 'https://app.ejemplo.com/login', pais: 'AR' }));
    expect(deps.navegador.cerrarSesion).toHaveBeenCalledWith('ses-vieja');
  });
});

describe('confirmar_conexion', () => {
  it('sesion viva: extrae el contexto, lo pasa a CIFRAR al repo (jamas a logs) y cierra la sesion', async () => {
    const sitio = makeSitio();
    const repo = makeRepo({ obtenerPorId: vi.fn(async () => sitio) });
    const deps = makeDeps(repo);
    const logger = deps.logger;

    await procesarJobDeSitio(deps, makeJob({ kind: 'confirmar_conexion', connectionId: CONNECTION_ID }));

    // El claro va SOLO al repositorio, junto al secreto de la boveda: el repo cifra antes de tocar
    // la base (cubierto en apps/backend/test/sitios-conectados-repository.test.ts).
    expect(repo.guardarContexto).toHaveBeenCalledTimes(1);
    const [id, owner, input, secreto] = (repo.guardarContexto as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      { contexto: string; contextoExternoId?: string | null; egressIp?: string | null; expiraEn?: string | null },
      string,
    ];
    expect(id).toBe(CONNECTION_ID);
    expect(owner).toBe('user-1');
    expect(secreto).toBe(VAULT_SECRET);
    expect(input.contexto).toBe(CONTEXTO_PLANO);
    // La terna pineada viaja tal cual quedo en la fila (no se re-observa en confirmar).
    expect(input.contextoExternoId).toBe('ctx-1');
    expect(input.egressIp).toBe('203.0.113.7');
    // expira_en: default 30 dias desde ahora.
    const expira = new Date(input.expiraEn as string).getTime();
    expect(expira).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    expect(expira).toBeLessThan(Date.now() + 31 * 24 * 60 * 60 * 1000);

    // La sesion del proveedor se cierra AL FINAL (persiste el contexto de su lado al cerrar).
    expect(deps.navegador.cerrarSesion).toHaveBeenCalledWith('ses-1');

    // NINGUN log contiene el contexto en claro (ni la cookie que viaja adentro).
    for (const fn of [logger.debug, logger.info, logger.warn, logger.error]) {
      for (const llamada of (fn as ReturnType<typeof vi.fn>).mock.calls) {
        expect(JSON.stringify(llamada)).not.toContain('cookie-secreta-del-usuario');
      }
    }
  });

  it('sesion ya muerta: marca la fila error y falla PERMANENTE con mensaje accionable', async () => {
    const sitio = makeSitio();
    const repo = makeRepo({ obtenerPorId: vi.fn(async () => sitio) });
    const navegador = makeNavegador({ estadoDeSesion: vi.fn(async () => 'muerta' as const) });
    const deps = makeDeps(repo, navegador);

    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'confirmar_conexion', connectionId: CONNECTION_ID })),
    ).rejects.toThrow(/expiro sin confirmarse/);
    expect(repo.cerrarLogin).toHaveBeenCalledWith(CONNECTION_ID, 'user-1', 'error');
    expect(navegador.extraerContexto).not.toHaveBeenCalled();
    expect(repo.guardarContexto).not.toHaveBeenCalled();
  });

  it('conexion inexistente o sin login en curso: fallo permanente', async () => {
    const deps = makeDeps();
    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'confirmar_conexion', connectionId: CONNECTION_ID })),
    ).rejects.toThrow(PermanentExecutionError);

    const repo = makeRepo({ obtenerPorId: vi.fn(async () => makeSitio({ estado: 'activo', sesionExternaId: null })) });
    const deps2 = makeDeps(repo);
    await expect(
      procesarJobDeSitio(deps2, makeJob({ kind: 'confirmar_conexion', connectionId: CONNECTION_ID })),
    ).rejects.toThrow(/no tiene un login en curso/);
  });
});

describe('desconectar_sitio (borrado ARCO)', () => {
  it('borra en los TRES lados y encadena con data_subject_requests, en orden seguro', async () => {
    const orden: string[] = [];
    const sitio = makeSitio();
    const repo = makeRepo({
      obtenerPorId: vi.fn(async () => sitio),
      borrar: vi.fn(async () => {
        orden.push('borrar-fila');
        return { id: CONNECTION_ID, dominio: 'app.ejemplo.com', contextoExternoId: 'ctx-1' };
      }),
    });
    const navegador = makeNavegador({
      borrarContexto: vi.fn(async () => {
        orden.push('borrar-contexto-proveedor');
      }),
    });
    const deps = makeDeps(repo, navegador);
    (deps.registrarDesconexionArco as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      orden.push('arco');
    });

    await procesarJobDeSitio(deps, makeJob({ kind: 'desconectar_sitio', connectionId: CONNECTION_ID }));

    expect(navegador.cerrarSesion).toHaveBeenCalledWith('ses-1');
    expect(navegador.borrarContexto).toHaveBeenCalledWith('ctx-1');
    expect(deps.registrarDesconexionArco).toHaveBeenCalledWith('user-1', 'app.ejemplo.com');
    expect(repo.borrar).toHaveBeenCalledWith(CONNECTION_ID, 'user-1');
    // Proveedor primero, ARCO antes del borrado local: un fallo intermedio deja rastro, no un hueco.
    expect(orden).toEqual(['borrar-contexto-proveedor', 'arco', 'borrar-fila']);
  });

  it('si el proveedor falla al borrar el contexto, el job falla (no queda contexto huerfano alla)', async () => {
    const repo = makeRepo({ obtenerPorId: vi.fn(async () => makeSitio()) });
    const navegador = makeNavegador({
      borrarContexto: vi.fn(async () => {
        throw new Error('api del proveedor caida');
      }),
    });
    const deps = makeDeps(repo, navegador);
    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'desconectar_sitio', connectionId: CONNECTION_ID })),
    ).rejects.toThrow('api del proveedor caida');
    expect(repo.borrar).not.toHaveBeenCalled();
  });

  it('contexto ya inexistente en el proveedor (404): EXITO, completa ARCO y borra la fila local', async () => {
    // El mock imita el NotFoundError del SDK de Browserbase: un error con status 404.
    const notFound = Object.assign(new Error('404 Context not found'), { status: 404 });
    const repo = makeRepo({ obtenerPorId: vi.fn(async () => makeSitio()) });
    const navegador = makeNavegador({
      borrarContexto: vi.fn(async () => {
        throw notFound;
      }),
    });
    const deps = makeDeps(repo, navegador);

    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'desconectar_sitio', connectionId: CONNECTION_ID })),
    ).resolves.toBeUndefined();

    // El ARCO se registra y la fila local se borra AUNQUE el proveedor ya no tuviera nada que borrar.
    expect(deps.registrarDesconexionArco).toHaveBeenCalledWith('user-1', 'app.ejemplo.com');
    expect(repo.borrar).toHaveBeenCalledWith(CONNECTION_ID, 'user-1');
  });

  it('desconecta desde estado error SIN sesion viva: no toca sesiones y borra igual', async () => {
    const repo = makeRepo({
      obtenerPorId: vi.fn(async () => makeSitio({ estado: 'error', sesionExternaId: null })),
    });
    const navegador = makeNavegador({
      borrarContexto: vi.fn(async () => {
        throw Object.assign(new Error('context not found'), { statusCode: 404 });
      }),
    });
    const deps = makeDeps(repo, navegador);

    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'desconectar_sitio', connectionId: CONNECTION_ID })),
    ).resolves.toBeUndefined();

    expect(navegador.cerrarSesion).not.toHaveBeenCalled();
    expect(deps.registrarDesconexionArco).toHaveBeenCalledWith('user-1', 'app.ejemplo.com');
    expect(repo.borrar).toHaveBeenCalledWith(CONNECTION_ID, 'user-1');
  });

  it('desconecta desde esperando_login con la sesion ya muerta: cerrarSesion falla y se sigue igual', async () => {
    const repo = makeRepo({
      obtenerPorId: vi.fn(async () => makeSitio({ estado: 'esperando_login' })),
    });
    const navegador = makeNavegador({
      cerrarSesion: vi.fn(async () => {
        throw Object.assign(new Error('Session not found'), { status: 404 });
      }),
    });
    const deps = makeDeps(repo, navegador);

    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'desconectar_sitio', connectionId: CONNECTION_ID })),
    ).resolves.toBeUndefined();

    expect(navegador.borrarContexto).toHaveBeenCalledWith('ctx-1');
    expect(deps.registrarDesconexionArco).toHaveBeenCalledWith('user-1', 'app.ejemplo.com');
    expect(repo.borrar).toHaveBeenCalledWith(CONNECTION_ID, 'user-1');
  });

  it('conexion ya inexistente: no-op idempotente (un reintento no falla)', async () => {
    const deps = makeDeps();
    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'desconectar_sitio', connectionId: CONNECTION_ID })),
    ).resolves.toBeUndefined();
    expect(deps.registrarDesconexionArco).not.toHaveBeenCalled();
  });
});

describe('desconectar_sitio FORZADO (force: true, el borrado garantizado)', () => {
  const jobForzado = () =>
    makeJob({ kind: 'desconectar_sitio', connectionId: CONNECTION_ID, force: true });

  // LA GARANTIA CENTRAL: ningun fallo del proveedor detiene el borrado local ni el ARCO. Se cubren
  // las tres formas tipicas: 404 (recurso ya inexistente), 5xx (proveedor roto) y timeout de red.
  it.each([
    ['contexto ya inexistente (404)', Object.assign(new Error('404 Context not found'), { status: 404 })],
    ['proveedor caido (500)', Object.assign(new Error('internal server error'), { status: 500 })],
    ['timeout de red', Object.assign(new Error('Request timed out'), { name: 'APIConnectionTimeoutError' })],
  ])('con el proveedor fallando (%s): completa ARCO y borra la fila local', async (_caso, fallo) => {
    const repo = makeRepo({ obtenerPorId: vi.fn(async () => makeSitio()) });
    const navegador = makeNavegador({
      cerrarSesion: vi.fn(async () => {
        throw fallo;
      }),
      borrarContexto: vi.fn(async () => {
        throw fallo;
      }),
    });
    const deps = makeDeps(repo, navegador);

    await expect(procesarJobDeSitio(deps, jobForzado())).resolves.toBeUndefined();

    expect(deps.registrarDesconexionArco).toHaveBeenCalledWith('user-1', 'app.ejemplo.com');
    expect(repo.borrar).toHaveBeenCalledWith(CONNECTION_ID, 'user-1');
  });

  it('el intento sobre el proveedor SI se hace (best-effort) y el fallo queda logueado', async () => {
    const repo = makeRepo({ obtenerPorId: vi.fn(async () => makeSitio()) });
    const navegador = makeNavegador({
      borrarContexto: vi.fn(async () => {
        throw new Error('api del proveedor caida');
      }),
    });
    const deps = makeDeps(repo, navegador);

    await procesarJobDeSitio(deps, jobForzado());

    expect(navegador.cerrarSesion).toHaveBeenCalledWith('ses-1');
    expect(navegador.borrarContexto).toHaveBeenCalledWith('ctx-1');
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('desconectar forzado'),
      expect.objectContaining({ connectionId: CONNECTION_ID }),
    );
  });

  // El borrado forzado funciona DESDE CUALQUIER estado de la conexion, con o sin sesion viva.
  it.each(['activo', 'esperando_login', 'error', 'caducado'] as const)(
    'desde estado %s con el proveedor caido: la fila local se borra igual',
    async (estado) => {
      const sitio = makeSitio({
        estado,
        sesionExternaId: estado === 'esperando_login' ? 'ses-1' : null,
      });
      const repo = makeRepo({ obtenerPorId: vi.fn(async () => sitio) });
      const navegador = makeNavegador({
        cerrarSesion: vi.fn(async () => {
          throw new Error('provider unreachable');
        }),
        borrarContexto: vi.fn(async () => {
          throw new Error('provider unreachable');
        }),
      });
      const deps = makeDeps(repo, navegador);

      await expect(procesarJobDeSitio(deps, jobForzado())).resolves.toBeUndefined();
      expect(deps.registrarDesconexionArco).toHaveBeenCalledWith('user-1', 'app.ejemplo.com');
      expect(repo.borrar).toHaveBeenCalledWith(CONNECTION_ID, 'user-1');
    },
  );

  it('los fallos de la PROPIA plataforma (ARCO) siguen fallando el job: force solo cubre al proveedor', async () => {
    const repo = makeRepo({ obtenerPorId: vi.fn(async () => makeSitio()) });
    const deps = makeDeps(repo);
    (deps.registrarDesconexionArco as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new Error('db caida');
    });

    await expect(procesarJobDeSitio(deps, jobForzado())).rejects.toThrow('db caida');
    expect(repo.borrar).not.toHaveBeenCalled();
  });

  it('sin force, el fallo real del proveedor sigue frenando el borrado (el flujo limpio no cambia)', async () => {
    const repo = makeRepo({ obtenerPorId: vi.fn(async () => makeSitio()) });
    const navegador = makeNavegador({
      borrarContexto: vi.fn(async () => {
        throw new Error('api del proveedor caida');
      }),
    });
    const deps = makeDeps(repo, navegador);
    await expect(
      procesarJobDeSitio(deps, makeJob({ kind: 'desconectar_sitio', connectionId: CONNECTION_ID })),
    ).rejects.toThrow('api del proveedor caida');
    expect(repo.borrar).not.toHaveBeenCalled();
  });
});

describe('esErrorDeRecursoInexistente', () => {
  it('reconoce 404 por status, por statusCode y por mensaje not found', () => {
    expect(esErrorDeRecursoInexistente(Object.assign(new Error('x'), { status: 404 }))).toBe(true);
    expect(esErrorDeRecursoInexistente(Object.assign(new Error('x'), { statusCode: 404 }))).toBe(true);
    expect(esErrorDeRecursoInexistente(new Error('Context not found'))).toBe(true);
    const conNombre = new Error('no such context');
    conNombre.name = 'NotFoundError';
    expect(esErrorDeRecursoInexistente(conNombre)).toBe(true);
  });

  it('NO trata como inexistente los fallos reales de red o permisos', () => {
    expect(esErrorDeRecursoInexistente(new Error('api del proveedor caida'))).toBe(false);
    expect(esErrorDeRecursoInexistente(Object.assign(new Error('forbidden'), { status: 403 }))).toBe(false);
    expect(esErrorDeRecursoInexistente(Object.assign(new Error('timeout'), { status: 500 }))).toBe(false);
    expect(esErrorDeRecursoInexistente(null)).toBe(false);
    expect(esErrorDeRecursoInexistente('not found')).toBe(false);
  });
});

describe('barrido de logins vencidos', () => {
  it('pide las filas anteriores al corte de 10 minutos, cierra cada sesion y marca error', async () => {
    const ahora = new Date('2026-07-16T12:00:00.000Z');
    const repo = makeRepo({
      listarEsperandoLoginVencidas: vi.fn(async () => [
        { id: 'c-1', ownerId: 'user-1', sesionExternaId: 'ses-1' },
        { id: 'c-2', ownerId: 'user-2', sesionExternaId: null },
      ]),
    });
    const deps = makeDeps(repo);

    await barrerLoginsVencidos(deps, ahora);

    expect(repo.listarEsperandoLoginVencidas).toHaveBeenCalledWith(
      new Date(ahora.getTime() - LOGIN_TIMEOUT_MS).toISOString(),
    );
    expect(deps.navegador.cerrarSesion).toHaveBeenCalledTimes(1);
    expect(deps.navegador.cerrarSesion).toHaveBeenCalledWith('ses-1');
    expect(repo.cerrarLogin).toHaveBeenCalledWith('c-1', 'user-1', 'error');
    expect(repo.cerrarLogin).toHaveBeenCalledWith('c-2', 'user-2', 'error');
  });

  it('un fallo al cerrar la sesion NO impide marcar la fila (y viceversa no rompe el barrido)', async () => {
    const repo = makeRepo({
      listarEsperandoLoginVencidas: vi.fn(async () => [
        { id: 'c-1', ownerId: 'user-1', sesionExternaId: 'ses-rota' },
      ]),
    });
    const navegador = makeNavegador({
      cerrarSesion: vi.fn(async () => {
        throw new Error('sesion ya no existe');
      }),
    });
    const deps = makeDeps(repo, navegador);
    await barrerLoginsVencidos(deps, new Date());
    expect(repo.cerrarLogin).toHaveBeenCalledWith('c-1', 'user-1', 'error');
  });
});

describe('expiracionDeContexto', () => {
  it('usa el default de 30 dias para dominios sin TTL propio', () => {
    const ahora = new Date('2026-07-16T00:00:00.000Z');
    const esperado = new Date(
      ahora.getTime() + CONTEXTO_TTL_DIAS_DEFAULT * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(expiracionDeContexto('cualquier.dominio.com', ahora)).toBe(esperado);
  });
});
