/**
 * Motor compartido de dithering pixelado de la landing (mismo lenguaje visual
 * que `PixelCloud`): matriz Bayer 4x4 ordenada, hash determinista, value noise
 * y una nube ditherizada pintable sobre cualquier canvas 2D.
 *
 * `PixelCloud` conserva por ahora su copia inline por alcance (no se toca ese
 * archivo); migrarlo a este modulo es un follow-up trivial.
 */

/** Matriz Bayer 4x4 para el dithering ordenado. */
export const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Paleta ponderada de marca: brasa dominante, con sombra, ink y un highlight. */
export const COLORS = ['#E5511E', '#E5511E', '#B23E14', '#1F1E1C', '#F0997B'];

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
 * Viewport de pintado: dimensiones en px CSS, tamano de celda de la rejilla y
 * tiempo acumulado en segundos (anima el noise y la seleccion de color).
 */
export interface DitherViewport {
  width: number;
  height: number;
  px: number;
  t: number;
}

/**
 * Pinta una nube ditherizada centrada en (cx, cy), iterando solo el bounding
 * box del radio. Deja `globalAlpha` modificado: el llamador lo restaura al
 * cierre del frame. Devuelve si pinto al menos una celda.
 */
export function drawCloud(
  ctx: CanvasRenderingContext2D,
  vp: DitherViewport,
  cx: number,
  cy: number,
  radius: number,
  fuerza: number,
): boolean {
  const { width, height, px, t } = vp;
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

/**
 * Pinta un anillo ditherizado (banda alrededor de `radius`) centrado en
 * (cx, cy). Mismo tratamiento Bayer/noise/paleta que la nube; se usa para el
 * micro-flash de absorcion en el nodo del modelo.
 */
export function drawRing(
  ctx: CanvasRenderingContext2D,
  vp: DitherViewport,
  cx: number,
  cy: number,
  radius: number,
  thickness: number,
  fuerza: number,
): void {
  const { width, height, px, t } = vp;
  const outer = radius + thickness;
  const x0 = Math.max(0, Math.floor((cx - outer) / px));
  const x1 = Math.min(Math.ceil(width / px), Math.ceil((cx + outer) / px));
  const y0 = Math.max(0, Math.floor((cy - outer) / px));
  const y1 = Math.min(Math.ceil(height / px), Math.ceil((cy + outer) / px));

  for (let gx = x0; gx < x1; gx++) {
    for (let gy = y0; gy < y1; gy++) {
      const dx = gx * px + px / 2 - cx;
      const dy = gy * px + px / 2 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const band = 1 - Math.abs(dist - radius) / thickness;
      if (band <= 0) continue;
      const noise = valueNoise(gx * 0.21 + t * 0.8, gy * 0.21 - t * 0.5);
      const intensity = band * band * (0.4 + noise * 0.8) * fuerza;
      const threshold = ((BAYER[gx & 3]?.[gy & 3] ?? 0) + 1) / 17;
      if (intensity > threshold) {
        const pick = hash(gx * 3.7, gy * 5.1 + Math.floor(t * 2));
        ctx.fillStyle = COLORS[Math.floor(pick * COLORS.length)] ?? '#E5511E';
        ctx.globalAlpha = Math.min(1, intensity * 1.1);
        ctx.fillRect(gx * px, gy * px, px - 1, px - 1);
      }
    }
  }
}
