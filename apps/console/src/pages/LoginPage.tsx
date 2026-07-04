import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/useAuth';
import { BrandPanel, BrandCopy } from '../components/login/BrandPanel';
import { LoginForm, type Modo, type LoginStatus } from '../components/login/LoginForm';
import { LedesmaLogo } from '../components/login/LedesmaLogo';

/**
 * Pantalla de login/registro con layout de panel dividido estilo laboratorio:
 * panel izquierdo de marca con la nube ditherizada (solo desktop >=1024px) y
 * panel derecho con el formulario. En movil colapsa a columna unica: header
 * compacto con el logo, formulario centrado y el bloque de marca como texto
 * bajo el formulario, sin canvas.
 *
 * El flujo de autenticacion es el de siempre y no cambia: magic link via
 * supabase.auth.signInWithOtp, identico en ambos modos (?modo=acceso |
 * ?modo=registro); solo cambia la presentacion.
 */
export function LoginPage() {
  const { session, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<LoginStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Default razonable: cualquier valor distinto de `registro` (ausente o desconocido) se trata
  // como acceso, de modo que `/login` a secas siga funcionando igual que hoy.
  const modo: Modo = searchParams.get('modo') === 'registro' ? 'registro' : 'acceso';

  // Al alternar entre acceso y registro se limpia un error visible: es feedback
  // del intento anterior y no aplica al formulario recien mostrado. Ajuste de
  // estado durante el render (patron de React para reaccionar a un cambio de
  // prop/param); solo presentacion, la validacion y el envio no cambian.
  const [lastModo, setLastModo] = useState(modo);
  if (lastModo !== modo) {
    setLastModo(modo);
    if (status === 'error') {
      setStatus('idle');
      setErrorMsg('');
    }
  }

  if (loading) return null;
  // Con `/` ahora publica (landing de marketing), un usuario ya autenticado va directo al
  // dashboard en vez de caer en marketing.
  if (session) return <Navigate to="/agentes" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus('error');
      setErrorMsg('Ingresa un correo valido.');
      return;
    }
    setStatus('submitting');
    setErrorMsg('');
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setStatus('error');
      setErrorMsg('No pudimos enviar el enlace. Intenta de nuevo.');
      return;
    }
    setStatus('sent');
  }

  return (
    <div className="flex min-h-screen flex-col bg-cream lg:flex-row">
      {/* Panel izquierdo de marca (solo desktop), separado por hairline de 0.5px. */}
      <aside className="hidden border-ink/[0.14] lg:block lg:w-[52%] lg:border-r-[0.5px]">
        <BrandPanel sent={status === 'sent'} />
      </aside>

      {/* Panel derecho: formulario centrado. En movil, columna unica con header
          compacto arriba y el bloque de marca bajo el formulario. */}
      <div className="flex flex-1 flex-col">
        <header className="flex justify-center pt-12 lg:hidden">
          <LedesmaLogo compact />
        </header>
        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[400px]">
            <LoginForm
              modo={modo}
              status={status}
              errorMsg={errorMsg}
              email={email}
              onEmailChange={setEmail}
              onSubmit={handleSubmit}
            />
          </div>
        </main>
        <footer className="flex justify-center px-6 pb-12 lg:hidden">
          <BrandCopy />
        </footer>
      </div>
    </div>
  );
}
