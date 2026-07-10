import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { inputClass, monoLabelClass, SubmitButton } from './LoginForm';
import { GoogleAuthButton } from './GoogleAuthButton';

export type SignUpStatus = 'idle' | 'submitting' | 'sent' | 'error';

interface SignUpFormProps {
  status: SignUpStatus;
  errorMsg: string;
  /** Cuando el error es "correo ya registrado", se agrega el link a iniciar sesion. */
  emailTaken: boolean;
  email: string;
  password: string;
  confirm: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}

/**
 * Formulario de crear cuenta del panel derecho: correo, contrasena y su
 * confirmacion, boton brasa, boton "Continuar con Google" bajo el divisor
 * "o" y link a iniciar sesion. Presentacional: el estado y el signUp viven
 * en SignUpPage y llegan por props; el flujo OAuth vive en GoogleAuthButton.
 *
 * En estado `sent` (proyecto con confirmacion de correo activa) reemplaza el
 * formulario por la confirmacion "Revisa tu correo".
 */
export function SignUpForm({
  status,
  errorMsg,
  emailTaken,
  email,
  password,
  confirm,
  onEmailChange,
  onPasswordChange,
  onConfirmChange,
  onSubmit,
}: SignUpFormProps) {
  if (status === 'sent') {
    return (
      <div className="flex flex-col items-center text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brasa-soft text-brasa">
          <Mail className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-[22px] font-medium text-ink">Revisa tu correo</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Enviamos un correo a <span className="font-medium text-ink">{email.trim()}</span> para
          confirmar tu cuenta. Confírmala y luego inicia sesión.
        </p>
        <p className="mt-5 text-sm text-muted">
          <Link to="/login" className="font-medium text-brasa transition hover:text-brasa-hover">
            Ir a iniciar sesión
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-7">
        <h1 className="font-display text-[22px] font-medium text-ink">Crear tu cuenta</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Regístrate con tu correo y una contraseña.
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
        <div>
          <label htmlFor="password" className={`${monoLabelClass} mb-2 block tracking-[3px]`}>
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="confirm" className={`${monoLabelClass} mb-2 block tracking-[3px]`}>
            Confirmar contraseña
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => onConfirmChange(e.target.value)}
            className={inputClass}
          />
        </div>
        {status === 'error' && (
          <p className="text-sm text-brasa" role="alert">
            {errorMsg}
            {emailTaken && (
              <>
                {' '}
                <Link
                  to="/login"
                  className="font-medium underline underline-offset-2 transition hover:text-brasa-hover"
                >
                  Iniciar sesión
                </Link>
              </>
            )}
          </p>
        )}
        <SubmitButton pending={status === 'submitting'} pendingLabel="Creando cuenta...">
          Crear cuenta
        </SubmitButton>
      </form>

      <GoogleAuthButton />

      <p className="mt-7 text-center text-sm text-muted">
        ¿Ya tienes cuenta?{' '}
        <Link to="/login" className="font-medium text-brasa transition hover:text-brasa-hover">
          Iniciar sesión
        </Link>
      </p>
    </div>
  );
}
