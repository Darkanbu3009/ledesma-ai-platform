import { type JSX } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Mail } from 'lucide-react';
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
const EMAIL = 'contacto@ledesma-ai-labs.com';
const FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61590323732335';

const linkClass =
  'rounded-sm text-foreground-secondary underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * Footer de la landing. Incluye contacto (WhatsApp, correo, Facebook) y accesos directos
 * a crear cuenta / iniciar sesion.
 */
export function LandingFooter(): JSX.Element {
  return (
    <footer className="border-t border-border bg-background/80">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-10 min-[900px]:flex-row min-[900px]:justify-between">
          <div className="max-w-sm">
            <Logo className="h-8 w-auto" />
            <p className="mt-4 text-sm text-foreground-secondary">
              Agentes verticales de IA para tu empresa, integrados en los sistemas que tu
              equipo ya usa.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:gap-16">
            <div>
              <p className="font-jetbrains text-xs uppercase tracking-[0.16em] text-foreground-secondary">
                Contacto
              </p>
              <ul className="mt-4 space-y-3 text-sm">
                <li>
                  <a href={WHATSAPP_URL} className={`inline-flex items-center gap-2 ${linkClass}`}>
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    WhatsApp
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
                    aria-label="Facebook de Ledesma AI Labs"
                    className={`inline-flex items-center gap-2 ${linkClass}`}
                  >
                    <FacebookIcon className="h-4 w-4" />
                    Facebook
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <p className="font-jetbrains text-xs uppercase tracking-[0.16em] text-foreground-secondary">
                Cuenta
              </p>
              <ul className="mt-4 space-y-3 text-sm">
                <li>
                  <Link to="/login" className={linkClass}>
                    Crear cuenta
                  </Link>
                </li>
                <li>
                  <Link to="/login" className={linkClass}>
                    Iniciar sesión
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-border pt-6">
          <p className="font-jetbrains text-xs text-foreground-secondary">
            Ledesma AI Labs - Agentes verticales de IA para empresas
          </p>
        </div>
      </div>
    </footer>
  );
}
