import { useEffect, useRef } from 'react';

/**
 * Confirmacion de borrado de una receta. NO se borra al primer click: el usuario confirma aqui antes de
 * que la pantalla dispare el DELETE. Accesible: dialog modal, cierra con Escape o click en el fondo y
 * enfoca el boton de cancelar al abrir. Espeja DeleteScheduledTaskDialog.
 */
export function DeleteRecipeDialog({
  open,
  name,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  name: string;
  busy: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Ref al ultimo onCancel: el efecto solo depende de `open`, asi el listener de Escape no se
  // re-adjunta en cada render del padre (onCancel suele ser una arrow recreada cada vez).
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancelRef.current();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onCancel} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Eliminar receta"
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-card-hover"
      >
        <h2 className="font-display text-lg font-bold text-ink">Eliminar receta</h2>
        <p className="mt-2 text-sm text-muted">
          Vas a eliminar la receta <span className="font-medium text-ink">{name}</span>. Esta accion no
          se puede deshacer.
        </p>
        {error && (
          <div className="mt-4 rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa">
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
            className="rounded-[10px] bg-brasa px-4 py-2 text-sm font-semibold text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}
