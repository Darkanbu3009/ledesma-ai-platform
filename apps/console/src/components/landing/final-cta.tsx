import { type JSX } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { Button } from '../ui/button';

/** WhatsApp de contacto del showroom. */
const WHATSAPP_URL = 'https://wa.me/528116261651';

/**
 * CTA final de la landing: ultima invitacion a crear cuenta, con un glow radial
 * sutil en brasa y un atajo a WhatsApp.
 */
export function FinalCTA(): JSX.Element {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="relative isolate overflow-hidden rounded-2xl border border-border bg-background-secondary px-6 py-16 text-center shadow-md sm:px-12">
          {/* Glow brasa atenuado para el fondo hueso (en claro la elevacion la da la
              sombra; el glow queda como un lavado calido muy tenue). */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 -z-10 h-72 w-72 -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(232,81,31,0.08),_transparent_70%)] blur-3xl"
          />
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Pon un agente a trabajar en tu operación
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-foreground-secondary">
            Tú describes el proceso; nosotros lo configuramos, lo integramos a tus sistemas y lo
            ponemos en producción. A la medida de tu negocio y en una fracción del tiempo.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link to="/login">
                Crear cuenta
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="border-foreground/20">
              <a href={WHATSAPP_URL}>
                <MessageCircle className="h-4 w-4" />
                Escríbenos por WhatsApp
              </a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
