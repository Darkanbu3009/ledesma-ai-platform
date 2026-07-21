import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ImageOff, Loader2, ShieldAlert, X } from 'lucide-react';
import type { AprobacionWeb } from '../../lib/aprobaciones';
import { MAX_INSTRUCCION_CHARS } from '../../lib/aprobaciones';
import { useScreenshotAprobacion } from '../../lib/queries';
import { useAprobarAprobacion, useRechazarAprobacion } from '../../lib/mutations';
import { ApiError } from '../../lib/api';
import { useDialog } from '../ui/useDialog';

/**
 * Modal del CHECKPOINT DE APROBACION HUMANA (7.1e): el usuario ve EXACTAMENTE que va a pasar (el
 * screenshot grande de lo que el agente tenia en pantalla + la accion propuesta en una linea) y
 * decide en un tap: Aprobar o Rechazar. "Rechazar con instruccion" abre un campo de texto y la
 * tarea continua con ese ajuste sin ejecutar la accion original.
 *
 * Accesible via el hook compartido useDialog (trampa de foco, Escape, retorno del foco al cerrar),
 * el mismo patron del modal de triggers (5.4b). Cerrar el modal NO decide nada: la aprobacion sigue
 * pendiente (y expira sola) y el banner sigue visible.
 */
export function AprobacionDialog({
  aprobacion,
  onCerrar,
}: {
  aprobacion: AprobacionWeb;
  onCerrar: () => void;
}) {
  const { t } = useTranslation();
  const aprobarRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialog({ onClose: onCerrar, initialFocus: aprobarRef });
  const { data: screenshotUrl, isLoading: screenshotCargando } = useScreenshotAprobacion(
    aprobacion.screenshotPath,
  );
  const aprobar = useAprobarAprobacion();
  const rechazar = useRechazarAprobacion();

  // Sub-formulario "rechazar con instruccion": estado local del texto; se abre con el tercer boton.
  const [conInstruccion, setConInstruccion] = useState(false);
  const [instruccion, setInstruccion] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ocupado = aprobar.isPending || rechazar.isPending;

  function mensajeDeError(err: unknown): string {
    if (err instanceof ApiError && err.status === 409) return t('aprobaciones.modal.conflicto');
    return t('aprobaciones.modal.fallo');
  }

  function onAprobar() {
    setError(null);
    aprobar.mutate(aprobacion.id, {
      onSuccess: onCerrar,
      onError: (err) => setError(mensajeDeError(err)),
    });
  }

  function onRechazar(conAjuste: boolean) {
    setError(null);
    const texto = instruccion.trim();
    rechazar.mutate(
      { id: aprobacion.id, ...(conAjuste && texto !== '' ? { instruccion: texto } : {}) },
      {
        onSuccess: onCerrar,
        onError: (err) => setError(mensajeDeError(err)),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-ink/40" onClick={onCerrar} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="aprobacion-dialog-title"
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card-hover"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-6 py-4">
          <div className="min-w-0">
            <h2
              id="aprobacion-dialog-title"
              className="flex items-center gap-2 font-display text-lg font-bold text-ink"
            >
              <ShieldAlert className="h-5 w-5 flex-none text-brasa" aria-hidden="true" />
              {t('aprobaciones.modal.titulo')}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t(
                aprobacion.accionTipo === 'financiera'
                  ? 'aprobaciones.modal.subtituloFinanciera'
                  : 'aprobaciones.modal.subtituloIrreversible',
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label={t('aprobaciones.modal.cerrarAria')}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted transition hover:bg-line-soft hover:text-ink"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {/* El screenshot GRANDE: exactamente lo que el agente tenia en pantalla al pausar. */}
          <div className="overflow-hidden rounded-xl border border-line bg-ink/5">
            {screenshotUrl ? (
              <img
                src={screenshotUrl}
                alt={t('aprobaciones.modal.screenshotAlt')}
                className="max-h-[45vh] w-full object-contain"
              />
            ) : (
              <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted">
                {aprobacion.screenshotPath !== null && screenshotCargando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <ImageOff className="h-4 w-4" />
                    {t('aprobaciones.modal.sinScreenshot')}
                  </>
                )}
              </div>
            )}
          </div>

          {/* La accion propuesta, en UNA linea de lenguaje natural. */}
          <p className="mt-4 rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-ink">
            {aprobacion.descripcion}
          </p>
          <p className="mt-2 text-xs text-muted-soft">{t('aprobaciones.modal.expira')}</p>

          {conInstruccion && (
            <div className="mt-4">
              <label
                htmlFor="aprobacion-instruccion"
                className="mb-1.5 block text-sm font-medium text-ink"
              >
                {t('aprobaciones.modal.instruccionLabel')}
              </label>
              <textarea
                id="aprobacion-instruccion"
                value={instruccion}
                onChange={(e) => setInstruccion(e.target.value)}
                maxLength={MAX_INSTRUCCION_CHARS}
                rows={3}
                placeholder={t('aprobaciones.modal.instruccionPlaceholder')}
                className="w-full rounded-xl border border-line bg-field px-3.5 py-2.5 text-sm text-ink placeholder:text-muted-soft focus:border-brasa focus:outline-none"
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
            >
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 border-t border-line-soft px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
          {conInstruccion ? (
            <>
              <button
                type="button"
                onClick={() => setConInstruccion(false)}
                disabled={ocupado}
                className="inline-flex items-center justify-center rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('aprobaciones.modal.volver')}
              </button>
              <button
                type="button"
                onClick={() => onRechazar(true)}
                disabled={ocupado || instruccion.trim() === ''}
                className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {rechazar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('aprobaciones.modal.enviarInstruccion')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setConInstruccion(true)}
                disabled={ocupado}
                className="inline-flex items-center justify-center rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('aprobaciones.modal.rechazarConInstruccion')}
              </button>
              <button
                type="button"
                onClick={() => onRechazar(false)}
                disabled={ocupado}
                className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-brasa-line px-[22px] py-2.5 text-sm font-semibold text-brasa transition hover:bg-brasa-soft disabled:cursor-not-allowed disabled:opacity-60"
              >
                {rechazar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <X className="h-4 w-4" />
                {t('aprobaciones.modal.rechazar')}
              </button>
              <button
                ref={aprobarRef}
                type="button"
                onClick={onAprobar}
                disabled={ocupado}
                className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {aprobar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {t('aprobaciones.modal.aprobar')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
