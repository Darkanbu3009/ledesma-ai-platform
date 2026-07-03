import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Estado de error de carga compartido: card editorial con titulo, subtitulo fijo y boton Reintentar.
 * Reemplaza el bloque "No pudimos cargar..." que estaba copiado en cada pantalla de lista (y que ya
 * habia divergido en la ortografia de "conexion"). Lleva `role="alert"` para que el fallo de carga se
 * anuncie a lectores de pantalla, algo que ninguna de las copias hacia.
 */
export function ErrorState({
  title,
  onRetry,
  className = 'mt-10',
}: {
  title: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('rounded-2xl border border-line bg-surface p-8 text-center shadow-card', className)}
    >
      <p className="font-display text-lg font-bold text-ink">{title}</p>
      <p className="mt-2 text-sm text-muted">Revisa tu conexión e intenta de nuevo.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:border-ink-soft hover:text-ink"
      >
        <RefreshCw className="h-4 w-4" />
        Reintentar
      </button>
    </div>
  );
}
