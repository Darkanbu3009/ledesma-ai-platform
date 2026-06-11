/**
 * Copia el bundle del widget (packages/widget/dist) a public/widget para que el backend lo
 * sirva. TOLERANTE a fuente ausente: en CI las apps construyen antes que packages, asi que el
 * build del backend debe pasar aunque el widget no este construido todavia (log y exit 0).
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const source = fileURLToPath(
  new URL('../../../packages/widget/dist/ledesma-agent.js', import.meta.url),
);
const target = fileURLToPath(new URL('../public/widget/ledesma-agent.js', import.meta.url));

if (!existsSync(source)) {
  console.log(`[copy-widget] fuente no encontrada (${source}); se omite la copia`);
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`[copy-widget] widget copiado a ${target}`);
