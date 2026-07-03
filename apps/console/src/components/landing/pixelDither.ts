/**
 * Motor compartido de la figura de pixeles con dithering de la marca: matriz
 * Bayer, hash/value-noise deterministas, paleta y el pintado de la nube.
 * Lo consumen PixelCloud (hero, sigue al cursor) y PixelAgent (margen derecho,
 * sigue al scroll) para que ambos rendericen exactamente la misma figura.
 */

/** Matriz Bayer 4x4 para el dithering ordenado de la nube. */
export const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Paleta ponderada de la nube: brasa dominante, con sombra, ink y un highlight. */
export const COLORS = ['#E5511E', '#E5511E', '#B23E14', '#1F1E1C', '#F0997B'];

/** Duracion nominal de un frame a 60Hz; base para normalizar los lerps por dt. */
export const FRAME_MS = 1000 / 60;

/**
 * Factor de lerp equivalente a aplicar `k` una vez por frame a 60Hz, ajustado
 * al dt real para que la velocidad no dependa del refresh rate del monitor.
 */
export function lerpK(k: number, dtMs: number): number {
  return 1 - Math.pow(1 - k, dtMs / FRAME_MS);
}

/** Hash pseudoaleatorio determinista en [0,1). */
export function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Value noise 2D con interpolacion smoothstep sobre el hash. */
export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Pinta una nube ditherizada centrada en (cx, cy), iterando solo el bounding
 * box del radio y recortando a los limites del canvas. Devuelve si pinto al
 * menos una celda.
 *
 * Las coordenadas son px CSS: asume que el llamador ya aplico el setTransform
 * de devicePixelRatio (los limites logicos del canvas se derivan de la escala
 * actual del contexto). Deja ctx.globalAlpha modificado; el llamador lo
 * restaura al terminar su frame.
 *
 * @param t tiempo animado en segundos (fase del noise y del parpadeo de color).
 * @param px tamano de celda de la rejilla, en px CSS.
 */
export function drawCloud(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  fuerza: number,
  t: number,
  px: number,
): boolean {
  const scale = ctx.getTransform().a || 1;
  const width = ctx.canvas.width / scale;
  const height = ctx.canvas.height / scale;

  const x0 = Math.max(0, Math.floor((cx - radius) / px));
  const x1 = Math.min(Math.ceil(width / px), Math.ceil((cx + radius) / px));
  const y0 = Math.max(0, Math.floor((cy - radius) / px));
  const y1 = Math.min(Math.ceil(height / px), Math.ceil((cy + radius) / px));

  let drew = false;
  for (let gx = x0; gx < x1; gx++) {
    for (let gy = y0; gy < y1; gy++) {
      const dx = gx * px + px / 2 - cx;
      const dy = gy * px + px / 2 - cy;
      const distSq = dx * dx + dy * dy;
      if (distSq > radius * radius) continue;
      const falloff = 1 - Math.sqrt(distSq) / radius;
      const noise = valueNoise(gx * 0.13 + t * 0.6, gy * 0.13 - t * 0.35);
      const intensity = falloff * falloff * (0.35 + noise * 0.9) * fuerza;
      const threshold = ((BAYER[gx & 3]?.[gy & 3] ?? 0) + 1) / 17;
      if (intensity > threshold) {
        const pick = hash(gx * 3.7, gy * 5.1 + Math.floor(t * 2));
        ctx.fillStyle = COLORS[Math.floor(pick * COLORS.length)] ?? '#E5511E';
        ctx.globalAlpha = Math.min(1, intensity * 1.2);
        ctx.fillRect(gx * px, gy * px, px - 1, px - 1);
        drew = true;
      }
    }
  }
  return drew;
}
