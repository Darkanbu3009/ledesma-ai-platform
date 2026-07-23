// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { webcrypto } from 'node:crypto';
import { mintRelayToken } from '@ledesma-platform/shared/relay-token';
import { codificarTexto, codificarTecla } from '@ledesma-platform/shared/relay-protocol';
import { SesionRelay, type CdpInyector, type SocketRelay, type DepsSesion } from '../src/session.js';
import { RegistroUsoUnico } from '../src/single-use.js';
import { LimitadorRelay } from '../src/rate-limit.js';
import type { MetadatosAuditoria } from '../src/logger.js';
import { crearClienteFake, cifrarFrame } from './cliente-fake.js';

const SECRET = 'r'.repeat(48);
const CLAVE_SECRETA = 'clave-secreta-hunter2-!';

function crearSocket() {
  const enviados: string[] = [];
  let cerrado = false;
  const socket: SocketRelay = {
    enviar: (texto) => enviados.push(texto),
    cerrar: () => {
      cerrado = true;
    },
  };
  return {
    socket,
    enviados,
    get cerrado() {
      return cerrado;
    },
    ultimo(tipo: string): Record<string, unknown> | undefined {
      for (let i = enviados.length - 1; i >= 0; i -= 1) {
        const obj = JSON.parse(enviados[i] as string) as Record<string, unknown>;
        if (obj.t === tipo) return obj;
      }
      return undefined;
    },
  };
}

interface FakeCdp extends CdpInyector {
  textos: string[];
  teclas: string[];
  cerrado: boolean;
}

function crearCdp(opciones: { fallaInsertar?: boolean } = {}): FakeCdp {
  const cdp: FakeCdp = {
    textos: [],
    teclas: [],
    cerrado: false,
    async attachAPagina() {
      return 'cdp-sess-1';
    },
    async insertarTexto(texto: string) {
      if (opciones.fallaInsertar) throw new Error('fallo CDP inyectando');
      cdp.textos.push(texto);
    },
    async despacharTecla(tecla) {
      cdp.teclas.push(tecla);
    },
    cerrar() {
      cdp.cerrado = true;
    },
  };
  return cdp;
}

/** Logger que captura TODA la salida en un array (para probar que jamas contiene pulsaciones). */
function crearLoggerCaptura() {
  const lineas: string[] = [];
  const push = (nivel: string, evento: string, meta?: MetadatosAuditoria) =>
    lineas.push(JSON.stringify({ nivel, evento, ...(meta ?? {}) }));
  return {
    lineas,
    logger: {
      debug: (e: string, m?: MetadatosAuditoria) => push('debug', e, m),
      info: (e: string, m?: MetadatosAuditoria) => push('info', e, m),
      warn: (e: string, m?: MetadatosAuditoria) => push('warn', e, m),
      error: (e: string, m?: MetadatosAuditoria) => push('error', e, m),
    },
  };
}

function montar(overrides: Partial<DepsSesion> = {}) {
  const s = crearSocket();
  const cdp = overrides.crearCdp ? undefined : crearCdp();
  const captura = crearLoggerCaptura();
  const usoUnico = new RegistroUsoUnico();
  const limitador = new LimitadorRelay();
  const deps: DepsSesion = {
    socket: s.socket,
    origen: 'https://app.ledesma.example',
    relayTokenSecret: SECRET,
    usoUnico,
    limitador,
    logger: captura.logger,
    resolverConnectUrl: async () => 'wss://connect.fake/abc',
    crearCdp: async () => cdp as CdpInyector,
    // Amplios por defecto: el handshake WebCrypto de los tests es lento; los tests de timeout
    // pasan sus propios valores chicos.
    handshakeTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    ...overrides,
  };
  const sesion = new SesionRelay(deps);
  sesion.iniciar();
  return { sesion, socket: s, cdp: cdp as FakeCdp, captura, usoUnico, limitador };
}

/** Corre el handshake completo (WebCrypto) y deja el canal en 'ready'. Devuelve la clave AES del cliente. */
async function establecer(
  ctx: ReturnType<typeof montar>,
  token: string,
): Promise<webcrypto.CryptoKey> {
  const srvHello = ctx.socket.ultimo('srv_hello');
  expect(srvHello).toBeDefined();
  const cliente = await crearClienteFake();
  const clave = await cliente.derivarClave(srvHello?.pub as string);
  ctx.sesion.recibir(JSON.stringify({ t: 'cli_hello', pub: cliente.pubB64, token }));
  await vi.waitFor(() => expect(ctx.socket.ultimo('ready')).toBeDefined());
  return clave;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handshake ECDH y descifrado de pulsaciones', () => {
  it('establece clave y descifra: el texto tecleado llega a CDP', async () => {
    const ctx = montar();
    const token = mintRelayToken(
      { ownerId: 'own_1', connectionId: 'con_1', sesionExternaId: 'ses_1' },
      SECRET,
    ).token;
    const clave = await establecer(ctx, token);

    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 1, ct: await cifrarFrame(clave, 1, codificarTexto(CLAVE_SECRETA)) }));
    await vi.waitFor(() => expect(ctx.cdp.textos.length).toBe(1));
    expect(ctx.cdp.textos[0]).toBe(CLAVE_SECRETA);

    ctx.sesion.cerrar('fin_test');
  });

  it('reenvia varias pulsaciones EN ORDEN y las teclas de control', async () => {
    const ctx = montar();
    const token = mintRelayToken({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' }, SECRET).token;
    const clave = await establecer(ctx, token);

    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 1, ct: await cifrarFrame(clave, 1, codificarTexto('ab')) }));
    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 2, ct: await cifrarFrame(clave, 2, codificarTecla('Tab')) }));
    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 3, ct: await cifrarFrame(clave, 3, codificarTexto('cd')) }));
    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 4, ct: await cifrarFrame(clave, 4, codificarTecla('Enter')) }));

    await vi.waitFor(() => expect(ctx.cdp.textos.length).toBe(2));
    expect(ctx.cdp.textos).toEqual(['ab', 'cd']);
    expect(ctx.cdp.teclas).toEqual(['Tab', 'Enter']);

    ctx.sesion.cerrar('fin_test');
  });
});

describe('anti replay / reordenamiento (contador monotono)', () => {
  it('rechaza un contador repetido', async () => {
    const ctx = montar();
    const token = mintRelayToken({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' }, SECRET).token;
    const clave = await establecer(ctx, token);
    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 1, ct: await cifrarFrame(clave, 1, codificarTexto('a')) }));
    await vi.waitFor(() => expect(ctx.cdp.textos.length).toBe(1));
    // Reusar el contador 1: rechazado y el canal se cierra.
    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 1, ct: await cifrarFrame(clave, 1, codificarTexto('b')) }));
    expect(ctx.socket.ultimo('error')?.code).toBe('contador');
    expect(ctx.socket.cerrado).toBe(true);
  });

  it('rechaza un contador fuera de orden (menor al ultimo)', async () => {
    const ctx = montar();
    const token = mintRelayToken({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' }, SECRET).token;
    const clave = await establecer(ctx, token);
    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 5, ct: await cifrarFrame(clave, 5, codificarTexto('a')) }));
    await vi.waitFor(() => expect(ctx.cdp.textos.length).toBe(1));
    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 3, ct: await cifrarFrame(clave, 3, codificarTexto('b')) }));
    expect(ctx.socket.ultimo('error')?.code).toBe('contador');
  });

  it('rechaza un frame manipulado (tag GCM no autentica)', async () => {
    const ctx = montar();
    const token = mintRelayToken({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' }, SECRET).token;
    const clave = await establecer(ctx, token);
    const bueno = await cifrarFrame(clave, 1, codificarTexto('a'));
    const bytes = Buffer.from(bueno, 'base64url');
    bytes[0] = (bytes[0] ?? 0) ^ 0x01;
    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 1, ct: bytes.toString('base64url') }));
    await vi.waitFor(() => expect(ctx.socket.ultimo('error')?.code).toBe('descifrado'));
    expect(ctx.cdp.textos.length).toBe(0);
  });
});

describe('token: uso unico, secreto, expiracion', () => {
  it('rechaza un token con otro secreto (o de otro owner que no verifica)', async () => {
    const ctx = montar();
    const ajeno = mintRelayToken(
      { ownerId: 'otro', connectionId: 'c', sesionExternaId: 's' },
      'z'.repeat(48),
    ).token;
    const cliente = await crearClienteFake();
    ctx.sesion.recibir(JSON.stringify({ t: 'cli_hello', pub: cliente.pubB64, token: ajeno }));
    expect(ctx.socket.ultimo('error')?.code).toBe('token_invalido');
    expect(ctx.socket.cerrado).toBe(true);
  });

  it('rechaza el REUSO del mismo token (jti de un solo uso)', async () => {
    const usoUnico = new RegistroUsoUnico();
    const limitador = new LimitadorRelay();
    const token = mintRelayToken({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' }, SECRET).token;

    const ctx1 = montar({ usoUnico, limitador });
    await establecer(ctx1, token);
    ctx1.sesion.cerrar('fin'); // libera el cupo pero el jti queda consumido

    const ctx2 = montar({ usoUnico, limitador });
    const cliente = await crearClienteFake();
    ctx2.sesion.recibir(JSON.stringify({ t: 'cli_hello', pub: cliente.pubB64, token }));
    expect(ctx2.socket.ultimo('error')?.code).toBe('reuso');
  });

  it('rechaza un token expirado', async () => {
    const ctx = montar();
    const token = mintRelayToken(
      { ownerId: 'o', connectionId: 'c', sesionExternaId: 's', ttlSeconds: 1, nowSeconds: 1000 },
      SECRET,
    ).token;
    // verifyRelayToken usa el reloj real: un token acunado "en el pasado" ya expiro.
    const cliente = await crearClienteFake();
    ctx.sesion.recibir(JSON.stringify({ t: 'cli_hello', pub: cliente.pubB64, token }));
    expect(ctx.socket.ultimo('error')?.code).toBe('token_invalido');
  });
});

describe('ciclo de vida: cierre al confirmar, cancelar y por timeout', () => {
  it('al cerrar el socket (confirmar/cancelar) cierra el CDP y libera el cupo', async () => {
    const limitador = new LimitadorRelay();
    const ctx = montar({ limitador });
    const token = mintRelayToken({ ownerId: 'own_x', connectionId: 'con_x', sesionExternaId: 's' }, SECRET).token;
    await establecer(ctx, token);
    // Una segunda sesion a la MISMA conexion estaria bloqueada mientras esta viva.
    expect(limitador.intentar('own_x', 'con_x')).toEqual({ ok: false, motivo: 'conexion_ocupada' });

    ctx.sesion.alCerrarSocket();
    expect(ctx.cdp.cerrado).toBe(true);
    // El cupo se libero: ahora otra sesion a la misma conexion es admisible.
    expect(limitador.intentar('own_x', 'con_x')).toEqual({ ok: true });
  });

  it('cierra por timeout de handshake si el cliente no completa el hello', async () => {
    const ctx = montar({ handshakeTimeoutMs: 20 });
    await vi.waitFor(() => expect(ctx.socket.cerrado).toBe(true), { timeout: 500 });
  });

  it('cierra por idle tras establecer y quedar sin actividad', async () => {
    const ctx = montar({ idleTimeoutMs: 25 });
    const token = mintRelayToken({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' }, SECRET).token;
    await establecer(ctx, token);
    await vi.waitFor(() => expect(ctx.cdp.cerrado).toBe(true), { timeout: 500 });
  });
});

describe('CRITICO: ninguna pulsacion aparece en ningun log', () => {
  it('ni en operacion normal ni ante un error forzado de reenvio', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // CDP que FALLA al insertar: fuerza el camino de error DESPUES de descifrar el texto plano.
    const cdpFalla = crearCdp({ fallaInsertar: true });
    const ctx = montar({ crearCdp: async () => cdpFalla });
    const token = mintRelayToken({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' }, SECRET).token;
    const clave = await establecer(ctx, token);

    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 1, ct: await cifrarFrame(clave, 1, codificarTexto(CLAVE_SECRETA)) }));
    // El reenvio falla y el canal se cierra; el texto plano se descifro pero NO debe filtrarse.
    await vi.waitFor(() => expect(ctx.socket.cerrado).toBe(true));

    const todaLaSalida = [
      ...ctx.captura.lineas,
      ...errSpy.mock.calls.flat().map(String),
      ...logSpy.mock.calls.flat().map(String),
      ...warnSpy.mock.calls.flat().map(String),
    ].join('\n');

    expect(todaLaSalida).not.toContain(CLAVE_SECRETA);
    expect(todaLaSalida).not.toContain('wss://connect.fake'); // el connectUrl tampoco
    // Y aun asi hubo auditoria de METADATOS (el cierre se registro).
    expect(ctx.captura.lineas.some((l) => l.includes('relay_cerrado'))).toBe(true);
  });
});
