import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled'),
  );
}

/** Como resolver el foco inicial: un ref concreto, el primer foco disponible, o dejarlo sin tocar. */
type InitialFocus<T extends HTMLElement> = RefObject<T | null> | 'first' | 'none';

/**
 * Gestion de foco accesible para dialogos modales. Generaliza el patron correcto que ya
 * implementaba `SecretRevealDialog`: trampa de foco (Tab cicla dentro del modal), cierre con Escape
 * y RESTAURACION del foco al disparador al cerrar. No renderiza nada ni cambia la apariencia: solo
 * devuelve el ref que el contenedor del dialogo debe recibir.
 *
 * El hook es el UNICO que mueve el foco al abrir: captura el elemento activo (el disparador) al
 * inicio de su efecto, antes de enfocar nada, y lo restaura al cerrar. Por eso los dialogos NO deben
 * enfocar por su cuenta; le pasan el objetivo via `initialFocus`.
 *
 * Soporta los dos patrones de montaje que ya conviven en la consola sin cambiar su comportamiento:
 *  - Dialogos montados condicionalmente (se montan al abrir): no pasan `open` (default true).
 *  - Dialogos siempre montados que alternan una prop `open`: pasan `open`.
 *
 * `closeOnEscape=false` reproduce el caso de `SecretRevealDialog`, que a proposito NO cierra con
 * Escape (perder el secreto es destructivo).
 */
export function useDialog<T extends HTMLElement = HTMLElement>({
  open = true,
  onClose,
  closeOnEscape = true,
  initialFocus = 'first',
}: {
  open?: boolean;
  onClose: () => void;
  closeOnEscape?: boolean;
  initialFocus?: InitialFocus<T>;
}): RefObject<HTMLDivElement | null> {
  const dialogRef = useRef<HTMLDivElement>(null);

  // `onClose` suele recrearse en cada render del padre; lo leemos por ref para no re-adjuntar el
  // listener en cada render (mismo criterio que ya usaban los dialogos de borrado).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    // Capturamos el disparador ANTES de mover el foco. El hook es el unico que enfoca al abrir, asi
    // que aqui el foco todavia esta en quien abrio el dialogo.
    const previous = document.activeElement as HTMLElement | null;

    if (initialFocus !== 'none') {
      const explicit = initialFocus !== 'first' ? initialFocus.current : null;
      (explicit ?? focusableElements(dialogRef.current)[0])?.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (closeOnEscape && e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const container = dialogRef.current;
      if (!container) return;
      const focusables = focusableElements(container);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      // Si el foco esta en un extremo (o escapo del modal), lo devolvemos adentro en ambos sentidos.
      if (e.shiftKey && (active === first || !container.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !container.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
    // Depende solo de `open`: `initialFocus`/`closeOnEscape` son estables por dialogo y no deben
    // re-adjuntar el listener ni re-enfocar en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return dialogRef;
}
