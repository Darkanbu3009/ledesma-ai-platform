import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  if (status === 'sent') {
    return (
      <div className="flex flex-col items-center text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brasa-soft text-brasa">
          <Mail className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-[22px] font-medium text-ink">
          {t('auth.comun.revisaCorreoTitulo')}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          <Trans
            i18nKey="auth.crearCuenta.confirmacionEnviada"
            values={{ email: email.trim() }}
            components={{ correo: <span className="font-medium text-ink" /> }}
          />
        </p>
        <p className="mt-5 text-sm text-muted">
          <Link to="/login" className="font-medium text-brasa transition hover:text-brasa-hover">
            {t('auth.comun.irIniciarSesion')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-7">
        <h1 className="font-display text-[22px] font-medium text-ink">
          {t('auth.crearCuenta.titulo')}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {t('auth.crearCuenta.subtitulo')}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className={`${monoLabelClass} mb-2 block tracking-[3px]`}>
            {t('auth.campos.correo')}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder={t('auth.campos.correoPlaceholder')}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="password" className={`${monoLabelClass} mb-2 block tracking-[3px]`}>
            {t('auth.campos.contrasena')}
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
            {t('auth.campos.confirmarContrasena')}
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
                  {t('auth.login.iniciarSesion')}
                </Link>
              </>
            )}
          </p>
        )}
        <SubmitButton
          pending={status === 'submitting'}
          pendingLabel={t('auth.crearCuenta.creandoCuenta')}
        >
          {t('auth.crearCuenta.accion')}
        </SubmitButton>
      </form>

      <GoogleAuthButton />

      <p className="mt-7 text-center text-sm text-muted">
        {t('auth.crearCuenta.yaTienesCuenta')}{' '}
        <Link to="/login" className="font-medium text-brasa transition hover:text-brasa-hover">
          {t('auth.login.iniciarSesion')}
        </Link>
      </p>
    </div>
  );
}
