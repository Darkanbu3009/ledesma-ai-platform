import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Subconjunto de la firma de dns.promises.lookup que usa la guarda; inyectable en tests. */
export type LookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

/** Rangos IPv4 privados/reservados prohibidos para webhooks, como [red, bits de prefijo]. */
const FORBIDDEN_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "esta red"
  ['10.0.0.0', 8], // privada
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (metadata de nubes incluida)
  ['172.16.0.0', 12], // privada
  ['192.0.0.0', 24], // reservado IETF
  ['192.168.0.0', 16], // privada
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservado
  ['255.255.255.255', 32], // broadcast (ya dentro de 240/4; explicito por claridad)
];

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function isForbiddenIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return FORBIDDEN_IPV4_RANGES.some(([network, bits]) => {
    const base = ipv4ToInt(network);
    return value >= base && value < base + 2 ** (32 - bits);
  });
}

/** Juzga la IPv4 embebida en una mapeada ::ffff:...; llega en forma dotted (dns.lookup) o
 * como dos grupos hex (new URL normaliza [::ffff:10.0.0.1] a [::ffff:a00:1]). */
function isForbiddenMappedIpv4(tail: string): boolean {
  if (isIP(tail) === 4) return isForbiddenIpv4(tail);
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
  if (!hex) return true; // forma no reconocida: rechazar por defecto
  const high = parseInt(hex[1] ?? '', 16);
  const low = parseInt(hex[2] ?? '', 16);
  return isForbiddenIpv4(
    `${Math.floor(high / 256)}.${high % 256}.${Math.floor(low / 256)}.${low % 256}`,
  );
}

/** Asume la forma comprimida en minusculas que regresan dns.lookup y new URL().hostname;
 * no canonicaliza formas expandidas tipo 0:0:0:0:0:0:0:1 (esas fuentes ya las comprimen). */
function isForbiddenIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) return isForbiddenMappedIpv4(normalized.slice('::ffff:'.length));
  const firstGroup = parseInt(normalized.split(':', 1)[0] ?? '', 16);
  if (Number.isNaN(firstGroup)) return false;
  if ((firstGroup & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
  if ((firstGroup & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  return false;
}

/** true si la IP cae en rangos privados/reservados; lo que no parsea como IP se rechaza.
 * NUNCA lanza: cualquier error interno de parseo se trata como prohibida (fail-closed). */
export function isForbiddenIp(ip: string): boolean {
  try {
    const version = isIP(ip);
    if (version === 4) return isForbiddenIpv4(ip);
    if (version === 6) return isForbiddenIpv6(ip);
    return true;
  } catch {
    return true;
  }
}

/** true si el hostname ES una IP prohibida o resuelve (DNS) a ALGUNA IP prohibida; tambien
 * true si no resuelve o resuelve a una lista vacia (se rechaza por defecto). Acepta IPv6
 * con brackets tal como la entrega new URL().hostname. NUNCA lanza: cualquier error del
 * lookup (rechazo o lanzamiento sincrono, p.ej. opciones no soportadas por el runtime) se
 * trata como prohibido (fail-closed). */
export async function resolvesToForbiddenIp(
  hostname: string,
  lookupFn: LookupFn = lookup,
): Promise<boolean> {
  try {
    const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
    if (isIP(host) !== 0) return isForbiddenIp(host);
    const addresses = await lookupFn(host, { all: true, verbatim: true });
    if (addresses.length === 0) return true;
    return addresses.some((entry) => isForbiddenIp(entry.address));
  } catch {
    return true;
  }
}
