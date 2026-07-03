import { useEffect, useRef, type JSX } from 'react';

/** Matriz Bayer 4x4 para el dithering ordenado de la nube. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Paleta ponderada de la nube: brasa dominante, con sombra, ink y un highlight. */
const COLORS = ['#E5511E', '#E5511E', '#B23E14', '#1F1E1C', '#F0997B'];

/** Tamano de celda de la rejilla de pixeles, en px CSS. */
const PX = 6;
/** Radio de la nube alrededor del cursor, en px CSS. */
const R = 150;
/**
 * Maximo de puntos de estela. Si el profiling muestra jank, bajar a 10 antes
 * que tocar PX.
 */
const MAX_TRAIL = 14;
/** Duracion nominal de un frame a 60Hz; base para normalizar los lerps por dt. */
const FRAME_MS = 1000 / 60;

/** Punto de la estela: posicion suavizada capturada y vida restante en [0,1]. */
interface TrailPoint {
  x: number;
  y: number;
  life: number;
}

/** Hash pseudoaleatorio determinista en [0,1). */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Value noise 2D con interpolacion smoothstep sobre el hash. */
function valueNoise(x: number, y: number): number {
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
 * Factor de lerp equivalente a aplicar `k` una vez por frame a 60Hz, ajustado
 * al dt real para que la velocidad no dependa del refresh rate del monitor.
 */
function lerpK(k: number, dtMs: number): number {
  return 1 - Math.pow(1 - k, dtMs / FRAME_MS);
}

/**
 * Nube de pixeles con dithering que sigue al cursor dentro del hero, con una
 * estela que decae detras del movimiento.
 *
 * Canvas absoluto detras del contenido, sin eventos propios de puntero: escucha
 * mousemove en document para seguir el cursor, y desaparece con fade-out cuando
 * el cursor sale del documento (mouseleave en documentElement) o la ventana
 * pierde foco (blur). Con la pestana oculta (visibilitychange) el navegador
 * pausa rAF, asi que ahi se limpia el canvas de inmediato en vez de animar el
 * fade. La estela es una cola de puntos repintados cada frame (clearRect
 * completo), nunca un fade del frame anterior via globalAlpha/destination-out,
 * que emborrona los pixeles y rompe la estetica de dithering. No hace nada en
 * dispositivos touch ni con prefers-reduced-motion.
 */
export function PixelCloud(): JSX.Element {
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
    // Alias no-nulos: TS no conserva el narrowing de arriba dentro de los closures.
    const cv = canvas;
    const ctx = context;

    let width = 0;
    let height = 0;

    // El canvas es inset-0, asi que su propio box mide y posiciona igual que el
    // contenedor del hero: se observa y se mide el canvas directamente.
    function resize(): void {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = cv.clientWidth;
      height = cv.clientHeight;
      cv.width = width * dpr;
      cv.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    function clearCanvas(): void {
      ctx.clearRect(0, 0, width, height);
    }

    let targetX = 0;
    let targetY = 0;
    let posX = 0;
    let posY = 0;
    let lastClientX = 0;
    let lastClientY = 0;
    let inside = false;
    let vis = 0;
    let t = 0;
    let lastPush = 0;
    let rafId = 0;
    let lastTime = 0;
    let running = false;
    let heroVisible = true;
    let disabled = false;
    const trail: TrailPoint[] = [];

    /**
     * Pinta una nube ditherizada centrada en (cx, cy), iterando solo el
     * bounding box del radio. Devuelve si pinto al menos una celda.
     */
    function drawCloud(cx: number, cy: number, radius: number, fuerza: number): boolean {
      const x0 = Math.max(0, Math.floor((cx - radius) / PX));
      const x1 = Math.min(Math.ceil(width / PX), Math.ceil((cx + radius) / PX));
      const y0 = Math.max(0, Math.floor((cy - radius) / PX));
      const y1 = Math.min(Math.ceil(height / PX), Math.ceil((cy + radius) / PX));

      let drew = false;
      for (let gx = x0; gx < x1; gx++) {
        for (let gy = y0; gy < y1; gy++) {
          const dx = gx * PX + PX / 2 - cx;
          const dy = gy * PX + PX / 2 - cy;
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
            ctx.fillRect(gx * PX, gy * PX, PX - 1, PX - 1);
            drew = true;
          }
        }
      }
      return drew;
    }

    function frame(now: number): void {
      if (lastTime === 0) lastTime = now;
      // Tope de 100ms: tras una pausa larga de rAF el estado avanza un paso
      // normal en vez de saltar.
      const dt = Math.min(now - lastTime, 100);
      lastTime = now;
      const step = dt / FRAME_MS;
      t += dt * 0.001;
      vis += ((inside ? 1 : 0) - vis) * lerpK(inside ? 0.12 : 0.18, dt);
      if (vis < 0.01) {
        clearCanvas();
        // Sin nube no debe sobrevivir estela: al regresar no aparece una vieja.
        trail.length = 0;
        // Nube apagada y cursor fuera: se detiene el loop hasta el proximo mousemove.
        if (!inside) {
          running = false;
          return;
        }
        rafId = requestAnimationFrame(frame);
        return;
      }
      const kPos = lerpK(0.07, dt);
      posX += (targetX - posX) * kPos;
      posY += (targetY - posY) * kPos;
      clearCanvas();

      // Estela: decae, expira y se alimenta con la posicion suavizada actual.
      for (const p of trail) p.life -= 0.028 * step;
      while (trail.length > 0 && (trail[0]?.life ?? 0) <= 0) trail.shift();
      if (inside && t - lastPush > 0.03) {
        trail.push({ x: posX, y: posY, life: 1 });
        if (trail.length > MAX_TRAIL) trail.shift();
        lastPush = t;
      }

      // Estela primero: la nube principal queda encima.
      let drewAny = false;
      for (const p of trail) {
        if (drawCloud(p.x, p.y, R * (0.35 + p.life * 0.45), p.life * 0.55 * vis)) {
          drewAny = true;
        }
      }
      if (drawCloud(posX, posY, R, vis)) drewAny = true;
      ctx.globalAlpha = 1;

      // Cursor en el documento pero lejos del hero, sin nada que dibujar y todo
      // convergido: se detiene el loop; el proximo mousemove lo relanza. La
      // estela (invisible: sus puntos tampoco pintaron) se vacia para no dejar
      // puntos congelados que reaparecerian al relanzar.
      if (
        !drewAny &&
        vis > 0.99 &&
        Math.abs(targetX - posX) < 0.5 &&
        Math.abs(targetY - posY) < 0.5
      ) {
        trail.length = 0;
        running = false;
        return;
      }
      rafId = requestAnimationFrame(frame);
    }

    function start(): void {
      if (running || disabled || !heroVisible) return;
      running = true;
      lastTime = 0;
      rafId = requestAnimationFrame(frame);
    }

    function stop(): void {
      if (!running) return;
      running = false;
      cancelAnimationFrame(rafId);
    }

    function updateTarget(clientX: number, clientY: number): void {
      const rect = cv.getBoundingClientRect();
      targetX = clientX - rect.left;
      targetY = clientY - rect.top;
    }

    function onMouseMove(event: MouseEvent): void {
      if (disabled || !heroVisible) return;
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      updateTarget(event.clientX, event.clientY);
      // Al reaparecer, la nube nace donde este el cursor, sin viajar desde la
      // posicion vieja. La estela se vacia: si la salida fue tan corta que el
      // fade-out no llego a vis<0.01, quedarian puntos viejos como fantasma.
      if (!inside) {
        posX = targetX;
        posY = targetY;
        trail.length = 0;
        inside = true;
      }
      start();
    }

    // Con el cursor quieto, el scroll mueve el hero bajo el puntero: se
    // recalcula el target para que la nube siga pegada al cursor.
    function onScroll(): void {
      if (disabled || !heroVisible || !inside) return;
      updateTarget(lastClientX, lastClientY);
      start();
    }

    function leave(): void {
      inside = false;
      // Si el loop ya esta detenido (canvas limpio), no habra frames que
      // decaigan vis: se apaga aqui para que la proxima entrada haga fade-in.
      if (!running) {
        vis = 0;
        trail.length = 0;
      }
    }

    // Con rAF pausado (pestana oculta, hero fuera de viewport) el fade no puede
    // correr: se apaga y limpia de forma sincrona, estela incluida.
    function shutOff(): void {
      inside = false;
      stop();
      vis = 0;
      trail.length = 0;
      clearCanvas();
    }

    function onVisibilityChange(): void {
      if (document.hidden) shutOff();
    }

    function onReducedMotionChange(event: MediaQueryListEvent): void {
      disabled = event.matches;
      if (disabled) shutOff();
    }

    document.addEventListener('mousemove', onMouseMove);
    document.documentElement.addEventListener('mouseleave', leave);
    window.addEventListener('blur', leave);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('scroll', onScroll, { passive: true });
    reducedMotion.addEventListener('change', onReducedMotionChange);

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(cv);

    const intersectionObserver = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      heroVisible = entry?.isIntersecting ?? true;
      if (!heroVisible) shutOff();
    });
    intersectionObserver.observe(cv);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('mousemove', onMouseMove);
      document.documentElement.removeEventListener('mouseleave', leave);
      window.removeEventListener('blur', leave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('scroll', onScroll);
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
