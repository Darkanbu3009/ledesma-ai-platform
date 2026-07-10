import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { isValidEmail } from '../lib/email';
import { AuthLayout } from '../components/login/AuthLayout';
import {
  PasswordRecoveryForm,
  type RecoveryStatus,
} from '../components/login/PasswordRecoveryForm';

/**
 * Pantalla de solicitar restablecimiento de contrasena (/recuperar) con el
 * layout de marca compartido.
 *
 * Envia el correo de reset via supabase.auth.resetPasswordForEmail; Supabase
 * genera y maneja el token, y el enlace del correo regresa a
 * /nueva-contrasena (redirectTo), donde detectSessionInUrl establece la
 * sesion de recuperacion. Aqui nunca se toca el token. La URL de redirectTo
 * debe estar en la allowlist de Redirect URLs del proyecto Supabase para cada
 * origen desplegado; si falta, GoTrue cae en silencio al Site URL.
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
    if (!isValidEmail(trimmed)) {
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
    <AuthLayout sent={status === 'sent'}>
      <PasswordRecoveryForm
        status={status}
        errorMsg={errorMsg}
        email={email}
        onEmailChange={setEmail}
        onSubmit={handleSubmit}
      />
    </AuthLayout>
  );
}
