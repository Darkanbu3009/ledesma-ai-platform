import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { MIN_PASSWORD_LENGTH } from '../lib/password';
import { useAuth } from '../auth/useAuth';
import { BrandPanel, BrandCopy } from '../components/login/BrandPanel';
import { SignUpForm, type SignUpStatus } from '../components/login/SignUpForm';
import { LedesmaLogo } from '../components/login/LedesmaLogo';

/**
 * Pantalla de crear cuenta (/crear-cuenta) con el mismo layout de marca del
 * login: panel izquierdo con la nube ditherizada en desktop y columna unica
 * en movil.
 *
 * Alta por correo y contrasena via supabase.auth.signUp. Las contrasenas
 * viven exclusivamente en Supabase Auth (auth.users); nunca se envian a la
 * API propia ni a tablas del esquema. El resultado depende de la config del
 * proyecto y se detecta leyendo la respuesta, sin hardcodear:
 * - Con "Confirm email" activo signUp NO devuelve sesion: se muestra la
 *   pantalla de "Revisa tu correo" y el usuario entra tras confirmar.
 * - Sin confirmacion signUp devuelve sesion: AuthProvider la propaga y el
 *   flujo normal (GET /v1/me, needsRegistration -> /registro) toma el control
 *   via el <Navigate> superior.
 * Con confirmacion activa, un correo ya registrado no produce error: Supabase
 * devuelve un usuario ofuscado sin identities para no filtrar existencia; se
 * detecta ese caso y se muestra "Ese correo ya tiene cuenta".
 */
export function SignUpPage() {
  const { session, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<SignUpStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [emailTaken, setEmailTaken] = useState(false);

  if (loading) return null;
  if (session) return <Navigate to="/agentes" replace />;

  function fail(message: string, taken = false) {
    setStatus('error');
    setErrorMsg(message);
    setEmailTaken(taken);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      fail('Ingresa un correo válido.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      fail(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      fail('Las contraseñas no coinciden.');
      return;
    }
    setStatus('submitting');
    setErrorMsg('');
    setEmailTaken(false);
    const { data, error } = await supabase.auth.signUp({ email: trimmed, password });
    if (error) {
      if (error.code === 'user_already_exists' || error.code === 'email_exists') {
        fail('Ese correo ya tiene cuenta.', true);
      } else if (error.code === 'weak_password') {
        // La regla real la aplica el servidor; se muestra su mensaje sin prometer otra.
        fail(`La contraseña no cumple los requisitos del servidor: ${error.message}`);
      } else {
        fail('No pudimos crear la cuenta. Intenta de nuevo.');
      }
      return;
    }
    // Con confirmacion de correo activa, un correo ya registrado devuelve un
    // usuario ofuscado sin identities (sin error), para no filtrar existencia.
    if (data.user && !data.session && (data.user.identities?.length ?? 0) === 0) {
      fail('Ese correo ya tiene cuenta.', true);
      return;
    }
    if (data.session) {
      // Confirmacion desactivada: hay sesion inmediata. AuthProvider la recibe
      // por onAuthStateChange y el <Navigate> superior manda al flujo normal.
      return;
    }
    // Confirmacion activa: sin sesion todavia; el usuario confirma por correo.
    setStatus('sent');
  }

  return (
    <div className="min-h-screen bg-cream lg:flex">
      {/* Panel izquierdo de marca (solo desktop), separado por hairline de 0.5px. */}
      <aside
        className="hidden lg:block lg:w-[52%]"
        style={{ borderRight: '0.5px solid rgba(31,30,28,0.14)' }}
      >
        <BrandPanel sent={status === 'sent'} />
      </aside>

      {/* Panel derecho: formulario centrado. En movil, columna unica con header
          compacto arriba y el bloque de marca bajo el formulario. */}
      <div className="flex min-h-screen flex-1 flex-col lg:min-h-0">
        <header className="flex justify-center pt-12 lg:hidden">
          <LedesmaLogo compact />
        </header>
        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[400px]">
            <SignUpForm
              status={status}
              errorMsg={errorMsg}
              emailTaken={emailTaken}
              email={email}
              password={password}
              confirm={confirm}
              onEmailChange={setEmail}
              onPasswordChange={setPassword}
              onConfirmChange={setConfirm}
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
