import { type ReactNode } from 'react';

/**
 * Encabezado de pagina compartido: el titulo `h1` + subtitulo, con un slot de accion a la derecha.
 * Reemplaza el bloque `flex items-start justify-between` que cada pantalla redefinia identico. El
 * contenedor de ancho (`mx-auto max-w-*`) sigue en cada pagina porque envuelve tambien la lista.
 * `action` se renderiza tal cual: pasar `false`/`null` cuando no debe mostrarse (como hoy).
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-5">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">{title}</h1>
        <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
