import { useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import type { TriggerAuthMode } from '../../lib/triggers';
import { useDialog } from '../ui/useDialog';

/**
 * Confirmacion de ROTACION del secreto/token de un trigger. Rotar invalida el material anterior de
 * inmediato: el sistema externo deja de disparar hasta que se actualice con el nuevo valor. Por eso se
 * confirma antes y se avisa el impacto. Accesible (via useDialog): dialog modal con trampa de foco,
 * Escape/fondo cancelan, enfoca Cancelar al abrir y devuelve el foco al cerrar. Tras confirmar, la
 * pantalla abre el modal "copia esto ahora" con el material nuevo.
 */
export function RotateTriggerDialog({
  open,
  authMode,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  authMode: TriggerAuthMode;
  busy: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialog({ open, onClose: onCancel, initialFocus: cancelRef });

  if (!open) return null;

  const material = authMode === 'hmac' ? 'secreto HMAC' : 'token';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onCancel} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Rotar el secreto del trigger"
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-card-hover"
      >
        <h2 className="font-display text-lg font-bold text-ink">Rotar {material}</h2>
        <p className="mt-2 text-sm text-muted">
          Se generara un {material} nuevo de inmediato y el anterior dejara de servir. Tu sistema
          externo dejara de disparar el trigger hasta que lo actualices con el valor nuevo, que veras
          UNA sola vez.
        </p>
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
          >
            {error}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-[10px] border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-[10px] bg-brasa px-4 py-2 text-sm font-semibold text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <RotateCcw className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Rotando...' : 'Rotar'}
          </button>
        </div>
      </div>
    </div>
  );
}
