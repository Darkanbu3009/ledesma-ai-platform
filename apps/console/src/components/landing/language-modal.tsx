import { type JSX } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDialog } from '../ui/useDialog';
import { Logo } from '../brand/logo';
import { SUPPORTED_LANGUAGES, detectBrowserLanguage, type SupportedLanguage } from '../../i18n';

const OPTION_LABELS: Record<SupportedLanguage, string> = {
  es: 'Español',
  en: 'English',
};

/**
 * Modal de eleccion de idioma de la landing (fase 1 de i18n). Lo monta HomePage SOLO la primera
 * vez en la sesion, cuando todavia no hay preferencia de idioma (ver session-preference). Es una
 * eleccion rapida, no un muro: Escape, el fondo y la X cierran asumiendo el idioma detectado del
 * navegador, que ademas llega preseleccionado (resaltado) cuando es claramente es o en.
 *
 * Las etiquetas de las opciones son nombres propios (Español / English) y se muestran IGUAL en
 * ambos idiomas, por eso van fijas aqui; titulo y subtitulo si se traducen (claves language.*).
 */
export function LanguageModal({
  onChoose,
  onClose,
}: {
  /** El usuario eligio un idioma explicitamente. */
  onChoose: (language: SupportedLanguage) => void;
  /** El usuario cerro sin elegir: se asume el idioma detectado. */
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const detected = detectBrowserLanguage();
  const dialogRef = useDialog({ onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('language.modalTitle')}
        className="relative w-full max-w-sm rounded-2xl border border-border bg-background p-6 font-grotesk shadow-2xl shadow-black/20"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('language.modalClose')}
          title={t('language.modalClose')}
          className="absolute right-3 top-3 rounded-md p-1.5 text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>

        <Logo className="h-9 w-auto" />
        <h2 className="mt-4 text-lg font-medium text-foreground">{t('language.modalTitle')}</h2>
        <p className="mt-1 text-sm text-foreground-secondary">{t('language.modalSubtitle')}</p>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          {SUPPORTED_LANGUAGES.map((language) => (
            <button
              key={language}
              type="button"
              onClick={() => onChoose(language)}
              className={`rounded-xl border px-4 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                language === detected
                  ? 'border-foreground bg-foreground/5 font-medium text-foreground'
                  : 'border-border text-foreground-secondary hover:border-foreground hover:text-foreground'
              }`}
            >
              {OPTION_LABELS[language]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
