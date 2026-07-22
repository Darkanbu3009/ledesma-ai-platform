import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import type { SitioConectado } from '../../lib/sitios';
import { useDialog } from '../ui/useDialog';

/**
 * Modal de la VISTA EN VIVO del login (7.1c): un iframe que apunta DIRECTO a la vista en vivo del
 * proveedor del navegador remoto (Browserbase), donde el usuario inicia sesion EL MISMO en el sitio.
 * Accesible via el hook compartido useDialog (trampa de foco, Escape, retorno del foco al cerrar),
 * el mismo patron del modal de triggers (5.4b).
 *
 * RESTRICCION DURA: la contrasena del usuario JAMAS toca el backend ni el dominio de Ledesma. Se
 * teclea dentro del iframe, contra el proveedor. Por eso aqui NO hay ningun input (menos aun de
 * contrasena) y NO se adjunta NINGUN listener sobre el iframe (ni load, ni message, ni nada): esta
 * consola no puede leer, interceptar ni reenviar lo que ocurre alli dentro, por construccion.
 */
export function LoginEnVivoDialog({
  sitio,
  confirmando,
  error,
  onConfirmar,
  onCerrar,
}: {
  sitio: SitioConectado;
  /** true mientras POST /confirmar esta en vuelo (deshabilita el boton). */
  confirmando: boolean;
  /** Mensaje de error si la confirmacion fallo. */
  error: string | null;
  onConfirmar: () => void;
  onCerrar: () => void;
}) {
  const { t } = useTranslation();
  const confirmarRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialog({ onClose: onCerrar, initialFocus: confirmarRef });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6">
      <div className="absolute inset-0 bg-ink/40" onClick={onCerrar} aria-hidden="true" />
      {/* El modal ocupa la pantalla casi completa (hasta 90vw/1400px en desktop) con ALTURA FIJA:
          asi el iframe (flex-1) recibe todo el alto restante y la vista en vivo se ve grande. El
          tamano del CONTENIDO remoto lo gobierna el viewport de la sesion (LOGIN_VIEWPORT del
          worker), no este CSS: agrandar solo el iframe fue el intento previo que no surtio efecto. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-en-vivo-title"
        className="relative flex h-[96vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card-hover sm:h-[92vh] sm:w-[90vw]"
      >
        <div className="flex flex-none items-start justify-between gap-4 border-b border-line-soft px-6 py-4">
          <div className="min-w-0">
            <h2 id="login-en-vivo-title" className="truncate font-display text-lg font-bold text-ink">
              {t('sitios.modal.titulo', { dominio: sitio.dominio })}
            </h2>
            <p className="mt-1 flex items-start gap-1.5 text-sm text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-ok" aria-hidden="true" />
              <span>{t('sitios.modal.instruccion')}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label={t('sitios.modal.cerrarAria')}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted transition hover:bg-line-soft hover:text-ink"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* La vista en vivo EMBEBIDA: apunta directo al proveedor. Sin listeners, por diseno.
            flex-1 + min-h-0: llena TODO el alto que el modal (de altura fija) deja entre la
            cabecera y el pie, y puede ceder si hiciera falta -- el aviso de seguridad (cabecera) y
            el boton de confirmar (pie) son flex-none y quedan SIEMPRE visibles. El min() del piso
            evita que en pantallas bajas el iframe los empuje fuera (el contenedor recorta overflow);
            en un desktop tipico (ventana >= ~840px de alto) el flex-1 ya supera los 600px. */}
        <iframe
          src={sitio.vistaEnVivoUrl ?? undefined}
          title={t('sitios.modal.iframeTitulo', { dominio: sitio.dominio })}
          className="min-h-[min(320px,55vh)] w-full flex-1 border-0 bg-ink/5 sm:min-h-[min(600px,62vh)]"
          allow="clipboard-read; clipboard-write"
        />

        <div className="flex-none border-t border-line-soft px-6 py-4">
          {error && (
            <div
              role="alert"
              className="mb-3 rounded-xl border border-brasa-line bg-brasa-soft px-4 py-3 text-sm font-medium text-brasa"
            >
              {error}
            </div>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-soft">{t('sitios.modal.pie')}</p>
            <button
              ref={confirmarRef}
              type="button"
              onClick={onConfirmar}
              disabled={confirmando}
              className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmando && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirmando ? t('sitios.modal.confirmando') : t('sitios.modal.confirmar')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
