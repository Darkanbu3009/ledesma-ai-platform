import { type JSX, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Logo } from '../brand/logo';
import { LanguageSwitcher } from './language-switcher';

const NAV_LINKS = [
  { href: '#integracion', labelKey: 'landing.navegacion.integracion' },
  { href: '#plataforma', labelKey: 'landing.navegacion.plataforma' },
  { href: '#ejemplos', labelKey: 'landing.navegacion.ejemplos' },
  { href: '#como-funciona', labelKey: 'landing.navegacion.comoFunciona' }
];

/** Id del panel del menu movil, para enlazar aria-controls del boton hamburguesa. */
const MOBILE_MENU_ID = 'landing-menu-movil';

/**
 * Nav de la landing del showroom. Especifico de la landing (el resto de la app usa
 * SiteHeader). Los nav-links se ocultan por debajo de ~900px, como en el mockup; en ese
 * rango un boton hamburguesa abre un panel con los mismos enlaces (se cierra al elegir
 * uno, al tocar fuera o con Escape). En escritorio el hamburguesa no existe y el header
 * queda identico al de siempre.
 */
export function LandingNav(): JSX.Element {
  const { t } = useTranslation();
  const [menuAbierto, setMenuAbierto] = useState(false);

  const cerrarMenu = useCallback(() => setMenuAbierto(false), []);

  // Escape cierra el panel movil (solo se escucha mientras esta abierto).
  useEffect(() => {
    if (!menuAbierto) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuAbierto(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuAbierto]);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-[var(--header-height)] max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link
          to="/"
          className="flex shrink-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Logo className="h-10 w-auto min-[400px]:h-12 sm:h-16 md:h-20" />
        </Link>

        <nav className="hidden items-center gap-8 min-[900px]:flex" aria-label={t('landing.navegacion.seccionesAria')}>
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-sm font-grotesk text-[0.9375rem] text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {t(link.labelKey)}
            </a>
          ))}
        </nav>

        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3.5">
          <LanguageSwitcher />
          {/* En pantallas muy chicas "Iniciar sesion" no cabe en la barra: pasa al panel
              del menu hamburguesa. Desde sm vuelve a la barra con sus medidas de siempre. */}
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex sm:h-10 sm:px-3.5"
          >
            <Link to="/login">{t('landing.comun.iniciarSesion')}</Link>
          </Button>
          <Button asChild size="sm" className="h-9 px-2.5 text-xs sm:h-10 sm:px-5 sm:text-sm">
            <Link to="/crear-cuenta">{t('landing.comun.crearCuenta')}</Link>
          </Button>

          {/* Hamburguesa: solo por debajo de ~900px, donde la nav horizontal se oculta. */}
          <button
            type="button"
            onClick={() => setMenuAbierto((abierto) => !abierto)}
            aria-expanded={menuAbierto}
            aria-controls={MOBILE_MENU_ID}
            aria-label={menuAbierto ? t('landing.navegacion.cerrarMenu') : t('landing.navegacion.abrirMenu')}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-background-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background min-[900px]:hidden"
          >
            {menuAbierto ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Panel movil: backdrop que cierra al tocar fuera + lista de enlaces bajo el header.
          Ambos desaparecen por completo en >= 900px, donde la nav horizontal vuelve. */}
      {menuAbierto && (
        <>
          {/* Absolute (no fixed): el backdrop-filter del header crea un containing block
              que anularia un fixed. Cuelga del borde inferior del header y cubre el alto
              del viewport, suficiente para cerrar al tocar cualquier zona fuera del panel. */}
          <div
            className="absolute inset-x-0 top-full h-screen bg-foreground/20 min-[900px]:hidden"
            onClick={cerrarMenu}
            aria-hidden="true"
          />
          <nav
            id={MOBILE_MENU_ID}
            aria-label={t('landing.navegacion.seccionesAria')}
            className="absolute inset-x-0 top-full border-b border-border bg-background shadow-md min-[900px]:hidden"
          >
            <ul className="flex flex-col px-4 py-2">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    onClick={cerrarMenu}
                    className="block rounded-md px-3 py-3 font-grotesk text-[0.9375rem] text-foreground-secondary transition-colors hover:bg-background-tertiary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {t(link.labelKey)}
                  </a>
                </li>
              ))}
              {/* "Iniciar sesion" vive aqui solo mientras esta fuera de la barra (< sm). */}
              <li className="mt-1 border-t border-border pt-1 sm:hidden">
                <Link
                  to="/login"
                  onClick={cerrarMenu}
                  className="block rounded-md px-3 py-3 font-grotesk text-[0.9375rem] text-foreground-secondary transition-colors hover:bg-background-tertiary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {t('landing.comun.iniciarSesion')}
                </Link>
              </li>
            </ul>
          </nav>
        </>
      )}
    </header>
  );
}
