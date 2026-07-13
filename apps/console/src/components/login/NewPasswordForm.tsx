import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { inputClass, monoLabelClass, SubmitButton } from './LoginForm';
import { AuthNotice } from './AuthNotice';

export type NewPasswordStatus = 'idle' | 'submitting' | 'error' | 'saved';

interface NewPasswordFormProps {
  status: NewPasswordStatus;
  errorMsg: string;
  /** Ruta a la que continua el usuario tras guardar (consola o /login). */
  continueTo: string;
  password: string;
  confirm: string;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}

/**
 * Aviso de enlace de recuperacion invalido o expirado: reemplaza el formulario
 * cuando no hay sesion en /nueva-contrasena y ofrece volver a /recuperar para
 * pedir un enlace nuevo.
 */
export function InvalidRecoveryNotice() {
  const { t } = useTranslation();
  return (
    <AuthNotice
      icon={TriangleAlert}
      title={t('auth.nuevaContrasena.enlaceInvalidoTitulo')}
      body={t('auth.nuevaContrasena.enlaceInvalidoCuerpo')}
      linkTo="/recuperar"
      linkLabel={t('auth.nuevaContrasena.pedirEnlaceNuevo')}
    />
  );
}

/**
 * Formulario de nueva contrasena del panel derecho: campos de contrasena y su
 * confirmacion y boton unico brasa. Presentacional: el estado y el updateUser
 * viven en NewPasswordPage y llegan por props.
 *
 * En estado `saved` reemplaza el formulario por la confirmacion con el link
 * para continuar (a la consola si hay sesion, a /login si no).
 */
export function NewPasswordForm({
  status,
  errorMsg,
  continueTo,
  password,
  confirm,
  onPasswordChange,
  onConfirmChange,
  onSubmit,
}: NewPasswordFormProps) {
  const { t } = useTranslation();
  if (status === 'saved') {
    return (
      <AuthNotice
        icon={CheckCircle2}
        title={t('auth.nuevaContrasena.guardadaTitulo')}
        body={t('auth.nuevaContrasena.guardadaCuerpo')}
        linkTo={continueTo}
        linkLabel={
          continueTo === '/login'
            ? t('auth.comun.irIniciarSesion')
            : t('auth.nuevaContrasena.irConsola')
        }
      />
    );
  }

  return (
    <div>
      <div className="mb-7">
        <h1 className="font-display text-[22px] font-medium text-ink">
          {t('auth.nuevaContrasena.titulo')}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {t('auth.nuevaContrasena.subtitulo')}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className={`${monoLabelClass} mb-2 block tracking-[3px]`}>
            {t('auth.nuevaContrasena.nuevaContrasenaLabel')}
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
          </p>
        )}
        <SubmitButton
          pending={status === 'submitting'}
          pendingLabel={t('auth.nuevaContrasena.guardando')}
        >
          {t('auth.nuevaContrasena.guardar')}
        </SubmitButton>
      </form>
    </div>
  );
}
