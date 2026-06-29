import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/useAuth';
import { BrandMark } from '../components/BrandMark';

type Status = 'idle' | 'submitting' | 'sent' | 'error';

export function LoginPage() {
  const { session, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

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
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Marca: logo oficial centrado + wordmark editorial (Ledesma / AI LABS). */}
        <div className="mb-9 flex flex-col items-center text-center">
          <BrandMark className="h-[46px] w-[46px]" />
          <div className="mt-5">
            <p className="font-display text-2xl font-semibold tracking-tight text-ink">Ledesma</p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.24em] text-muted">
              AI LABS
            </p>
          </div>
        </div>

        {/* Tarjeta blanca flotante: formulario de acceso o confirmacion de envio. */}
        <div className="rounded-2xl border border-line bg-surface p-7 shadow-card-hover sm:p-8">
          {status === 'sent' ? (
            <div className="flex flex-col items-center text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brasa-soft text-brasa">
                <Mail className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="mt-4 font-display text-lg font-semibold text-ink">Revisa tu correo</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Te enviamos un enlace de acceso a{' '}
                <span className="font-medium text-ink">{email.trim()}</span>. Abrelo en este
                dispositivo para entrar.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-medium text-ink">
                  Correo
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@empresa.com"
                  className="h-10 w-full rounded-lg border border-line bg-field px-3.5 text-sm text-ink outline-none transition placeholder:text-muted-soft focus:border-brasa focus:ring-2 focus:ring-brasa/20"
                />
              </div>
              {status === 'error' && (
                <p className="text-sm text-brasa" role="alert">
                  {errorMsg}
                </p>
              )}
              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full rounded-lg bg-brasa px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === 'submitting' ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <span
                      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      aria-hidden="true"
                    />
                    Enviando...
                  </span>
                ) : (
                  'Enviar enlace de acceso'
                )}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-soft">Acceso solo por invitacion.</p>
      </div>
    </div>
  );
}
