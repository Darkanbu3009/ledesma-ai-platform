import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { inputClass, monoLabelClass, SubmitButton } from './LoginForm';

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
      <div className="flex flex-col items-center text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brasa-soft text-brasa">
          <Mail className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-[22px] font-medium text-ink">Revisa tu correo</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Si ese correo tiene cuenta, te enviamos un enlace para restablecer tu contraseña.
        </p>
        <p className="mt-5 text-sm text-muted">
          <Link to="/login" className="font-medium text-brasa transition hover:text-brasa-hover">
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
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
