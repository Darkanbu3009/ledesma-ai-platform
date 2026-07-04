import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Anillo de foco visible por teclado, consistente con el que ya traia el componente `Button`. Para los
 * controles editoriales con `className` directo que no lo declaraban (hallazgo M7). Solo aparece con
 * `:focus-visible` (navegacion por teclado): no cambia la apariencia con el mouse.
 */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brasa focus-visible:ring-offset-2';
