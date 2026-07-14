import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { isValidEmail } from '../lib/email';
import { useAuth } from '../auth/useAuth';
import { BrandPanel, BrandCopy } from '../components/login/BrandPanel';
import { LoginForm, type LoginStatus } from '../components/login/LoginForm';
import { LedesmaLogo } from '../components/login/LedesmaLogo';

/**
 * Pantalla de login con layout de panel dividido estilo laboratorio: panel
 * izquierdo de marca con la nube ditherizada (solo desktop >=1024px) y panel
 * derecho con el formulario. En movil colapsa a columna unica: header compacto
 * con el logo, formulario centrado y el bloque de marca como texto bajo el
 * formulario, sin canvas.
 *
 * Autenticacion por correo y contrasena via supabase.auth.signInWithPassword.
 * Las contrasenas viven exclusivamente en Supabase Auth (auth.users); aqui
 * solo se pasan al cliente supabase-js, nunca a la API propia ni a tablas del
 * esquema. Tras autenticar, AuthProvider recibe la sesion por
 * onAuthStateChange y el <Navigate> de arriba redirige; el flujo post-login
 * (GET /v1/me, needsRegistration -> /registro) no cambia.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<LoginStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  if (loading) return null;
  // Con `/` publica (landing de marketing), un usuario ya autenticado va directo al dashboard.
  if (session) return <Navigate to="/agentes" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setStatus('error');
      setErrorMsg(t('auth.errores.correoInvalido'));
      return;
    }
    if (!password) {
      setStatus('error');
      setErrorMsg(t('auth.errores.contrasenaRequerida'));
      return;
    }
    setStatus('submitting');
    setErrorMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
    if (error) {
      setStatus('error');
      if (error.code === 'email_not_confirmed') {
        setErrorMsg(t('auth.errores.confirmaCorreo'));
      } else if (error.status === 400) {
        // Mismo mensaje exista o no el correo: no se filtra si una cuenta existe.
        setErrorMsg(t('auth.errores.credencialesIncorrectas'));
      } else {
        setErrorMsg(t('auth.errores.loginGenerico'));
      }
      return;
    }
    // Sin error hay sesion: AuthProvider la propaga y el <Navigate> superior redirige.
  }

  return (
    <div className="min-h-screen bg-cream lg:flex">
      {/* Panel izquierdo de marca (solo desktop), separado por hairline de 0.5px. */}
      <aside
        className="hidden lg:block lg:w-[52%]"
        style={{ borderRight: '0.5px solid rgba(31,30,28,0.14)' }}
      >
        <BrandPanel sent={false} />
      </aside>

      {/* Panel derecho: formulario centrado. En movil, columna unica con header
          compacto arriba y el bloque de marca bajo el formulario. */}
      <div className="flex min-h-screen flex-1 flex-col lg:min-h-0">
        <header className="flex justify-center pt-12 lg:hidden">
          <LedesmaLogo compact />
        </header>
        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[400px]">
            <LoginForm
              status={status}
              errorMsg={errorMsg}
              email={email}
              password={password}
              onEmailChange={setEmail}
              onPasswordChange={setPassword}
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
