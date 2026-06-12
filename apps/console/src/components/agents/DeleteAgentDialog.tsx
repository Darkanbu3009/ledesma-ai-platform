export function DeleteAgentDialog({
  open,
  agentName,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  agentName: string;
  busy: boolean;
  error?: string;
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
        aria-label="Eliminar agente"
        className="relative w-full max-w-sm rounded-xl border border-grafito-border bg-grafito p-6 shadow-2xl shadow-black/40"
      >
        <h2 className="font-display text-lg font-semibold text-hueso">Eliminar agente</h2>
        <p className="mt-2 text-sm text-hueso-muted">
          Vas a eliminar <span className="text-hueso">{agentName}</span>. Esta accion no se puede
          deshacer.
        </p>
        {error && (
          <div className="mt-4 rounded-lg border border-brasa/40 bg-brasa/10 px-4 py-3 text-sm text-brasa">
            {error}
          </div>
        )}
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
            className="rounded-lg bg-brasa px-4 py-2 text-sm font-semibold text-carbon transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}
