import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Aviso centrado de las pantallas de acceso: icono en circulo brasa suave,
 * titulo display, cuerpo muted y un link brasa de continuacion. Lo comparten
 * los estados de confirmacion y de enlace invalido del flujo de recuperacion
 * de contrasena.
 */
export function AuthNotice({
  icon: Icon,
  title,
  body,
  linkTo,
  linkLabel,
}: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  body: ReactNode;
  linkTo: string;
  linkLabel: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brasa-soft text-brasa">
        <Icon className="h-5 w-5" aria-hidden={true} />
      </span>
      <h1 className="mt-4 font-display text-[22px] font-medium text-ink">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
      <p className="mt-5 text-sm text-muted">
        <Link to={linkTo} className="font-medium text-brasa transition hover:text-brasa-hover">
          {linkLabel}
        </Link>
      </p>
    </div>
  );
}
