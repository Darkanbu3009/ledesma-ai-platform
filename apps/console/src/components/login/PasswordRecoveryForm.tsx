import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  if (status === 'sent') {
    return (
      <AuthNotice
        icon={Mail}
        title={t('auth.comun.revisaCorreoTitulo')}
        body={t('auth.recuperar.confirmacionCuerpo')}
        linkTo="/login"
        linkLabel={t('auth.recuperar.volverIniciarSesion')}
      />
    );
  }

  return (
    <div>
      <div className="mb-7">
        <h1 className="font-display text-[22px] font-medium text-ink">
          {t('auth.recuperar.titulo')}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {t('auth.recuperar.subtitulo')}
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
        {status === 'error' && (
          <p className="text-sm text-brasa" role="alert">
            {errorMsg}
          </p>
        )}
        <SubmitButton
          pending={status === 'submitting'}
          pendingLabel={t('auth.recuperar.enviandoEnlace')}
        >
          {t('auth.recuperar.enviarEnlace')}
        </SubmitButton>
      </form>

      <p className="mt-7 text-center text-sm text-muted">
        <Link to="/login" className="font-medium text-brasa transition hover:text-brasa-hover">
          {t('auth.recuperar.volverIniciarSesion')}
        </Link>
      </p>
    </div>
  );
}
