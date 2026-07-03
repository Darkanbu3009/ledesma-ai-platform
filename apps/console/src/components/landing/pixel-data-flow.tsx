import { useEffect, useRef, type JSX } from 'react';
import { drawCloud, drawRing, hash, type DitherViewport } from './pixel-dither';

/** Tamano de celda de la rejilla de pixeles del flujo, en px CSS. */
const PX = 4;
/** Velocidad de un paquete, en progreso de curva por frame a 60Hz. */
const SPEED_MIN = 0.0022;
const SPEED_MAX = 0.004;
/** Paquetes simultaneos por curva. */
const PACKETS_PER_CURVE = 2;
/** Progreso bajo el cual el paquete esta naciendo (puff + pixeles sueltos). */
const BIRTH_P = 0.06;
/** Duracion del crecimiento del radio al nacer. */
const BIRTH_MS = 150;
/** Progreso a partir del cual el paquete se desintegra hacia el nodo. */
const ABSORB_P = 0.94;
/** Vida de las particulas de absorcion. */
const PARTICLE_MS = 250;
/** Duracion del micro-flash del nodo. */
const FLASH_MS = 300;
/** Separacion minima entre bursts: nunca dos absorciones simultaneas. */
const BURST_GAP_MS = 380;
/** Maximo de puntos de estela por paquete. */
const TRAIL_MAX = 4;
/** Decaimiento de vida de la estela por frame a 60Hz. */
const TRAIL_DECAY = 0.08;
/** Duracion nominal de un frame a 60Hz; base para normalizar por dt. */
const FRAME_MS = 1000 / 60;

/** Curva bezier cubica en px CSS del canvas, extraida del SVG de lineas. */
interface Curve {
  x0: number;
  y0: number;
  cx1: number;
  cy1: number;
  cx2: number;
  cy2: number;
  x1: number;
  y1: number;
}

interface TrailPoint {
  x: number;
  y: number;
  life: number;
}

/** Particula de absorcion: vuela del punto de burst al centro del nodo. */
interface Particle {
  sx: number;
  sy: number;
  /** Dispersion inicial alrededor del punto de burst. */
  ox: number;
  oy: number;
  born: number;
}

interface Packet {
  curve: number;
  p: number;
  speed: number;
  /** Timestamp del ultimo respawn, para el puff de nacimiento. */
  spawnAt: number;
  /** Semilla estable para los pixeles sueltos del nacimiento. */
  seed: number;
  absorbing: boolean;
  particles: Particle[];
  trail: TrailPoint[];
  sinceTrail: number;
}

/** Geometria medida en runtime: curvas en coords del canvas y centro del nodo. */
interface Geometry {
  curves: Curve[];
  nodeX: number;
  nodeY: number;
}

/** Punto de una bezier cubica en t. */
function bezier(c: Curve, t: number): { x: number; y: number } {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.x0 + b * c.cx1 + d * c.cx2 + e * c.x1,
    y: a * c.y0 + b * c.cy1 + d * c.cy2 + e * c.y1,
  };
}

/**
 * Extrae las curvas `M x y C x1 y1, x2 y2, x y` del SVG de lineas del hero
 * (viewBox 0..100 con preserveAspectRatio="none") y las mapea a px CSS del
 * canvas. Leer los paths reales garantiza seguir exactamente la forma de las
 * lineas punteadas actuales sin hardcodear coordenadas.
 */
function measureGeometry(canvas: HTMLCanvasElement): Geometry | null {
  const root = canvas.parentElement;
  if (!root) return null;
  const svg = root.querySelector('svg[preserveAspectRatio="none"]');
  if (!svg) return null;
  const svgRect = svg.getBoundingClientRect();
  // Carril oculto (viewport angosto: las cards se apilan y no hay curvas).
  if (svgRect.width < 4 || svgRect.height < 4) return null;
  const canvasRect = canvas.getBoundingClientRect();
  const offX = svgRect.left - canvasRect.left;
  const offY = svgRect.top - canvasRect.top;
  const sx = svgRect.width / 100;
  const sy = svgRect.height / 100;

  const curves: Curve[] = [];
  const num = '(-?[\\d.]+)';
  const sep = '[\\s,]+';
  const curveRe = new RegExp(
    `M\\s*${num}${sep}${num}\\s*C\\s*${num}${sep}${num}${sep}${num}${sep}${num}${sep}${num}${sep}${num}`,
  );
  for (const path of svg.querySelectorAll('path')) {
    const match = curveRe.exec(path.getAttribute('d') ?? '');
    if (!match) continue; // el tramo recto nodo->carta (M..L) no lleva paquetes
    const [, x0, y0, cx1, cy1, cx2, cy2, x1, y1] = match.map(Number);
    curves.push({
      x0: offX + (x0 ?? 0) * sx,
      y0: offY + (y0 ?? 0) * sy,
      cx1: offX + (cx1 ?? 0) * sx,
      cy1: offY + (cy1 ?? 0) * sy,
      cx2: offX + (cx2 ?? 0) * sx,
      cy2: offY + (cy2 ?? 0) * sy,
      x1: offX + (x1 ?? 0) * sx,
      y1: offY + (y1 ?? 0) * sy,
    });
  }
  const first = curves[0];
  if (!first) return null;
  return { curves, nodeX: first.x1, nodeY: first.y1 };
}

function randomSpeed(): number {
  return SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
}

/**
 * Flujo de datos pixelado del hero: paquetes de pixeles con dithering viajan
 * por las curvas punteadas desde cada sistema hacia el nodo del modelo, con
 * puff de nacimiento, pulso a mitad de curva y burst de absorcion con
 * micro-flash en el nodo.
 *
 * Cambio puramente aditivo: canvas absoluto sin eventos de puntero superpuesto
 * al showcase; las lineas punteadas originales quedan intactas y los paquetes
 * se pintan encima. La geometria se lee en runtime de los paths reales del SVG
 * y se recalcula en resize. Repintado con clearRect completo cada frame (nunca
 * fade del frame anterior, que emborrona el dithering). No hace nada en touch,
 * con prefers-reduced-motion ni cuando el carril de lineas esta oculto
 * (viewport angosto). Pausa fuera de viewport y con la pestana oculta.
 */
export function PixelDataFlow(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // En touch o con reduced-motion el efecto no se monta: el canvas queda vacio.
    if (window.matchMedia('(hover: none)').matches) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) return;

    const context = canvas.getContext('2d');
    if (!context) return;
    const cv = canvas;
    const ctx = context;

    let width = 0;
    let height = 0;
    let geometry: Geometry | null = null;
    let packets: Packet[] = [];
    /** Flashes activos en el nodo: timestamp de inicio de cada uno. */
    let flashes: number[] = [];
    let lastBurstAt = -Infinity;
    let t = 0;
    let rafId = 0;
    let lastTime = 0;
    let running = false;
    let inViewport = true;
    let disabled = false;

    function resizeCanvas(): void {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = cv.clientWidth;
      height = cv.clientHeight;
      cv.width = width * dpr;
      cv.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /**
     * Construye los paquetes con fases iniciales separadas (paso aureo por
     * paquete mas un jitter corto): siempre hay movimiento en varias curvas y
     * las llegadas nunca caen en fase; el gate de bursts remata la garantia.
     */
    function buildPackets(curveCount: number, now: number): Packet[] {
      const built: Packet[] = [];
      for (let i = 0; i < curveCount; i++) {
        for (let j = 0; j < PACKETS_PER_CURVE; j++) {
          const k = i * PACKETS_PER_CURVE + j;
          const phase = (k * 0.618 + Math.random() * 0.09) % 1;
          built.push({
            curve: i,
            p: phase * ABSORB_P,
            speed: randomSpeed(),
            // Nacen "ya viajando": sin puff en el primer frame del montaje.
            spawnAt: now - BIRTH_MS * 2,
            seed: Math.random() * 1000,
            absorbing: false,
            particles: [],
            trail: [],
            sinceTrail: 0,
          });
        }
      }
      return built;
    }

    function clearCanvas(): void {
      ctx.clearRect(0, 0, width, height);
    }

    /** Re-mide todo; si no hay curvas (carril oculto) apaga y limpia. */
    function remeasure(): void {
      resizeCanvas();
      geometry = measureGeometry(cv);
      if (!geometry) {
        packets = [];
        flashes = [];
        stop();
        clearCanvas();
        return;
      }
      if (packets.length !== geometry.curves.length * PACKETS_PER_CURVE) {
        packets = buildPackets(geometry.curves.length, performance.now());
      }
      start();
    }

    function respawn(packet: Packet, now: number): void {
      packet.p = 0;
      packet.speed = randomSpeed();
      packet.spawnAt = now;
      packet.seed = Math.random() * 1000;
      packet.absorbing = false;
      packet.particles = [];
      packet.trail = [];
      packet.sinceTrail = 0;
    }

    /** Pixeles sueltos dispersandose durante el nacimiento del paquete. */
    function drawBirthSpecks(packet: Packet, curve: Curve): void {
      const k = packet.p / BIRTH_P;
      const specks = 3 + Math.floor(hash(packet.seed, 7) * 2);
      for (let s = 0; s < specks; s++) {
        const angle = hash(packet.seed, s * 3.1) * Math.PI * 2;
        const reach = (6 + hash(packet.seed, s * 5.7) * 10) * k;
        const x = curve.x0 + Math.cos(angle) * reach;
        const y = curve.y0 + Math.sin(angle) * reach;
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.fillStyle = s % 2 === 0 ? '#E5511E' : '#F0997B';
        ctx.fillRect(Math.round(x / PX) * PX, Math.round(y / PX) * PX, PX - 1, PX - 1);
      }
    }

    function frame(now: number): void {
      if (!geometry) {
        running = false;
        return;
      }
      if (lastTime === 0) lastTime = now;
      // Tope de 100ms: tras una pausa larga de rAF se avanza un paso normal.
      const dt = Math.min(now - lastTime, 100);
      lastTime = now;
      const step = dt / FRAME_MS;
      t += dt * 0.001;
      const vp: DitherViewport = { width, height, px: PX, t };
      const { curves, nodeX, nodeY } = geometry;

      clearCanvas();

      // Micro-flash del nodo primero: queda detras de paquetes y particulas.
      flashes = flashes.filter((start) => now - start < FLASH_MS);
      for (const start of flashes) {
        const k = (now - start) / FLASH_MS;
        drawRing(ctx, vp, nodeX, nodeY, 20 + 14 * k, 7, 0.8 * (1 - k));
      }

      for (const packet of packets) {
        const curve = curves[packet.curve];
        if (!curve) continue;

        if (packet.absorbing) {
          // ABSORCION: particulas volando al nodo con easing; al morir todas,
          // el paquete renace en p=0 con nueva velocidad.
          let alive = false;
          for (const particle of packet.particles) {
            const k = (now - particle.born) / PARTICLE_MS;
            if (k >= 1) continue;
            alive = true;
            const ease = k * k; // acelera hacia el nodo
            const x = particle.sx + particle.ox + (nodeX - particle.sx - particle.ox) * ease;
            const y = particle.sy + particle.oy + (nodeY - particle.sy - particle.oy) * ease;
            ctx.globalAlpha = (1 - k) * 0.95;
            ctx.fillStyle = hash(particle.ox, particle.oy) > 0.3 ? '#E5511E' : '#B23E14';
            ctx.fillRect(Math.round(x / PX) * PX, Math.round(y / PX) * PX, PX - 1, PX - 1);
          }
          if (!alive) respawn(packet, now);
          continue;
        }

        packet.p += packet.speed * step;

        if (packet.p >= ABSORB_P) {
          // Gate global: si hubo un burst hace poco, el paquete espera en el
          // umbral para que nunca lleguen dos bursts al mismo tiempo.
          if (now - lastBurstAt < BURST_GAP_MS) {
            packet.p = ABSORB_P;
          } else {
            lastBurstAt = now;
            flashes.push(now);
            const at = bezier(curve, ABSORB_P);
            const count = 6 + Math.floor(Math.random() * 5);
            packet.particles = Array.from({ length: count }, () => ({
              sx: at.x,
              sy: at.y,
              ox: (Math.random() - 0.5) * 16,
              oy: (Math.random() - 0.5) * 16,
              born: now,
            }));
            packet.absorbing = true;
            packet.trail = [];
            continue;
          }
        }

        // VIAJE: crece y brilla a mitad de curva, llega compacto.
        const pulse = Math.sin(packet.p * Math.PI);
        const birthScale = Math.min(1, (now - packet.spawnAt) / BIRTH_MS);
        const radius = (9 + pulse * 6) * birthScale;
        const fuerza = (0.7 + pulse * 0.5) * birthScale;
        const pos = bezier(curve, packet.p);

        // Estela corta detras del paquete, decayendo rapido.
        for (const point of packet.trail) point.life -= TRAIL_DECAY * step;
        packet.trail = packet.trail.filter((point) => point.life > 0);
        packet.sinceTrail += step;
        if (packet.sinceTrail >= 3) {
          packet.sinceTrail = 0;
          packet.trail.push({ x: pos.x, y: pos.y, life: 1 });
          if (packet.trail.length > TRAIL_MAX) packet.trail.shift();
        }
        for (const point of packet.trail) {
          drawCloud(ctx, vp, point.x, point.y, radius * 0.5, point.life * 0.45 * fuerza);
        }

        drawCloud(ctx, vp, pos.x, pos.y, radius, fuerza);

        // NACIMIENTO: puff con pixeles sueltos dispersandose al inicio.
        if (packet.p < BIRTH_P) drawBirthSpecks(packet, curve);
      }

      ctx.globalAlpha = 1;
      rafId = requestAnimationFrame(frame);
    }

    function start(): void {
      if (running || disabled || !inViewport || document.hidden || !geometry) return;
      running = true;
      lastTime = 0;
      rafId = requestAnimationFrame(frame);
    }

    function stop(): void {
      if (!running) return;
      running = false;
      cancelAnimationFrame(rafId);
    }

    function shutOff(): void {
      stop();
      clearCanvas();
    }

    function onVisibilityChange(): void {
      if (document.hidden) shutOff();
      else start();
    }

    function onReducedMotionChange(event: MediaQueryListEvent): void {
      disabled = event.matches;
      if (disabled) shutOff();
      else start();
    }

    remeasure();

    document.addEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.addEventListener('change', onReducedMotionChange);

    // Observa el canvas (tamano del showcase) y el SVG de lineas (aparece,
    // desaparece o cambia con el breakpoint del carril): ambos re-miden.
    const resizeObserver = new ResizeObserver(remeasure);
    resizeObserver.observe(cv);
    const svg = cv.parentElement?.querySelector('svg[preserveAspectRatio="none"]');
    if (svg) resizeObserver.observe(svg);

    const intersectionObserver = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      inViewport = entry?.isIntersecting ?? true;
      if (!inViewport) shutOff();
      else start();
    });
    intersectionObserver.observe(cv);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotion.removeEventListener('change', onReducedMotionChange);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
