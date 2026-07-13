import { useState, type JSX } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
// Se usa el singleton directo (no useTranslation): aqui solo se dispara changeLanguage y ningun
// texto de la landing esta migrado aun; suscribirse re-renderizaria toda la landing sin motivo.
import i18n, { type SupportedLanguage } from '../i18n';
import { hasSessionLanguageChoice, markSessionLanguageChoice } from '../i18n/session-preference';
import { LanguageModal } from '../components/landing/language-modal';
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
 */
export function HomePage(): JSX.Element | null {
  const { session, loading } = useAuth();
  // Modal de idioma (fase 1 de i18n): se abre mientras no haya eleccion en esta sesion. La marca
  // vive en memoria (session-preference), asi que tras elegir o cerrar no vuelve a aparecer; si
  // el visitante navega a otra ruta SIN interactuar, al volver se le pregunta de nuevo.
  const [languageModalOpen, setLanguageModalOpen] = useState(() => !hasSessionLanguageChoice());

  function chooseLanguage(language: SupportedLanguage) {
    void i18n.changeLanguage(language);
    dismissLanguageModal();
  }

  // Cerrar sin elegir fija el idioma ya detectado (el que la app trae activo): no se reabre.
  function dismissLanguageModal() {
    markSessionLanguageChoice();
    setLanguageModalOpen(false);
  }

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
      {languageModalOpen && (
        <LanguageModal onChoose={chooseLanguage} onClose={dismissLanguageModal} />
      )}
    </div>
  );
}
