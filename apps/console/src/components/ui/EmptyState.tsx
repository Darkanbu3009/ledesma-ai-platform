import { type ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Estado vacio compartido. Captura el esqueleto comun (columna centrada + titulo + subtitulo) que cada
 * pantalla redefinia, dejando lo unico de cada una como slots: la `media` (la maqueta decorativa o el
 * icono), el `eyebrow` (badge "EMPIEZA AQUI"), la `action` (pildora) y un `footer` opcional.
 *
 * Dos variantes, exactamente como ya existian:
 *  - `editorial` (default): estados vacios con badge y CTA (Agentes, Credenciales, Recetas, Tareas,
 *    Triggers).
 *  - `centered`: estados centrados sin CTA (los "Locked" de plan y el vacio de Actividad).
 *
 * `compact` (opt-in, aditivo) comprime solo los margenes verticales -- mismas fuentes y contenido --
 * para pantallas donde el estado vacio convive con mas bloques y debe caber sin scroll (el Panel).
 */
export function EmptyState({
  variant = 'editorial',
  compact = false,
  media,
  eyebrow,
  title,
  description,
  action,
  footer,
  className,
}: {
  variant?: 'editorial' | 'centered';
  compact?: boolean;
  media?: ReactNode;
  eyebrow?: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const centered = variant === 'centered';
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center text-center',
        centered && (compact ? 'mt-5' : 'mt-10'),
        className,
      )}
    >
      {media}
      {eyebrow && (
        <span className="inline-flex items-center rounded-md bg-brasa-soft px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#993C1D]">
          {eyebrow}
        </span>
      )}
      <h2
        className={cn(
          'max-w-md font-display text-[22px] font-bold leading-[1.2] text-ink',
          compact ? 'mt-3' : centered ? 'mt-5' : 'mt-4',
        )}
      >
        {title}
      </h2>
      <p
        className={cn(
          'text-[13px] text-muted',
          compact ? 'mt-2 max-w-lg leading-[1.5]' : 'mt-3 max-w-md',
          !compact && (centered ? 'leading-[1.6]' : 'leading-[1.5]'),
        )}
      >
        {description}
      </p>
      {action && <div className={compact ? 'mt-4' : 'mt-7'}>{action}</div>}
      {footer}
    </div>
  );
}
