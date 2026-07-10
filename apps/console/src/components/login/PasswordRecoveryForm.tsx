import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { inputClass, monoLabelClass, SubmitButton } from './LoginForm';
import { AuthNotice } from './AuthNotice';

export type RecoveryStatus = 'idle' | 'submitting' | 'sent' | 'error';

interface PasswordRecoveryFormProps {
  status: RecoveryStatus;
  errorMsg: string;
  email: string;
  onEmailChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}

/**
 * Formulario de recuperacion de contrasena del panel derecho: campo de correo,
 * boton unico brasa y link para volver a iniciar sesion. Presentacional: el
 * estado y el resetPasswordForEmail viven en PasswordRecoveryPage y llegan por
 * props.
 *
 * En estado `sent` reemplaza el formulario por una confirmacion NEUTRA que no
 * revela si el correo tiene cuenta: el mensaje es el mismo exista o no.
 */
export function PasswordRecoveryForm({
  status,
  errorMsg,
  email,
  onEmailChange,
  onSubmit,
}: PasswordRecoveryFormProps) {
  if (status === 'sent') {
    return (
      <AuthNotice
        icon={Mail}
        title="Revisa tu correo"
        body="Si ese correo tiene cuenta, te enviamos un enlace para restablecer tu contraseña."
        linkTo="/login"
        linkLabel="Volver a iniciar sesión"
      />
    );
  }

  return (
    <div>
      <div className="mb-7">
        <h1 className="font-display text-[22px] font-medium text-ink">
          Restablecer tu contraseña
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Escribe tu correo y te enviaremos un enlace para elegir una nueva contraseña.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className={`${monoLabelClass} mb-2 block tracking-[3px]`}>
            Correo
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="tu@correo.com"
            className={inputClass}
          />
        </div>
        {status === 'error' && (
          <p className="text-sm text-brasa" role="alert">
            {errorMsg}
          </p>
        )}
        <SubmitButton pending={status === 'submitting'} pendingLabel="Enviando enlace...">
          Enviar enlace para restablecer
        </SubmitButton>
      </form>

      <p className="mt-7 text-center text-sm text-muted">
        <Link to="/login" className="font-medium text-brasa transition hover:text-brasa-hover">
          Volver a iniciar sesión
        </Link>
      </p>
    </div>
  );
}
