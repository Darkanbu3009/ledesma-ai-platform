import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { inputClass, monoLabelClass, SubmitButton } from './LoginForm';

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
 * cuando no hay sesion de recuperacion en /nueva-contrasena y ofrece volver a
 * /recuperar para pedir un enlace nuevo.
 */
export function InvalidRecoveryNotice() {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brasa-soft text-brasa">
        <TriangleAlert className="h-5 w-5" aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-display text-[22px] font-medium text-ink">
        Enlace inválido o expirado
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        El enlace para restablecer tu contraseña ya no es válido. Pide uno nuevo y vuelve a
        intentarlo.
      </p>
      <p className="mt-5 text-sm text-muted">
        <Link to="/recuperar" className="font-medium text-brasa transition hover:text-brasa-hover">
          Pedir un enlace nuevo
        </Link>
      </p>
    </div>
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
  if (status === 'saved') {
    return (
      <div className="flex flex-col items-center text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brasa-soft text-brasa">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-[22px] font-medium text-ink">Contraseña guardada</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Tu contraseña se actualizó. Te estamos redirigiendo.
        </p>
        <p className="mt-5 text-sm text-muted">
          <Link
            to={continueTo}
            className="font-medium text-brasa transition hover:text-brasa-hover"
          >
            {continueTo === '/login' ? 'Ir a iniciar sesión' : 'Ir a la consola'}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-7">
        <h1 className="font-display text-[22px] font-medium text-ink">Elige una nueva contraseña</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Escríbela dos veces para confirmarla.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className={`${monoLabelClass} mb-2 block tracking-[3px]`}>
            Nueva contraseña
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
          </p>
        )}
        <SubmitButton pending={status === 'submitting'} pendingLabel="Guardando...">
          Guardar contraseña
        </SubmitButton>
      </form>
    </div>
  );
}
