import { type JSX } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { Button } from '../ui/button';

/** WhatsApp de contacto del showroom. */
const WHATSAPP_URL = 'https://wa.me/528116261651';

/**
 * CTA final de la landing: ultima invitacion a crear cuenta, con un atajo a WhatsApp.
 */
export function FinalCTA(): JSX.Element {
  const { t } = useTranslation();

  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="relative isolate overflow-hidden rounded-2xl border border-border bg-background-secondary px-5 py-12 text-center shadow-md sm:px-12 sm:py-16">
          <h2 className="mx-auto max-w-2xl font-display text-2xl font-bold tracking-tight text-foreground min-[420px]:text-3xl sm:text-4xl">
            {t('landing.ctaFinal.titulo')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-foreground-secondary sm:text-lg">
            {t('landing.ctaFinal.descripcion')}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:mt-9 sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link to="/crear-cuenta">
                {t('landing.comun.crearCuenta')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
              <a href={WHATSAPP_URL}>
                <MessageCircle className="h-4 w-4" />
                {t('landing.ctaFinal.escribenosWhatsapp')}
              </a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
