/**
 * Verificacion LOCAL del catalogo de sitios sugeridos (apps/console/src/lib/catalogo-sitios.ts).
 * NO corre en CI a proposito: las URLs del catalogo se verifican manualmente por el operador y
 * este script es su herramienta para re-verificarlas cuando quiera.
 *
 * Uso:
 *   node scripts/verificar-catalogo-sitios.mjs
 *
 * Node puro, sin dependencias: extrae las entradas del archivo TypeScript del catalogo (campos en
 * orden fijo: id, nombre, dominio, urlLogin), hace fetch HEAD a cada urlLogin (con fallback a GET
 * cuando el HEAD falla o responde 4xx/5xx) siguiendo redirecciones, e imprime una tabla con id,
 * status HTTP, URL final y una marca cuando el host final difiere del dominio declarado (una
 * redireccion a otro host no es error en si; es una senal para revisar la entrada a mano).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CATALOGO_PATH = fileURLToPath(
  new URL('../apps/console/src/lib/catalogo-sitios.ts', import.meta.url),
);
const TIMEOUT_MS = 15000;
const CONCURRENCIA = 5;

/** Extrae { id, dominio, urlLogin } de cada entrada del arreglo del catalogo. */
async function leerCatalogo() {
  const fuente = await readFile(CATALOGO_PATH, 'utf8');
  const patron = /id:\s*'([^']+)'[^}]*?dominio:\s*'([^']+)'[^}]*?urlLogin:\s*'([^']+)'/g;
  const entradas = [];
  for (const m of fuente.matchAll(patron)) {
    entradas.push({ id: m[1], dominio: m[2], urlLogin: m[3] });
  }
  return entradas;
}

/** HEAD con fallback a GET, siguiendo redirecciones. Devuelve status y URL final (o el error). */
async function verificar(entrada) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(entrada.urlLogin, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok || method === 'GET') {
        return { ...entrada, status: res.status, urlFinal: res.url };
      }
    } catch (error) {
      if (method === 'GET') {
        return { ...entrada, status: 'ERROR', urlFinal: String(error?.cause ?? error) };
      }
    }
  }
  return { ...entrada, status: 'ERROR', urlFinal: 'sin respuesta' };
}

const entradas = await leerCatalogo();
if (entradas.length === 0) {
  console.error('No se pudo extraer ninguna entrada del catalogo; revisa el patron de extraccion.');
  process.exit(1);
}

const resultados = [];
for (let i = 0; i < entradas.length; i += CONCURRENCIA) {
  const lote = entradas.slice(i, i + CONCURRENCIA);
  resultados.push(...(await Promise.all(lote.map(verificar))));
}

const anchoId = Math.max(...resultados.map((r) => r.id.length), 2);
console.log(`${'id'.padEnd(anchoId)}  status  host    url final`);
let conDesvio = 0;
for (const r of resultados) {
  let marca = '      ';
  if (typeof r.status === 'number') {
    try {
      const hostFinal = new URL(r.urlFinal).hostname.toLowerCase();
      if (hostFinal !== r.dominio) {
        marca = 'DIFIERE';
        conDesvio += 1;
      }
    } catch {
      marca = '?     ';
    }
  }
  console.log(`${r.id.padEnd(anchoId)}  ${String(r.status).padEnd(6)}  ${marca} ${r.urlFinal}`);
}
console.log(
  `\n${resultados.length} entradas verificadas; ${conDesvio} con host final distinto al declarado.`,
);
