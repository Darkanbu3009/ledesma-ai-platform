import { type JSX } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Mail, Phone } from 'lucide-react';
import { Logo } from '../brand/logo';

/**
 * Glifo de Facebook inline. La version de lucide-react de la consola ya no exporta el icono
 * de marca `Facebook`, asi que reusamos su mismo path (mismas props que un icono lucide:
 * viewBox 24, stroke currentColor) para conservar el icono sin sumar dependencias.
 */
function FacebookIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

const WHATSAPP_URL = 'https://wa.me/528116261651';
const PHONE_DISPLAY = '+52 811 626 1651';
const PHONE_HREF = 'tel:+528116261651';
const EMAIL = 'contacto@ledesma-ai-labs.com';
const FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61590323732335';

const linkClass =
  'rounded-sm text-cream underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brasa';

/**
 * Footer de la landing. Incluye contacto (WhatsApp, telefono, correo, Facebook) y la linea
 * legal de copyright con enlace a la pagina de privacidad (/privacidad).
 *
 * Bloque de color brasa solido (#E5511E, token `brasa`) que cierra la pagina: la tinta
 * pasa a hueso (`cream`) / blanco para leerse sobre el fondo saturado. El logo se fuerza
 * a monocromo con `[&_rect]:fill-current` porque su cuadrito de acento es naranja fijo
 * y desapareceria sobre brasa.
 */
export function LandingFooter(): JSX.Element {
  const { t } = useTranslation();

  return (
    <footer className="bg-brasa">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex flex-col gap-10 min-[900px]:flex-row min-[900px]:justify-between">
          <div className="max-w-sm">
            <Logo className="h-16 w-auto text-cream [&_rect]:fill-current" />
            <p className="mt-4 text-sm text-cream/85">
              {t('landing.footer.descripcion')}
            </p>
          </div>

          <div>
            <p className="font-jetbrains text-xs uppercase tracking-[0.16em] text-white">
              {t('landing.footer.contacto')}
            </p>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a href={WHATSAPP_URL} className={`inline-flex items-center gap-2 ${linkClass}`}>
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  WhatsApp
                </a>
              </li>
              <li>
                <a href={PHONE_HREF} className={`inline-flex items-center gap-2 ${linkClass}`}>
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  {t('landing.footer.contactanos')} {PHONE_DISPLAY}
                </a>
              </li>
              <li>
                <a href={`mailto:${EMAIL}`} className={`inline-flex items-center gap-2 ${linkClass}`}>
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  {EMAIL}
                </a>
              </li>
              <li>
                <a
                  href={FACEBOOK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('landing.footer.facebookAria')}
                  className={`inline-flex items-center gap-2 ${linkClass}`}
                >
                  <FacebookIcon className="h-4 w-4" />
                  Facebook
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-cream/25 pt-6">
          <p className="font-jetbrains text-xs text-cream/85">
            {t('landing.footer.copyright')}
            {' | '}
            <Link to="/privacidad" className={linkClass}>
              {t('landing.footer.politicaPrivacidad')}
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
