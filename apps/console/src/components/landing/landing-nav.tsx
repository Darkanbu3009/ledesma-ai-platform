import { type JSX } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Logo } from '../brand/logo';
import { LanguageSwitcher } from './language-switcher';

const NAV_LINKS = [
  { href: '#integracion', labelKey: 'landing.navegacion.integracion' },
  { href: '#plataforma', labelKey: 'landing.navegacion.plataforma' },
  { href: '#ejemplos', labelKey: 'landing.navegacion.ejemplos' },
  { href: '#como-funciona', labelKey: 'landing.navegacion.comoFunciona' }
];

/**
 * Nav de la landing del showroom. Especifico de la landing (el resto de la app usa
 * SiteHeader). Los nav-links se ocultan por debajo de ~900px, como en el mockup.
 */
export function LandingNav(): JSX.Element {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-[var(--header-height)] max-w-6xl items-center justify-between px-6">
        <Link
          to="/"
          className="flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Logo className="h-12 w-auto md:h-14" />
        </Link>

        <nav className="hidden items-center gap-7 min-[900px]:flex" aria-label={t('landing.navegacion.seccionesAria')}>
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-sm font-grotesk text-sm text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {t(link.labelKey)}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSwitcher />
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">{t('landing.comun.iniciarSesion')}</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/crear-cuenta">{t('landing.comun.crearCuenta')}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
