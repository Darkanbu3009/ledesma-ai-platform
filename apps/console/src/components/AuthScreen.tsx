import type { ReactNode } from 'react';
import { BrandMark } from './BrandMark';

/**
 * Clases de input compartidas por las pantallas de acceso (login y registro): borde sutil, fondo
 * de campo, radio 8px (rounded-lg) y foco brasa. Asi login y registro lucen como hermanos.
 */
export const authInputClass =
  'h-10 w-full rounded-lg border border-line bg-field px-3.5 text-sm text-ink outline-none transition placeholder:text-muted-soft focus:border-brasa focus:ring-2 focus:ring-brasa/20';

/** Clase de label compartida: pequena, peso medio, color tinta. */
export const authLabelClass = 'mb-2 block text-sm font-medium text-ink';

/**
 * Marco editorial de las pantallas de acceso: fondo hueso, logo oficial centrado, wordmark
 * "Ledesma / AI LABS" y una tarjeta blanca flotante con el contenido. `footer` es la linea
 * discreta opcional bajo la tarjeta (p. ej. "Acceso solo por invitacion." o "Cerrar sesion").
 */
export function AuthScreen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Marca: logo oficial centrado + wordmark editorial (Ledesma / AI LABS). */}
        <div className="mb-9 flex flex-col items-center text-center">
          <BrandMark className="h-[46px] w-[46px]" />
          <div className="mt-5">
            <p className="font-display text-2xl font-semibold tracking-tight text-ink">Ledesma</p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.24em] text-muted">
              AI LABS
            </p>
          </div>
        </div>

        {/* Tarjeta blanca flotante con el contenido de cada pantalla. */}
        <div className="rounded-2xl border border-line bg-surface p-7 shadow-card-hover sm:p-8">
          {children}
        </div>

        {footer ? (
          <div className="mt-6 text-center text-xs text-muted-soft">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Boton primario de las pantallas de acceso: ancho completo, brasa, con spinner mientras envia.
 */
export function SubmitButton({
  pending = false,
  pendingLabel = 'Enviando...',
  children,
}: {
  pending?: boolean;
  pendingLabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-brasa px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-hidden="true"
          />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
