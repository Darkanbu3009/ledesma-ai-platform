import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Keyframes del reveal de tarjetas de la landing, inyectados una vez por seccion via
 * `<style>` (mismo patron que los keyframes del widget de chat y del hero). Se aplican
 * con `motion-safe:[animation:...]`, asi `prefers-reduced-motion: reduce` deja las
 * tarjetas visibles sin movimiento.
 */
export const REVEAL_KEYFRAMES =
  '@keyframes landing-reveal { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }';

/**
 * Clases del reveal para cada tarjeta. Antes de revelarse la tarjeta queda invisible
 * (`opacity-0`); al revelarse se retira esa clase y corre la animacion de entrada
 * (fade-in + subida). Se usa animacion con relleno `backwards` (y no una transicion)
 * para que el stagger via `animation-delay` no interfiera con las transiciones de
 * hover que ya tienen algunas tarjetas: al terminar la animacion la tarjeta vuelve a
 * sus estilos naturales (visible, sin transform) y ese es el estado estable.
 */
export function revealAnimationClass(revealed: boolean): string {
  return revealed
    ? 'motion-safe:[animation:landing-reveal_0.5s_ease-out_backwards]'
    : 'opacity-0';
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Revela un bloque de la landing cuando entra al viewport, una sola vez. Devuelve el
 * ref a colgar del contenedor observado y el flag `revealed` que dispara la animacion
 * de entrada de sus tarjetas.
 *
 * El estado estable es "revelado": si el usuario prefiere movimiento reducido o el
 * entorno no tiene IntersectionObserver, `revealed` arranca en true desde el
 * inicializador (sin setState sincrono dentro del efecto) y las tarjetas se muestran
 * de inmediato. El observer se desconecta al primer cruce y al desmontar.
 */
export function useRevealOnScroll<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  revealed: boolean;
} {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState<boolean>(
    () => prefersReducedMotion() || typeof IntersectionObserver === 'undefined'
  );

  useEffect(() => {
    if (revealed) return;
    const el = ref.current;
    if (el === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [revealed]);

  return { ref, revealed };
}
