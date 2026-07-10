import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { BrandPanel, BrandCopy } from '../components/login/BrandPanel';
import {
  PasswordRecoveryForm,
  type RecoveryStatus,
} from '../components/login/PasswordRecoveryForm';
import { LedesmaLogo } from '../components/login/LedesmaLogo';

/**
 * Pantalla de solicitar restablecimiento de contrasena (/recuperar) con el
 * mismo layout de marca del login: panel izquierdo con la nube ditherizada en
 * desktop y columna unica en movil.
 *
 * Envia el correo de reset via supabase.auth.resetPasswordForEmail; Supabase
 * genera y maneja el token, y el enlace del correo regresa a
 * /nueva-contrasena (redirectTo), donde detectSessionInUrl establece la
 * sesion de recuperacion. Aqui nunca se toca el token.
 *
 * La confirmacion es NEUTRA: el mismo mensaje exista o no el correo, para no
 * filtrar si una cuenta existe. Por eso tampoco se distingue el error de
 * "correo no encontrado": cualquier error del servidor (p. ej. rate limit)
 * muestra un mensaje generico de reintento.
 *
 * No redirige si hay sesion activa: un usuario creado por enlace magico (sin
 * contrasena) puede usar esta misma pantalla para establecer una.
 */
export function PasswordRecoveryPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<RecoveryStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus('error');
      setErrorMsg('Ingresa un correo válido.');
      return;
    }
    setStatus('submitting');
    setErrorMsg('');
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${window.location.origin}/nueva-contrasena`,
    });
    if (error) {
      setStatus('error');
      setErrorMsg('No pudimos enviar el correo. Intenta de nuevo en unos minutos.');
      return;
    }
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
            <PasswordRecoveryForm
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
