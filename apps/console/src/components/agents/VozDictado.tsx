import { useTranslation } from 'react-i18next';
import { LoaderCircle, Mic, RefreshCw, X } from 'lucide-react';
import type { IdiomaDictado } from '../../lib/voz';
import { useVozDictado } from './useVozDictado';

/** Contador visible de la grabacion, en formato m:ss. */
function formatoTiempo(segundos: number): string {
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return `${minutos}:${String(resto).padStart(2, '0')}`;
}

/**
 * Boton de DICTADO POR VOZ del input del Playground. Tocar inicia la grabacion (el boton pasa a
 * brasa con contador), tocar de nuevo detiene y transcribe; el texto se INSERTA en el input via
 * `onTexto` y el usuario siempre revisa y envia manualmente. Se oculta solo cuando el navegador
 * no soporta MediaRecorder o cuando el backend responde que la feature esta apagada (501).
 */
export function VozDictado({
  idioma,
  disabled,
  onTexto,
}: {
  idioma: IdiomaDictado;
  disabled: boolean;
  onTexto: (texto: string) => void;
}) {
  const { t } = useTranslation();
  const voz = useVozDictado({ idioma, onTexto });

  if (!voz.soportado) {
    // Feature apagada en el primer uso (501): se muestra el aviso y el boton no vuelve.
    if (voz.errorKey === null) return null;
    return <p className="text-xs text-hueso-muted">{t(voz.errorKey)}</p>;
  }

  if (voz.fase === 'transcribiendo') {
    return (
      <span
        aria-label={t('playground.voz.transcribiendoAria')}
        className="inline-flex items-center gap-1.5 rounded-lg p-1.5 text-xs text-hueso-muted"
      >
        <LoaderCircle className="h-4 w-4 animate-spin" />
        {t('playground.voz.transcribiendo')}
      </span>
    );
  }

  const grabando = voz.fase === 'grabando';
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={voz.alternar}
        disabled={disabled}
        aria-label={grabando ? t('playground.voz.detenerAria') : t('playground.voz.iniciarAria')}
        title={grabando ? t('playground.voz.detenerAria') : t('playground.voz.iniciarAria')}
        className={
          grabando
            ? 'inline-flex items-center gap-1.5 rounded-lg bg-brasa-soft px-2 py-1.5 text-brasa transition'
            : 'inline-flex items-center justify-center rounded-lg p-1.5 text-hueso-muted transition hover:bg-line-soft hover:text-hueso disabled:cursor-not-allowed disabled:opacity-60'
        }
      >
        <Mic className={grabando ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
        {grabando && <span className="font-mono text-xs">{formatoTiempo(voz.segundos)}</span>}
      </button>
      {voz.errorKey !== null && (
        <span className="inline-flex min-w-0 items-center gap-2 text-xs text-brasa">
          <span className="min-w-0 truncate" title={t(voz.errorKey)}>
            {t(voz.errorKey)}
          </span>
          {voz.puedeReintentar && (
            <button
              type="button"
              onClick={voz.reintentar}
              aria-label={t('playground.voz.reintentarAria')}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-brasa-line px-1.5 py-0.5 font-medium transition hover:border-brasa"
            >
              <RefreshCw className="h-3 w-3" />
              {t('playground.voz.reintentar')}
            </button>
          )}
          <button
            type="button"
            onClick={voz.descartar}
            aria-label={t('playground.voz.descartarAria')}
            className="inline-flex shrink-0 items-center rounded p-0.5 transition hover:bg-brasa-soft"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
    </span>
  );
}
