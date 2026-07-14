import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useTestTool } from '../../lib/mutations';
import { tryParseJsonObject } from '../../lib/tool-schema';
import { inputClass } from '../ui/Field';
import { useDialog } from '../ui/useDialog';

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Dialogo para probar una tool GUARDADA contra su webhook real. El padre lo monta solo
 * mientras esta abierto: cerrar desmonta y restablece todo el estado. */
export function TestToolDialog({
  agentId,
  toolName,
  initialInput,
  onClose,
}: {
  agentId: string;
  toolName: string;
  initialInput: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState(initialInput);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const testTool = useTestTool(agentId);

  // Antes no tenia ninguna gestion de foco/teclado; ahora hereda trampa de foco, Escape y retorno del
  // hook compartido. Por defecto enfoca el primer control (el textarea del input).
  const dialogRef = useDialog({ onClose });

  const inputId = useId();
  const jsonErrorId = `${inputId}-error`;

  function handleRun() {
    const parsed = tryParseJsonObject(input);
    if (!parsed) {
      setJsonError(t('agentes.probarTool.inputInvalido'));
      return;
    }
    setJsonError(null);
    testTool.mutate({ toolName, input: parsed });
  }

  const result = testTool.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('agentes.probarTool.titulo', { name: toolName })}
        className="relative w-full max-w-lg rounded-xl border border-grafito-border bg-grafito p-6 shadow-2xl shadow-black/40"
      >
        <h2 className="font-display text-lg font-semibold text-hueso">
          {t('agentes.probarTool.titulo', { name: toolName })}
        </h2>
        <p className="mt-2 text-sm text-hueso-muted">{t('agentes.probarTool.descripcion')}</p>

        <label htmlFor={inputId} className="mb-2 mt-4 block text-sm font-medium text-hueso">
          Input (JSON)
        </label>
        <textarea
          id={inputId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={6}
          spellCheck={false}
          aria-describedby={jsonError ? jsonErrorId : undefined}
          aria-invalid={jsonError ? true : undefined}
          className={`${inputClass} font-mono text-xs`}
        />
        {jsonError && (
          <p id={jsonErrorId} role="alert" className="mt-1.5 text-sm text-brasa">
            {jsonError}
          </p>
        )}

        {testTool.isError && (
          <p role="alert" className="mt-3 text-sm text-brasa">
            {t('agentes.probarTool.errorEjecutar')}
          </p>
        )}

        {result && (
          <div className="mt-4">
            <div className="flex items-center gap-3">
              {result.isError ? (
                <span className="rounded-md border border-brasa px-2 py-0.5 text-xs font-semibold text-brasa">
                  ERROR
                </span>
              ) : (
                <span className="rounded-md border border-grafito-border px-2 py-0.5 text-xs font-semibold text-hueso">
                  OK
                </span>
              )}
              <span className="text-xs text-hueso-muted">{formatDuration(result.durationMs)}</span>
            </div>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-grafito-border bg-carbon p-3 text-xs text-hueso">
              {result.content}
            </pre>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
          >
            {t('agentes.comun.cerrar')}
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={testTool.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-brasa px-4 py-2 text-sm font-semibold text-carbon transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {testTool.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {testTool.isPending ? t('agentes.probarTool.ejecutando') : t('agentes.probarTool.ejecutar')}
          </button>
        </div>
      </div>
    </div>
  );
}
