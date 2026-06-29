import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/useAuth';
import { AuthScreen, SubmitButton, authInputClass, authLabelClass } from '../components/AuthScreen';

type Status = 'idle' | 'submitting' | 'sent' | 'error';

/**
 * Modo desde el que se llega a la pantalla, leido del query param `modo`:
 * - `registro`: el usuario viene de "Crear cuenta".
 * - `acceso`: el usuario viene de "Iniciar sesion" (default si el parametro falta o es desconocido).
 *
 * El mecanismo de acceso es IDENTICO en ambos modos (magic link via signInWithOtp); lo unico que
 * cambia es el texto de la pantalla inicial (titulo, subtitulo y boton).
 */
type Modo = 'registro' | 'acceso';

const COPY: Record<Modo, { title: string; subtitle: string; submit: string }> = {
  registro: {
    title: 'Crear tu cuenta',
    subtitle: 'Te enviamos un enlace para empezar.',
    submit: 'Crear cuenta',
  },
  acceso: {
    title: 'Iniciar sesion',
    subtitle: 'Te enviamos un enlace de acceso.',
    submit: 'Enviar enlace de acceso',
  },
};

export function LoginPage() {
  const { session, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Default razonable: cualquier valor distinto de `registro` (ausente o desconocido) se trata
  // como acceso, de modo que `/login` a secas siga funcionando igual que hoy.
  const modo: Modo = searchParams.get('modo') === 'registro' ? 'registro' : 'acceso';
  const copy = COPY[modo];

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
    <AuthScreen footer="Acceso solo por invitacion.">
      {status === 'sent' ? (
        <div className="flex flex-col items-center text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brasa-soft text-brasa">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="mt-4 font-display text-lg font-semibold text-ink">Revisa tu correo</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Te enviamos un enlace de acceso a{' '}
            <span className="font-medium text-ink">{email.trim()}</span>. Abrelo en este dispositivo
            para entrar.
          </p>
        </div>
      ) : (
        <>
          {/* Titulo + subtitulo segun el modo; el formulario de abajo es identico en ambos. */}
          <div className="mb-6">
            <h1 className="font-display text-lg font-semibold text-ink">{copy.title}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{copy.subtitle}</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className={authLabelClass}>
                Correo
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@empresa.com"
                className={authInputClass}
              />
            </div>
            {status === 'error' && (
              <p className="text-sm text-brasa" role="alert">
                {errorMsg}
              </p>
            )}
            <SubmitButton pending={status === 'submitting'} pendingLabel="Enviando...">
              {copy.submit}
            </SubmitButton>
          </form>
        </>
      )}
    </AuthScreen>
  );
}
