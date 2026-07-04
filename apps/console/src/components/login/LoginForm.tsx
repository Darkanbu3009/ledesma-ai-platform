import type { FormEvent, ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Mail } from 'lucide-react';

/**
 * Modo desde el que se llega a la pantalla, leido del query param `modo`:
 * - `registro`: el usuario viene de "Crear cuenta".
 * - `acceso`: el usuario viene de "Iniciar sesion" (default si el parametro falta o es desconocido).
 *
 * El mecanismo de acceso es IDENTICO en ambos modos (magic link via signInWithOtp); lo unico que
 * cambia es el texto de la pantalla (titulo, subtitulo, boton y link de alternancia).
 */
export type Modo = 'registro' | 'acceso';

export type LoginStatus = 'idle' | 'submitting' | 'sent' | 'error';

const COPY: Record<
  Modo,
  { title: string; subtitle: string; submit: string; togglePrompt: string; toggleLabel: string; toggleTo: Modo }
> = {
  registro: {
    title: 'Crear tu cuenta',
    subtitle: 'Te enviamos un enlace para empezar.',
    submit: 'Crear cuenta',
    togglePrompt: '¿Ya tienes cuenta?',
    toggleLabel: 'Iniciar sesión',
    toggleTo: 'acceso',
  },
  acceso: {
    title: 'Iniciar sesión',
    subtitle: 'Te enviamos un enlace de acceso.',
    submit: 'Enviar enlace de acceso',
    togglePrompt: '¿No tienes cuenta?',
    toggleLabel: 'Crear cuenta',
    toggleTo: 'registro',
  },
};

/** Estilo del input de correo: fondo blanco, hairline calida, foco brasa. */
const inputClass =
  'h-10 w-full rounded-lg border-[0.5px] border-ink/[0.22] bg-white px-3.5 text-sm text-ink outline-none transition placeholder:text-muted-soft focus:border-brasa focus:ring-2 focus:ring-brasa/25';

/** Label monospace estilo laboratorio (CORREO, divisores). */
const monoLabelClass = 'font-mono text-[11px] uppercase text-muted';

interface LoginFormProps {
  modo: Modo;
  status: LoginStatus;
  errorMsg: string;
  email: string;
  onEmailChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}

/**
 * Formulario de acceso del panel derecho: heading segun modo, campo de correo,
 * boton unico brasa, divisor "acceso solo por invitacion" y link de
 * alternancia entre ?modo=acceso y ?modo=registro (navegacion SPA via Link,
 * sin recarga). Presentacional: el estado y el envio del magic link viven en
 * LoginPage y llegan por props sin cambios de comportamiento.
 *
 * En estado `sent` reemplaza el formulario por la confirmacion "Revisa tu
 * correo". No hay boton de reenvio porque la logica actual no tiene reenvio.
 */
export function LoginForm({ modo, status, errorMsg, email, onEmailChange, onSubmit }: LoginFormProps) {
  const copy = COPY[modo];
  const [searchParams] = useSearchParams();
  // El toggle solo cambia `modo`: se preservan los demas query params (utm, etc.).
  const toggleSearch = new URLSearchParams(searchParams);
  toggleSearch.set('modo', copy.toggleTo);

  if (status === 'sent') {
    return (
      <div className="flex flex-col items-center text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brasa-soft text-brasa">
          <Mail className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-[22px] font-medium text-ink">Revisa tu correo</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Enviamos un enlace a <span className="font-medium text-ink">{email.trim()}</span>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-7">
        <h1 className="font-display text-[22px] font-medium text-ink">{copy.title}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{copy.subtitle}</p>
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
            placeholder="tu@empresa.com"
            className={inputClass}
          />
        </div>
        {status === 'error' && (
          <p className="text-sm text-brasa" role="alert">
            {errorMsg}
          </p>
        )}
        <SubmitButton pending={status === 'submitting'}>{copy.submit}</SubmitButton>
      </form>

      <div className="mt-7 flex items-center gap-3">
        <span className="h-px flex-1 bg-ink/[0.14]" aria-hidden="true" />
        <span className={`${monoLabelClass} tracking-[2px]`}>Acceso solo por invitación</span>
        <span className="h-px flex-1 bg-ink/[0.14]" aria-hidden="true" />
      </div>

      <p className="mt-5 text-center text-sm text-muted">
        {copy.togglePrompt}{' '}
        <Link
          to={{ search: `?${toggleSearch.toString()}` }}
          className="font-medium text-brasa transition hover:text-brasa-hover"
        >
          {copy.toggleLabel}
        </Link>
      </p>
    </div>
  );
}

/**
 * Boton primario del login: ancho completo, 42px, brasa sobre hueso, con
 * spinner y disabled mientras envia (mismo comportamiento de siempre).
 */
function SubmitButton({ pending = false, children }: { pending?: boolean; children: ReactNode }) {
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
          Enviando...
        </span>
      ) : (
        children
      )}
    </button>
  );
}
