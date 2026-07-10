import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type LoginStatus = 'idle' | 'submitting' | 'error';

/** Estilo del input de credenciales: fondo blanco, hairline calida, foco brasa. */
export const inputClass =
  'h-10 w-full rounded-lg border-[0.5px] border-[rgba(31,30,28,0.22)] bg-white px-3.5 text-sm text-ink outline-none transition placeholder:text-muted-soft focus:border-brasa focus:ring-2 focus:ring-brasa/25';

/** Label monospace estilo laboratorio (CORREO, CONTRASENA). */
export const monoLabelClass = 'font-mono text-[11px] uppercase text-muted';

interface LoginFormProps {
  status: LoginStatus;
  errorMsg: string;
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}

/**
 * Formulario de acceso del panel derecho: campos de correo y contrasena,
 * boton unico brasa, link de recuperacion (/recuperar) y link a crear cuenta
 * (/crear-cuenta). Presentacional: el estado y el signInWithPassword viven en
 * LoginPage y llegan por props.
 */
export function LoginForm({
  status,
  errorMsg,
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: LoginFormProps) {
  return (
    <div>
      <div className="mb-7">
        <h1 className="font-display text-[22px] font-medium text-ink">Iniciar sesión</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Entra con tu correo y contraseña.
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
          <div className="mb-2 flex items-baseline justify-between">
            <label htmlFor="password" className={`${monoLabelClass} block tracking-[3px]`}>
              Contraseña
            </label>
            <Link
              to="/recuperar"
              className="text-xs font-medium text-brasa transition hover:text-brasa-hover"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            className={inputClass}
          />
        </div>
        {status === 'error' && (
          <p className="text-sm text-brasa" role="alert">
            {errorMsg}
          </p>
        )}
        <SubmitButton pending={status === 'submitting'} pendingLabel="Entrando...">
          Iniciar sesión
        </SubmitButton>
      </form>

      <p className="mt-7 text-center text-sm text-muted">
        ¿No tienes cuenta?{' '}
        <Link
          to="/crear-cuenta"
          className="font-medium text-brasa transition hover:text-brasa-hover"
        >
          Crear cuenta
        </Link>
      </p>
    </div>
  );
}

/**
 * Boton primario de las pantallas de acceso: ancho completo, 42px, brasa
 * sobre hueso, con spinner y disabled mientras envia. Lo reusa SignUpForm.
 */
export function SubmitButton({
  pending = false,
  pendingLabel = 'Enviando...',
  children,
}: {
  pending?: boolean;
  pendingLabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-[42px] w-full rounded-lg bg-brasa px-4 text-sm font-medium text-cream transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-hidden="true"
          />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
