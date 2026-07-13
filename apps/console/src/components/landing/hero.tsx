import { type JSX } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Button } from '../ui/button';
import { HeroShowcase } from './hero-showcase';
import { PixelCloud } from './pixel-cloud';

/** WhatsApp de contacto del showroom (mismo numero que el resto del sitio). */
const WHATSAPP_URL = 'https://wa.me/528116261651';

/**
 * Hero de la landing: a la izquierda el mensaje y los CTAs; a la derecha el showcase
 * (tarjeta de sistemas conectados + lineas + carta giratoria del modelo). En ~900px
 * pasa a una columna.
 *
 * El hero es transparente y se apoya sobre el fondo solido de marca del wrapper de la
 * landing.
 */
export function Hero(): JSX.Element {
  const { t } = useTranslation();
  // Enlace de WhatsApp con mensaje pre-llenado para solicitar una demo guiada.
  const demoWhatsappUrl = `${WHATSAPP_URL}?text=${encodeURIComponent(
    t('landing.hero.whatsappMensajeDemo'),
  )}`;

  return (
    <section className="relative isolate overflow-hidden">
      <PixelCloud />
      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 min-[900px]:grid-cols-2 min-[900px]:py-28">
        <div>
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl min-[900px]:text-6xl">
            {t('landing.hero.titulo')}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-foreground-secondary">
            {t('landing.hero.descripcion')}
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg">
              <Link to="/crear-cuenta">
                {t('landing.comun.crearCuenta')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <a href={demoWhatsappUrl} target="_blank" rel="noopener noreferrer">
                {t('landing.hero.solicitarDemo')}
              </a>
            </Button>
          </div>
        </div>

        <div className="w-full">
          <HeroShowcase />
        </div>
      </div>
    </section>
  );
}
