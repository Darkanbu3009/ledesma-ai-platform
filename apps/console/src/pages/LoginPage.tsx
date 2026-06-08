import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
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
  if (session) return <Navigate to="/" replace />;

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-1/3 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brasa/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="h-12 w-12" />
          <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-hueso">
            Consola Ledesma AI Labs
          </h1>
          <p className="mt-2 text-sm text-hueso-muted">
            Ingenieria en IA. Resultados en operaciones.
          </p>
        </div>

        <div className="rounded-2xl border border-grafito-border bg-grafito p-7 shadow-2xl shadow-black/40">
          {status === 'sent' ? (
            <div className="text-center">
              <p className="font-display text-lg font-semibold text-hueso">Revisa tu correo</p>
              <p className="mt-2 text-sm text-hueso-muted">
                Te enviamos un enlace de acceso a{' '}
                <span className="text-hueso">{email.trim()}</span>. Abrelo en este dispositivo para
                entrar.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-medium text-hueso">
                  Correo
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@empresa.com"
                  className="w-full rounded-lg border border-grafito-border bg-carbon px-3.5 py-2.5 text-sm text-hueso outline-none transition placeholder:text-hueso-muted/60 focus:border-brasa focus:ring-2 focus:ring-brasa/30"
                />
              </div>
              {status === 'error' && <p className="text-sm text-brasa">{errorMsg}</p>}
              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full rounded-lg bg-brasa px-4 py-2.5 text-sm font-semibold text-carbon transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === 'submitting' ? 'Enviando...' : 'Enviar enlace de acceso'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-hueso-muted">Acceso solo por invitacion.</p>
      </div>
    </div>
  );
}
