import { type JSX } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { LandingNav } from '../components/landing/landing-nav';
import { Hero } from '../components/landing/hero';
import { Integration } from '../components/landing/integration';
import { Primitives } from '../components/landing/primitives';
import { Examples } from '../components/landing/examples';
import { HowItWorks } from '../components/landing/how-it-works';
import { FinalCTA } from '../components/landing/final-cta';
import { LandingFooter } from '../components/landing/landing-footer';
import { PixelAgent } from '../components/landing/pixel-agent';

/**
 * Landing publica de marketing, portada del showroom (ai-labs-demos-agents). Compone las
 * secciones en orden: Nav, Hero, Integracion, Primitivas, Ejemplos, Como funciona, CTA final
 * y Footer.
 *
 * Es la UNICA vista publica de la consola: se sirve en `/` sin requerir sesion. La consola es
 * light-only, asi que (a diferencia del showroom) NO togglea el tema: los tokens de la landing
 * viven en su valor claro en :root (ver index.css) y los componentes se renderizan en claro.
 *
 * Si hay sesion activa redirige a /agentes, de modo que un usuario autenticado no caiga en la
 * pagina de marketing.
 *
 * Idioma (fase 1 de i18n): la landing arranca en el idioma detectado del navegador (es por
 * defecto) y el visitante puede cambiarlo con el selector discreto ES | EN del nav (ver
 * landing-nav / language-switcher). Sin modales ni interrupciones.
 */
export function HomePage(): JSX.Element | null {
  const { session, loading } = useAuth();

  if (loading) return null;
  if (session) return <Navigate to="/agentes" replace />;

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-background font-grotesk text-foreground">
      <LandingNav />
      <main className="flex-1">
        <Hero />
        <Integration />
        <Primitives />
        <Examples />
        <HowItWorks />
        <FinalCTA />
      </main>
      <LandingFooter />
      <PixelAgent />
    </div>
  );
}
