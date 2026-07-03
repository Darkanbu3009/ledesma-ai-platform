import { type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export type NoticeKind = 'ok' | 'error';
export type NoticeData = { kind: NoticeKind; text: ReactNode };

/**
 * Region de aviso compartida (exito/error) con `aria-live="polite"` para que el mensaje se anuncie a
 * lectores de pantalla. Reemplaza el bloque que cada pantalla de lista redefinia. La region envolvente
 * existe siempre (reserva su espacio y permite anunciar); el aviso interior aparece solo con `notice`.
 */
export function Notice({
  notice,
  className = 'mt-3',
}: {
  notice: NoticeData | null;
  /** Contenedor de la region viva. Por defecto `mt-3`, como en las pantallas. */
  className?: string;
}) {
  return (
    <div className={className} aria-live="polite">
      {notice && (
        <div
          className={cn(
            'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium',
            notice.kind === 'ok'
              ? 'border-ok/30 bg-ok/10 text-ok'
              : 'border-brasa-line bg-brasa-soft text-brasa',
          )}
        >
          {notice.kind === 'ok' && <CheckCircle2 className="h-4 w-4" />}
          {notice.text}
        </div>
      )}
    </div>
  );
}
