import { useEffect, useRef, type JSX } from 'react';

/** Duracion de un ciclo completo (viaje + silencio) por curva, en segundos. */
const PERIOD_S = 3.6;
/** Fraccion del ciclo durante la que el pulso viaja; el resto es silencio. */
const TRAVEL_FRACTION = 0.62;
/** Segmentos muestreados sobre la bezier para dibujar la cola del cometa. */
const SEGS = 22;
/** Longitud de la cola como fraccion del recorrido de la curva. */
const TAIL_LEN = 0.13;
/** Decaimiento de vida del anillo de llegada por frame a 60Hz. */
const RING_DECAY = 0.035;
/** Duracion nominal de un frame a 60Hz; base para normalizar por dt. */
const FRAME_MS = 1000 / 60;

/**
 * Estilo y grosor de cada segmento de la cola, precomputados: dependen solo
 * del indice y construirlos por frame seria puro churn en el loop caliente.
 * k=1 en la cabeza (brillante, ~3px) decayendo cuadraticamente a nada.
 */
const SEG_STYLE = Array.from({ length: SEGS }, (_, s) => {
  const k = 1 - s / SEGS;
  return `rgba(229, 81, 30, ${0.85 * k * k})`;
});
const SEG_WIDTH = Array.from({ length: SEGS }, (_, s) => 1.1 + 1.9 * (1 - s / SEGS));

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

/** Anillo de llegada expandiendose en el nodo del modelo. */
interface Ring {
  x: number;
  y: number;
  life: number;
}

/** Estado de ciclo por curva: detecta el fin del viaje para disparar el anillo. */
interface PulseState {
  cycle: number;
  traveled: boolean;
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

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
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
    if (!match) continue; // el tramo recto nodo->carta (M..L) no lleva pulsos
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

/**
 * Pulsos cometa del hero: un trazo fino de luz brasa con cola degradada
 * recorre cada curva punteada desde cada sistema hacia el nodo del modelo y
 * dispara un anillo sutil al llegar. Baja frecuencia: cada curva pulsa una
 * vez por ciclo (viaje en el primer 62%, silencio el resto) con fases
 * escalonadas para que nunca lleguen dos anillos a la vez.
 *
 * Cambio puramente aditivo: canvas absoluto sin eventos de puntero superpuesto
 * al showcase; las lineas punteadas originales quedan intactas y los pulsos
 * se pintan encima. La geometria se lee en runtime de los paths reales del SVG
 * y se recalcula en resize. Repintado con clearRect completo cada frame. El
 * glow lo da el degradado de la cola (sin shadowBlur). No hace nada en touch,
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
    let pulses: PulseState[] = [];
    let rings: Ring[] = [];
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
      // Asignar cv.width resetea el estado del contexto: se restaura aqui.
      ctx.lineCap = 'round';
    }

    function clearCanvas(): void {
      ctx.clearRect(0, 0, width, height);
    }

    /** Re-mide todo; si no hay curvas (carril oculto) apaga y limpia. */
    function remeasure(): void {
      resizeCanvas();
      geometry = measureGeometry(cv);
      // Los anillos vivos guardan coords absolutas del nodo anterior: tras
      // cualquier re-medida quedarian flotando en la posicion vieja.
      rings = [];
      if (!geometry) {
        pulses = [];
        stop();
        clearCanvas();
        return;
      }
      if (pulses.length !== geometry.curves.length) {
        pulses = geometry.curves.map(() => ({ cycle: -1, traveled: false }));
      }
      start();
    }

    /**
     * Cola del cometa: SEGS segmentos muestreados sobre la bezier cubriendo
     * TAIL_LEN del recorrido detras de la cabeza. La cabeza (~3px) brilla y
     * cada segmento se desvanece cuadraticamente hasta nada. Segmentos
     * adyacentes comparten extremo: cada punto se evalua una sola vez.
     */
    function drawComet(curve: Curve, head: number): void {
      let to = bezier(curve, head);
      for (let s = 0; s < SEGS; s++) {
        if (head - (s / SEGS) * TAIL_LEN <= 0) break;
        const p0 = Math.max(head - ((s + 1) / SEGS) * TAIL_LEN, 0);
        const from = bezier(curve, p0);
        ctx.strokeStyle = SEG_STYLE[s] ?? '';
        ctx.lineWidth = SEG_WIDTH[s] ?? 1;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        to = from;
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
      const { curves, nodeX, nodeY } = geometry;

      clearCanvas();

      // Anillos de llegada primero: quedan detras de los cometas.
      if (rings.length > 0) {
        rings = rings.filter((ring) => (ring.life -= RING_DECAY * step) > 0);
        for (const ring of rings) {
          ctx.strokeStyle = `rgba(229, 81, 30, ${0.5 * ring.life})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(ring.x, ring.y, 6 + (1 - ring.life) * 20, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Un pulso por curva, con fase escalonada: viaja durante el primer
      // TRAVEL_FRACTION del ciclo y descansa el resto (baja frecuencia).
      // El paso de fase se deriva del numero de curvas (0.9s con las 4 del
      // diseno original): un paso fijo cuyo multiplo coincida con el periodo
      // pondria dos curvas en fase y sus anillos llegarian a la vez.
      const phaseStep = PERIOD_S / curves.length;
      for (let i = 0; i < curves.length; i++) {
        const curve = curves[i];
        const state = pulses[i];
        if (!curve || !state) continue;
        const local = t + i * phaseStep;
        const cycle = Math.floor(local / PERIOD_S);
        const frac = local / PERIOD_S - cycle;
        if (cycle !== state.cycle) {
          state.cycle = cycle;
          state.traveled = false;
        }
        if (frac < TRAVEL_FRACTION) {
          state.traveled = true;
          drawComet(curve, easeInOutQuad(frac / TRAVEL_FRACTION));
        } else if (state.traveled) {
          // El pulso acaba de llegar: el anillo es todo el evento de llegada.
          state.traveled = false;
          rings.push({ x: nodeX, y: nodeY, life: 1 });
        }
      }

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
