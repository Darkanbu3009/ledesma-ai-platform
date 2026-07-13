import { Fragment, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, currentLanguage } from '../../i18n';

/**
 * Selector discreto de idioma de la landing (fase 1 de i18n): un control "ES | EN" en la esquina
 * superior derecha del nav. NO es un modal: no bloquea ni interrumpe la navegacion. El visitante
 * llega con el idioma detectado del navegador (es por defecto) y puede cambiarlo EN VIVO via
 * i18n.changeLanguage. Al cambiar idioma solo se re-renderiza este componente (es el unico de la
 * landing suscrito via useTranslation); el resto de la landing sigue hardcodeada en espanol hasta
 * el PR de extraccion masiva.
 */
export function LanguageSwitcher(): JSX.Element {
  const { t, i18n } = useTranslation();
  // Se lee de la instancia del hook (la misma a la que useTranslation suscribe este render), no
  // del singleton del modulo: asi el resaltado no depende de un acople implicito entre ambos.
  const active = currentLanguage(i18n);

  return (
    <div
      role="group"
      aria-label={t('language.switcherLabel')}
      className="flex items-center font-grotesk text-xs tracking-wide"
    >
      {SUPPORTED_LANGUAGES.map((language, index) => (
        <Fragment key={language}>
          {index > 0 && (
            <span aria-hidden="true" className="mx-0.5 text-foreground-secondary/40">
              |
            </span>
          )}
          <button
            type="button"
            onClick={() => void i18n.changeLanguage(language)}
            aria-pressed={language === active}
            aria-label={LANGUAGE_LABELS[language]}
            title={LANGUAGE_LABELS[language]}
            className={`rounded-sm px-1 py-0.5 uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              language === active
                ? 'font-medium text-foreground'
                : 'text-foreground-secondary hover:text-foreground'
            }`}
          >
            {language}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
