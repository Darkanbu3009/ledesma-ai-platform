import { type JSX, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface EyebrowProps {
  children: ReactNode;
  className?: string;
}

/**
 * Eyebrow de la landing del showroom: etiqueta corta en MAYUSCULAS con JetBrains
 * Mono. Es el patron de "eyebrow" que se repite en cada seccion del mockup
 * (eyebrows en mono, headings en sentence case).
 */
export function Eyebrow({ children, className }: EyebrowProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center font-jetbrains text-xs font-medium uppercase tracking-[0.18em] text-foreground-secondary',
        className
      )}
    >
      {children}
    </span>
  );
}
