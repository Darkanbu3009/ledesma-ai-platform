import { useEffect, useRef } from 'react';
import { drawCloud } from '../landing/pixelDither';
import { LedesmaLogo } from './LedesmaLogo';

/** Tamano de celda de la rejilla de la nube del panel de marca, en px CSS. */
const PX = 7;
/** Duracion del pulso de expansion al enviar el enlace, en segundos. */
const PULSE_S = 0.6;

/**
 * Bloque de texto de marca (eyebrow + titular + linea de soporte). Lo usa el
 * panel izquierdo en desktop y la pagina de login como bloque bajo el
 * formulario en movil.
 */
export function BrandCopy() {
  return (
    <div className="max-w-[320px]">
      <p className="font-mono text-[11px] uppercase tracking-[3px] text-[#B23E14]">
        Plataforma de agentes
      </p>
      <p className="mt-3 font-display text-[19px] font-medium leading-snug text-ink">
        Agentes que ejecutan trabajo real dentro de tus sistemas.
      </p>
      <p className="mt-3 text-[12.5px] text-muted">
        Multi-tenant &middot; BYOK &middot; Trazabilidad completa
      </p>
    </div>
  );
}

/**
 * Panel izquierdo de marca del login (solo desktop): logo apilado arriba,
 * bloque de texto anclado abajo y, detras, la nube ditherizada "respirando"
 * pintada con drawCloud (motor compartido pixelDither).
 *
 * La animacion no se monta en dispositivos touch ni con
 * prefers-reduced-motion: reduce (el panel queda con fondo hueso plano). Usa
 * un unico requestAnimationFrame, tope de devicePixelRatio 2, pausa con
 * visibilitychange y cleanup completo. El alpha global 0.75 se aplica como
 * opacidad CSS del canvas para no interferir con el globalAlpha por celda de
 * drawCloud.
 *
 * `sent` en true dispara UN pulso de expansion del radio (+12% y regreso,
 * ~600ms ease-out) como feedback de "enlace enviado"; solo en la transicion
 * false -> true, una sola vez por envio.
 */
export function BrandPanel({ sent }: { sent: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevSentRef = useRef(sent);
  const pulseQueuedRef = useRef(false);

  // Se encola el pulso solo al entrar al estado "enviado"; el loop lo consume.
  useEffect(() => {
    if (sent && !prevSentRef.current) pulseQueuedRef.current = true;
    prevSentRef.current = sent;
  }, [sent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // En touch o con reduced-motion la animacion no se monta: hueso plano.
    if (window.matchMedia('(hover: none)').matches) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) return;

    const context = canvas.getContext('2d');
    if (!context) return;
    const cv = canvas;
    const ctx = context;

    let width = 0;
    let height = 0;
    let t = 0;
    let lastTime = 0;
    let rafId = 0;
    let running = false;
    let disabled = false;
    /** Instante (en t) en que arranco el pulso; negativo = sin pulso activo. */
    let pulseStart = -1;

    function frame(now: number): void {
      if (lastTime === 0) lastTime = now;
      // Tope de 100ms: tras una pausa larga de rAF la fase avanza un paso
      // normal en vez de saltar.
      const dt = Math.min(now - lastTime, 100);
      lastTime = now;
      t += dt * 0.001;

      if (pulseQueuedRef.current) {
        pulseQueuedRef.current = false;
        pulseStart = t;
      }
      // Pulso de expansion: sube a +12% y regresa en ~600ms con ease-out.
      let pulse = 1;
      if (pulseStart >= 0) {
        const e = (t - pulseStart) / PULSE_S;
        if (e >= 1) {
          pulseStart = -1;
        } else {
          const eased = 1 - (1 - e) * (1 - e);
          pulse = 1 + 0.12 * Math.sin(Math.PI * eased);
        }
      }

      ctx.clearRect(0, 0, width, height);
      const cx = width * 0.72 + Math.cos(t * 0.25) * 14;
      const cy = height * 0.42 + Math.sin(t * 0.32) * 16;
      const radius = Math.min(width, height) * 0.46 * (1 + 0.05 * Math.sin(t * 0.5)) * pulse;
      drawCloud(ctx, cx, cy, radius, 1, t, PX);
      ctx.globalAlpha = 1;
      rafId = requestAnimationFrame(frame);
    }

    function start(): void {
      if (running || disabled || width === 0 || height === 0 || document.hidden) return;
      running = true;
      lastTime = 0;
      rafId = requestAnimationFrame(frame);
    }

    function stop(): void {
      if (!running) return;
      running = false;
      cancelAnimationFrame(rafId);
    }

    // Con el panel oculto (columna unica <1024px) el canvas mide 0 y el loop
    // se detiene; al reaparecer con tamano real se relanza.
    function resize(): void {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = cv.clientWidth;
      height = cv.clientHeight;
      cv.width = width * dpr;
      cv.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (width === 0 || height === 0) stop();
      else start();
    }
    resize();

    function onVisibilityChange(): void {
      if (document.hidden) stop();
      else start();
    }

    function onReducedMotionChange(event: MediaQueryListEvent): void {
      disabled = event.matches;
      if (disabled) {
        stop();
        ctx.clearRect(0, 0, width, height);
      } else {
        start();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.addEventListener('change', onReducedMotionChange);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(cv);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotion.removeEventListener('change', onReducedMotionChange);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div className="relative flex h-full min-h-screen w-full flex-col justify-between overflow-hidden bg-cream p-10">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-75"
      />
      <div className="relative">
        <LedesmaLogo />
      </div>
      <div className="relative">
        <BrandCopy />
      </div>
    </div>
  );
}
