import { RotateCcw } from 'lucide-react';

export function RotateSecretDialog({
  open,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Rotar el secreto de webhooks"
        className="relative w-full max-w-sm rounded-xl border border-grafito-border bg-grafito p-6 shadow-2xl shadow-black/40"
      >
        <h2 className="font-display text-lg font-semibold text-hueso">
          Rotar el secreto de webhooks
        </h2>
        <p className="mt-2 text-sm text-hueso-muted">
          Se generara un secreto nuevo de inmediato. Tus sistemas que verifican la firma dejaran
          de validar hasta que actualices LEDESMA_WEBHOOK_SECRET con el valor nuevo.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-brasa px-4 py-2 text-sm font-semibold text-carbon transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <RotateCcw className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Rotando...' : 'Rotar'}
          </button>
        </div>
      </div>
    </div>
  );
}
