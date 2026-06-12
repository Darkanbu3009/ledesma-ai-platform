import { describe, it, expect, vi } from 'vitest';
import { isForbiddenIp, resolvesToForbiddenIp, type LookupFn } from '../src/tools/ip-guard.js';

function asLookup(mock: ReturnType<typeof vi.fn>): LookupFn {
  return mock as unknown as LookupFn;
}

describe('isForbiddenIp', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.10',
    '192.168.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
  ])('IPv4 privada/reservada %s -> true', (ip) => {
    expect(isForbiddenIp(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '34.107.221.82',
    // bordes inmediatamente fuera de los rangos prohibidos
    '9.255.255.255',
    '100.128.0.1',
    '172.32.0.1',
    '192.0.1.0',
    '198.20.0.1',
    '223.255.255.255',
  ])('IPv4 publica %s -> false', (ip) => {
    expect(isForbiddenIp(ip)).toBe(false);
  });

  it.each([
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'febf::1',
    '::ffff:10.0.0.1',
    // forma hex de la mapeada anterior, como la normaliza new URL().hostname
    '::ffff:a00:1',
  ])('IPv6 prohibida %s -> true', (ip) => {
    expect(isForbiddenIp(ip)).toBe(true);
  });

  it.each([
    '2606:4700::1111',
    // bordes fuera de fc00::/7 y fe80::/10
    'fbff::1',
    'fe00::1',
    'fec0::1',
    // mapeada a una IPv4 publica
    '::ffff:8.8.8.8',
  ])('IPv6 publica %s -> false', (ip) => {
    expect(isForbiddenIp(ip)).toBe(false);
  });

  it('lo que no parsea como IP se rechaza por defecto', () => {
    expect(isForbiddenIp('no-es-una-ip')).toBe(true);
    expect(isForbiddenIp('')).toBe(true);
  });
});

describe('resolvesToForbiddenIp', () => {
  it('hostname que resuelve solo a IPs publicas: false', async () => {
    const lookupFn = vi.fn().mockResolvedValue([{ address: '34.107.221.82', family: 4 }]);

    await expect(resolvesToForbiddenIp('api.cliente.com', asLookup(lookupFn))).resolves.toBe(false);

    expect(lookupFn).toHaveBeenCalledTimes(1);
    expect(lookupFn).toHaveBeenCalledWith('api.cliente.com', { all: true, verbatim: true });
  });

  it('basta UNA IP privada entre las resueltas: true', async () => {
    const lookupFn = vi.fn().mockResolvedValue([
      { address: '34.107.221.82', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);

    await expect(resolvesToForbiddenIp('rebind.example.com', asLookup(lookupFn))).resolves.toBe(true);
  });

  it('lookup que lanza (hostname no resuelve): true', async () => {
    const lookupFn = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));

    await expect(resolvesToForbiddenIp('no-existe.example.com', asLookup(lookupFn))).resolves.toBe(true);
  });

  it('lookup que regresa lista vacia: true', async () => {
    const lookupFn = vi.fn().mockResolvedValue([]);

    await expect(resolvesToForbiddenIp('sin-ips.example.com', asLookup(lookupFn))).resolves.toBe(true);
  });

  it('hostname que ES una IP literal privada: true sin llamar lookup', async () => {
    const lookupFn = vi.fn();

    await expect(resolvesToForbiddenIp('10.1.2.3', asLookup(lookupFn))).resolves.toBe(true);

    expect(lookupFn).not.toHaveBeenCalled();
  });

  it('hostname que ES una IP literal publica: false sin llamar lookup', async () => {
    const lookupFn = vi.fn();

    await expect(resolvesToForbiddenIp('34.107.221.82', asLookup(lookupFn))).resolves.toBe(false);

    expect(lookupFn).not.toHaveBeenCalled();
  });

  it('IPv6 literal con brackets (como la entrega new URL): juzgada sin lookup', async () => {
    const lookupFn = vi.fn();

    await expect(resolvesToForbiddenIp('[::1]', asLookup(lookupFn))).resolves.toBe(true);
    await expect(resolvesToForbiddenIp('[2606:4700::1111]', asLookup(lookupFn))).resolves.toBe(false);

    expect(lookupFn).not.toHaveBeenCalled();
  });
});

// Blindaje del guard: estas funciones corren en la ruta critica del ejecutor de webhooks y
// JAMAS deben lanzar; cualquier error interno se resuelve como prohibido (fail-closed).
describe('la guarda nunca lanza', () => {
  it('isForbiddenIp con IPv6 publica real no lanza y regresa false', () => {
    expect(() => isForbiddenIp('2606:4700::1111')).not.toThrow();
    expect(isForbiddenIp('2606:4700::1111')).toBe(false);
  });

  it('isForbiddenIp con basura no lanza y rechaza', () => {
    expect(() => isForbiddenIp('basura')).not.toThrow();
    expect(isForbiddenIp('basura')).toBe(true);
  });

  it('isForbiddenIp no lanza ni con entradas que violan el tipo', () => {
    expect(() => isForbiddenIp(null as unknown as string)).not.toThrow();
    expect(isForbiddenIp(null as unknown as string)).toBe(true);
    expect(() => isForbiddenIp(undefined as unknown as string)).not.toThrow();
    expect(isForbiddenIp(undefined as unknown as string)).toBe(true);
  });

  it('resolvesToForbiddenIp con lookup que rechaza: true sin lanzar', async () => {
    const lookupFn = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));

    await expect(resolvesToForbiddenIp('falla.example.com', asLookup(lookupFn))).resolves.toBe(true);
  });

  it('resolvesToForbiddenIp con lookup que LANZA sincronicamente (p.ej. opciones no soportadas por el runtime): true sin lanzar', async () => {
    const lookupFn = (() => {
      throw new TypeError('invalid options');
    }) as unknown as LookupFn;

    await expect(resolvesToForbiddenIp('opciones.example.com', lookupFn)).resolves.toBe(true);
  });

  it('resolvesToForbiddenIp con lookup que resuelve a una IPv6 publica: false', async () => {
    const lookupFn = vi.fn().mockResolvedValue([{ address: '2606:4700::1111', family: 6 }]);

    await expect(resolvesToForbiddenIp('ipv6.cliente.com', asLookup(lookupFn))).resolves.toBe(false);
  });
});
