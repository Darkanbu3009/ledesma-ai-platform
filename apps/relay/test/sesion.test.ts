// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { webcrypto } from 'node:crypto';
import { mintRelayToken } from '@ledesma-platform/shared/relay-token';
import { codificarTexto, codificarTecla } from '@ledesma-platform/shared/relay-protocol';
import { SesionRelay, type CdpInyector, type SocketRelay, type DepsSesion } from '../src/session.js';
import { AutoridadEnMemoria } from '../src/autoridad.js';
import { LimitadorRelay } from '../src/rate-limit.js';
import type { MetadatosAuditoria } from '../src/logger.js';
import { crearClienteFake, cifrarFrame, type ClienteFake } from './cliente-fake.js';

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
  const autoridad = new AutoridadEnMemoria();
  const limitador = new LimitadorRelay();
  const deps: DepsSesion = {
    socket: s.socket,
    origen: 'https://app.ledesma.example',
    relayTokenSecret: SECRET,
    autoridad,
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
  return { sesion, socket: s, cdp: cdp as FakeCdp, captura, autoridad, limitador };
}

/** Un token recien acunado con su secreto de enlace (hs) para las MAC del handshake. */
function acunar(params: { ownerId?: string; connectionId?: string; sesionExternaId?: string } = {}) {
  return mintRelayToken(
    {
      ownerId: params.ownerId ?? 'own_1',
      connectionId: params.connectionId ?? 'con_1',
      sesionExternaId: params.sesionExternaId ?? 'ses_1',
    },
    SECRET,
  );
}

/** Envia un cli_hello BIEN FORMADO (con MAC del cliente valida). Devuelve el cliente y la publica del relay. */
async function enviarHello(
  ctx: ReturnType<typeof montar>,
  token: string,
  hs: string,
): Promise<{ cliente: ClienteFake; relayPub: string }> {
  const srvHello = ctx.socket.ultimo('srv_hello');
  expect(srvHello).toBeDefined();
  const relayPub = srvHello?.pub as string;
  const cliente = await crearClienteFake();
  const mac = await cliente.macCliente(relayPub, token, hs);
  ctx.sesion.recibir(JSON.stringify({ t: 'cli_hello', pub: cliente.pubB64, token, mac }));
  return { cliente, relayPub };
}

/** Corre el handshake completo y deja el canal en 'ready'. Devuelve la clave AES del cliente. */
async function establecer(
  ctx: ReturnType<typeof montar>,
  token: string,
  hs: string,
): Promise<webcrypto.CryptoKey> {
  const srvHello = ctx.socket.ultimo('srv_hello');
  expect(srvHello).toBeDefined();
  const relayPub = srvHello?.pub as string;
  const cliente = await crearClienteFake();
  const clave = await cliente.derivarClave(relayPub);
  const mac = await cliente.macCliente(relayPub, token, hs);
  ctx.sesion.recibir(JSON.stringify({ t: 'cli_hello', pub: cliente.pubB64, token, mac }));
  await vi.waitFor(() => expect(ctx.socket.ultimo('ready')).toBeDefined());
  // Interop: el cliente (WebCrypto) verifica la MAC del relay (node:crypto) del ready.
  const ready = ctx.socket.ultimo('ready');
  expect(await cliente.verificarMacRelay(relayPub, token, hs, ready?.mac as string)).toBe(true);
  return clave;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handshake ECDH autenticado y descifrado de pulsaciones', () => {
  it('establece clave, el ready lleva MAC del relay valida y el texto tecleado llega a CDP', async () => {
    const ctx = montar();
    const { token, bindingKey } = acunar();
    const clave = await establecer(ctx, token, bindingKey);

    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 1, ct: await cifrarFrame(clave, 1, codificarTexto(CLAVE_SECRETA)) }));
    await vi.waitFor(() => expect(ctx.cdp.textos.length).toBe(1));
    expect(ctx.cdp.textos[0]).toBe(CLAVE_SECRETA);

    ctx.sesion.cerrar('fin_test');
  });

  it('reenvia varias pulsaciones EN ORDEN y las teclas de control', async () => {
    const ctx = montar();
    const { token, bindingKey } = acunar({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' });
    const clave = await establecer(ctx, token, bindingKey);

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

describe('A-1: el handshake detecta la SUSTITUCION de llaves publicas (MITM)', () => {
  it('RECHAZA si un MITM sustituye la publica del CLIENTE (mac del cliente legitimo, otra publica)', async () => {
    const ctx = montar();
    const { token, bindingKey } = acunar();
    const srvHello = ctx.socket.ultimo('srv_hello');
    const relayPub = srvHello?.pub as string;
    const legitimo = await crearClienteFake();
    const atacante = await crearClienteFake();
    // El cliente legitimo firma sobre SU publica; el MITM cambia la publica por la suya, conservando la
    // MAC. El relay recomputa el transcript con la publica RECIBIDA (la del atacante) -> no coincide.
    const macLegitima = await legitimo.macCliente(relayPub, token, bindingKey);
    ctx.sesion.recibir(JSON.stringify({ t: 'cli_hello', pub: atacante.pubB64, token, mac: macLegitima }));
    expect(ctx.socket.ultimo('error')?.code).toBe('handshake_no_autenticado');
    expect(ctx.socket.cerrado).toBe(true);
  });

  it('RECHAZA si un MITM sustituye la publica del RELAY (el cliente firmo sobre otra publica del relay)', async () => {
    const ctx = montar();
    const { token, bindingKey } = acunar();
    const relayPubReal = ctx.socket.ultimo('srv_hello')?.pub as string;
    const cliente = await crearClienteFake();
    // El MITM le mostro al cliente una publica FALSA del relay: el cliente firma sobre esa, no sobre la
    // real. El relay recomputa con SU publica real -> el transcript difiere -> MAC invalida.
    const relayPubFalsa = (await crearClienteFake()).pubB64; // cualquier otra publica sirve de senuelo
    expect(relayPubFalsa).not.toBe(relayPubReal);
    const mac = await cliente.macCliente(relayPubFalsa, token, bindingKey);
    ctx.sesion.recibir(JSON.stringify({ t: 'cli_hello', pub: cliente.pubB64, token, mac }));
    expect(ctx.socket.ultimo('error')?.code).toBe('handshake_no_autenticado');
    expect(ctx.socket.cerrado).toBe(true);
  });

  it('RECHAZA una MAC forjada sin conocer el secreto de enlace (hs)', async () => {
    const ctx = montar();
    const { token } = acunar();
    const relayPub = ctx.socket.ultimo('srv_hello')?.pub as string;
    const cliente = await crearClienteFake();
    // Atacante sin `hs`: usa un secreto de enlace equivocado -> la MAC no valida contra el `bk` real.
    const hsFalso = Buffer.from('z'.repeat(32)).toString('base64url');
    const mac = await cliente.macCliente(relayPub, token, hsFalso);
    ctx.sesion.recibir(JSON.stringify({ t: 'cli_hello', pub: cliente.pubB64, token, mac }));
    expect(ctx.socket.ultimo('error')?.code).toBe('handshake_no_autenticado');
    expect(ctx.cdp.textos.length).toBe(0);
  });

  it('RECHAZA un cli_hello sin campo mac (protocolo)', async () => {
    const ctx = montar();
    const { token } = acunar();
    const cliente = await crearClienteFake();
    ctx.sesion.recibir(JSON.stringify({ t: 'cli_hello', pub: cliente.pubB64, token }));
    expect(ctx.socket.ultimo('error')?.code).toBe('protocolo');
  });

  it('no consume el jti cuando la MAC es invalida (no se puede quemar el token de la victima)', async () => {
    const autoridad = new AutoridadEnMemoria();
    const { token, jti, expiresAt } = acunar();
    const exp = Math.floor(new Date(expiresAt).getTime() / 1000);

    const ctx = montar({ autoridad });
    const relayPub = ctx.socket.ultimo('srv_hello')?.pub as string;
    const cliente = await crearClienteFake();
    // MAC invalida (hs equivocado) -> rechazo SIN tocar el jti.
    const macMala = await cliente.macCliente(relayPub, token, Buffer.from('q'.repeat(32)).toString('base64url'));
    ctx.sesion.recibir(JSON.stringify({ t: 'cli_hello', pub: cliente.pubB64, token, mac: macMala }));
    expect(ctx.socket.ultimo('error')?.code).toBe('handshake_no_autenticado');
    // El jti sigue disponible: un consumo directo posterior es la PRIMERA vez.
    expect(await autoridad.consumirJti(jti, exp)).toBe(true);
  });
});

describe('anti replay / reordenamiento (contador monotono)', () => {
  it('rechaza un contador repetido', async () => {
    const ctx = montar();
    const { token, bindingKey } = acunar({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' });
    const clave = await establecer(ctx, token, bindingKey);
    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 1, ct: await cifrarFrame(clave, 1, codificarTexto('a')) }));
    await vi.waitFor(() => expect(ctx.cdp.textos.length).toBe(1));
    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 1, ct: await cifrarFrame(clave, 1, codificarTexto('b')) }));
    expect(ctx.socket.ultimo('error')?.code).toBe('contador');
    expect(ctx.socket.cerrado).toBe(true);
  });

  it('rechaza un contador fuera de orden (menor al ultimo)', async () => {
    const ctx = montar();
    const { token, bindingKey } = acunar({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' });
    const clave = await establecer(ctx, token, bindingKey);
    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 5, ct: await cifrarFrame(clave, 5, codificarTexto('a')) }));
    await vi.waitFor(() => expect(ctx.cdp.textos.length).toBe(1));
    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 3, ct: await cifrarFrame(clave, 3, codificarTexto('b')) }));
    expect(ctx.socket.ultimo('error')?.code).toBe('contador');
  });

  it('rechaza un frame manipulado (tag GCM no autentica)', async () => {
    const ctx = montar();
    const { token, bindingKey } = acunar({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' });
    const clave = await establecer(ctx, token, bindingKey);
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
    );
    const cliente = await crearClienteFake();
    const relayPub = ctx.socket.ultimo('srv_hello')?.pub as string;
    const mac = await cliente.macCliente(relayPub, ajeno.token, ajeno.bindingKey);
    ctx.sesion.recibir(JSON.stringify({ t: 'cli_hello', pub: cliente.pubB64, token: ajeno.token, mac }));
    expect(ctx.socket.ultimo('error')?.code).toBe('token_invalido');
    expect(ctx.socket.cerrado).toBe(true);
  });

  it('rechaza el REUSO del mismo token entre DOS instancias que comparten la autoridad (B-1)', async () => {
    // Una sola autoridad COMPARTIDA simula el estado comun de dos instancias: el jti se consume una vez.
    const autoridad = new AutoridadEnMemoria();
    const { token, bindingKey } = acunar({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' });

    const ctx1 = montar({ autoridad });
    await establecer(ctx1, token, bindingKey);
    ctx1.sesion.cerrar('fin'); // libera el lock pero el jti queda consumido en la autoridad

    const ctx2 = montar({ autoridad });
    await enviarHello(ctx2, token, bindingKey);
    await vi.waitFor(() => expect(ctx2.socket.ultimo('error')?.code).toBe('reuso'));
  });

  it('rechaza un SEGUNDO canal concurrente a la MISMA conexion (lock compartido, B-1)', async () => {
    const autoridad = new AutoridadEnMemoria();
    const t1 = acunar({ ownerId: 'o', connectionId: 'con_x', sesionExternaId: 's' });
    const t2 = acunar({ ownerId: 'o', connectionId: 'con_x', sesionExternaId: 's' });

    const ctx1 = montar({ autoridad });
    await establecer(ctx1, t1.token, t1.bindingKey); // toma el lock de con_x y lo mantiene vivo

    // Segundo canal (otra instancia) a la MISMA conexion, con un token distinto pero valido: el lock
    // compartido lo bloquea.
    const ctx2 = montar({ autoridad });
    await enviarHello(ctx2, t2.token, t2.bindingKey);
    await vi.waitFor(() => expect(ctx2.socket.ultimo('error')?.code).toBe('conexion_ocupada'));

    ctx1.sesion.cerrar('fin');
  });

  it('rechaza un token expirado', async () => {
    const ctx = montar();
    const expirado = mintRelayToken(
      { ownerId: 'o', connectionId: 'c', sesionExternaId: 's', ttlSeconds: 1, nowSeconds: 1000 },
      SECRET,
    );
    const cliente = await crearClienteFake();
    const relayPub = ctx.socket.ultimo('srv_hello')?.pub as string;
    const mac = await cliente.macCliente(relayPub, expirado.token, expirado.bindingKey);
    ctx.sesion.recibir(JSON.stringify({ t: 'cli_hello', pub: cliente.pubB64, token: expirado.token, mac }));
    expect(ctx.socket.ultimo('error')?.code).toBe('token_invalido');
  });
});

describe('B-1: fail-closed si la autoridad de coordinacion no responde', () => {
  it('rechaza el canal si tomarConexion lanza (autoridad caida)', async () => {
    const autoridad = new AutoridadEnMemoria();
    vi.spyOn(autoridad, 'tomarConexion').mockRejectedValue(new Error('autoridad caida'));
    const ctx = montar({ autoridad });
    const { token, bindingKey } = acunar();
    await enviarHello(ctx, token, bindingKey);
    await vi.waitFor(() => expect(ctx.socket.ultimo('error')?.code).toBe('autoridad_no_disponible'));
    expect(ctx.cdp.textos.length).toBe(0);
  });

  it('rechaza el canal si consumirJti lanza (autoridad caida)', async () => {
    const autoridad = new AutoridadEnMemoria();
    vi.spyOn(autoridad, 'consumirJti').mockRejectedValue(new Error('autoridad caida'));
    const ctx = montar({ autoridad });
    const { token, bindingKey } = acunar();
    await enviarHello(ctx, token, bindingKey);
    await vi.waitFor(() => expect(ctx.socket.ultimo('error')?.code).toBe('autoridad_no_disponible'));
  });
});

describe('ciclo de vida: cierre al confirmar, cancelar y por timeout', () => {
  it('al cerrar el socket (confirmar/cancelar) cierra el CDP y libera el lock compartido', async () => {
    const autoridad = new AutoridadEnMemoria();
    const ctx = montar({ autoridad });
    const { token, bindingKey } = acunar({ ownerId: 'own_x', connectionId: 'con_x', sesionExternaId: 's' });
    await establecer(ctx, token, bindingKey);
    // Mientras esta vivo, el lock de la conexion esta tomado.
    expect(await autoridad.tomarConexion('con_x', 'otro-nonce', 9_999_999_999)).toBe(false);

    ctx.sesion.alCerrarSocket();
    expect(ctx.cdp.cerrado).toBe(true);
    // El lock se libero: ahora otra sesion a la misma conexion lo puede tomar.
    expect(await autoridad.tomarConexion('con_x', 'otro-nonce', 9_999_999_999)).toBe(true);
  });

  it('cierra por timeout de handshake si el cliente no completa el hello', async () => {
    const ctx = montar({ handshakeTimeoutMs: 20 });
    await vi.waitFor(() => expect(ctx.socket.cerrado).toBe(true), { timeout: 500 });
  });

  it('cierra por idle tras establecer y quedar sin actividad', async () => {
    const ctx = montar({ idleTimeoutMs: 25 });
    const { token, bindingKey } = acunar({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' });
    await establecer(ctx, token, bindingKey);
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
    const { token, bindingKey } = acunar({ ownerId: 'o', connectionId: 'c', sesionExternaId: 's' });
    const clave = await establecer(ctx, token, bindingKey);

    ctx.sesion.recibir(JSON.stringify({ t: 'k', c: 1, ct: await cifrarFrame(clave, 1, codificarTexto(CLAVE_SECRETA)) }));
    await vi.waitFor(() => expect(ctx.socket.cerrado).toBe(true));

    const todaLaSalida = [
      ...ctx.captura.lineas,
      ...errSpy.mock.calls.flat().map(String),
      ...logSpy.mock.calls.flat().map(String),
      ...warnSpy.mock.calls.flat().map(String),
    ].join('\n');

    expect(todaLaSalida).not.toContain(CLAVE_SECRETA);
    expect(todaLaSalida).not.toContain('wss://connect.fake'); // el connectUrl tampoco
    expect(ctx.captura.lineas.some((l) => l.includes('relay_cerrado'))).toBe(true);
  });
});
