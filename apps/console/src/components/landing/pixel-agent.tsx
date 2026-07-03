import { useEffect, useRef, type JSX } from 'react';
import { drawCloud } from './pixelDither';

/** Tamano de celda de la rejilla de pixeles del agente, en px CSS. */
const PX = 5;
/** Radio de la nube del agente, en px CSS. */
const R = 44;
/** Radio base de los puntos de la estela, en px CSS. */
const TRAIL_R = 34;
/** Distancia del carril del agente al borde derecho del viewport, en px CSS. */
const LANE_OFFSET = 72;
/** Maximo de puntos de estela. */
const MAX_TRAIL = 10;
/** Velocidad vertical minima (px/frame) para alimentar la estela. */
const TRAIL_SPEED = 0.8;
/** Fraccion de la altura del hero que hay que scrollear para que aparezca. */
const HERO_EXIT = 0.6;

/** Punto de la estela: posicion capturada y vida restante en [0,1]. */
interface TrailPoint {
  x: number;
  y: number;
  life: number;
}

/**
 * Agente acompanante: la misma nube dithered del hero (motor compartido en
 * pixelDither.ts) viviendo en el margen derecho de la landing. Viaja en
 * vertical siguiendo el progreso de scroll con retraso (lerp), deja estela
 * cuando la velocidad es alta y hace bobbing en reposo. Aparece con fade solo
 * despues de salir del hero, para no competir con PixelCloud.
 *
 * Canvas fixed a viewport completo, pointer-events:none y z-index por debajo
 * del navbar sticky (z-40): el agente pasa por detras del nav y nunca
 * intercepta clicks. El scroll se lee dentro del frame de rAF (sin listener de
 * scroll que pinte directo) y el loop se pausa con la pestana oculta.
 *
 * No monta listeners de render cuando el viewport es menor a 1280px (el margen
 * derecho no existe en tablet/movil), en dispositivos touch ni con
 * prefers-reduced-motion; esas condiciones se re-evaluan si cambian.
 */
export function PixelAgent(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    // Alias no-nulos: TS no conserva el narrowing de arriba dentro de los closures.
    const cv = canvas;
    const ctx = context;

    const touch = window.matchMedia('(hover: none)');
    const wide = window.matchMedia('(min-width: 1280px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    /** Desmonta los listeners de render activos; null cuando el efecto esta apagado. */
    let teardown: (() => void) | null = null;

    /** Monta listeners de render + loop de rAF. Devuelve su propio cleanup. */
    function setup(): () => void {
      let width = 0;
      let height = 0;
      let heroHeight = 0;

      function resize(): void {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        cv.width = width * dpr;
        cv.height = height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        measureHero();
      }

      // El hero es la primera seccion del main de la landing; se mide el nodo
      // real en vez de hardcodear px. Sin hero (no deberia pasar) se usa la
      // altura del viewport como aproximacion.
      function measureHero(): void {
        const hero = document.querySelector('main > section:first-of-type');
        heroHeight = hero instanceof HTMLElement ? hero.offsetHeight : window.innerHeight;
      }

      let y = 0;
      let prevY = 0;
      let vis = 0;
      let t = 0;
      let rafId = 0;
      let lastTime = 0;
      let started = false;
      const trail: TrailPoint[] = [];

      function clearCanvas(): void {
        ctx.clearRect(0, 0, width, height);
      }

      function frame(now: number): void {
        rafId = requestAnimationFrame(frame);
        if (lastTime === 0) lastTime = now;
        // Tope de 100ms: tras una pausa larga de rAF el estado avanza un paso
        // normal en vez de saltar.
        const dt = Math.min(now - lastTime, 100);
        lastTime = now;
        t += dt * 0.001;

        // Scroll leido dentro del frame: nada pinta desde un listener de scroll.
        const scrollY = window.scrollY;
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const progress = maxScroll > 0 ? Math.min(1, Math.max(0, scrollY / maxScroll)) : 0;

        const targetY = (0.16 + progress * 0.68) * height;
        // Antes del primer frame visible el agente nace en su objetivo, sin
        // viajar desde y=0.
        if (!started) {
          y = targetY;
          prevY = targetY;
          started = true;
        }
        y += (targetY - y) * 0.06;

        // Visible solo fuera del hero: asi no compite con PixelCloud.
        const visTarget = scrollY > heroHeight * HERO_EXIT ? 1 : 0;
        vis += (visTarget - vis) * 0.08;
        if (vis < 0.01) {
          clearCanvas();
          trail.length = 0;
          prevY = y;
          return;
        }

        const x = width - LANE_OFFSET;
        const speed = Math.abs(y - prevY);
        prevY = y;
        // Bobbing en reposo sobre la posicion suavizada.
        const yVis = y + Math.sin(t * 1.6) * 5;

        // Estela: decae, expira y se alimenta solo con velocidad alta.
        for (const p of trail) p.life -= 0.05;
        while (trail.length > 0 && (trail[0]?.life ?? 0) <= 0) trail.shift();
        if (speed > TRAIL_SPEED) {
          trail.push({ x, y: yVis, life: 1 });
          if (trail.length > MAX_TRAIL) trail.shift();
        }

        // Misma regla que el hero: clearRect completo y repintar cada frame,
        // nunca fade del frame anterior (emborrona el dithering).
        clearCanvas();
        for (const p of trail) {
          drawCloud(ctx, p.x, p.y, TRAIL_R * (0.4 + p.life * 0.4), p.life * 0.5 * vis, t, PX);
        }
        drawCloud(ctx, x, yVis, R, vis, t, PX);
        ctx.globalAlpha = 1;
      }

      function start(): void {
        if (rafId !== 0) return;
        lastTime = 0;
        rafId = requestAnimationFrame(frame);
      }

      function stop(): void {
        if (rafId === 0) return;
        cancelAnimationFrame(rafId);
        rafId = 0;
      }

      function onVisibilityChange(): void {
        if (document.hidden) stop();
        else start();
      }

      resize();
      window.addEventListener('resize', resize);
      document.addEventListener('visibilitychange', onVisibilityChange);
      if (!document.hidden) start();

      return () => {
        stop();
        window.removeEventListener('resize', resize);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        clearCanvas();
      };
    }

    // Las condiciones de apagado total se re-evaluan al cambiar cualquiera de
    // los media queries (p. ej. la ventana cruza los 1280px).
    function evaluate(): void {
      const shouldRun = wide.matches && !touch.matches && !reducedMotion.matches;
      if (shouldRun && teardown === null) {
        teardown = setup();
      } else if (!shouldRun && teardown !== null) {
        teardown();
        teardown = null;
      }
    }

    evaluate();
    wide.addEventListener('change', evaluate);
    touch.addEventListener('change', evaluate);
    reducedMotion.addEventListener('change', evaluate);

    return () => {
      wide.removeEventListener('change', evaluate);
      touch.removeEventListener('change', evaluate);
      reducedMotion.removeEventListener('change', evaluate);
      teardown?.();
      teardown = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-30 h-full w-full"
    />
  );
}
