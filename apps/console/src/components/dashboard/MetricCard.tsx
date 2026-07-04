import { type ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Tarjeta de metrica del dashboard: etiqueta clara + numero grande. Composicion local de la pantalla
 * (no una primitiva compartida), al estilo del `StatusFilterBar` de Actividad. `emphasis` resalta el
 * numero en brasa (p.ej. fallidas/errores > 0); `compact` reduce el tamano para valores de texto (una
 * fecha, una etiqueta) que no caben como numero gigante.
 */
export interface MetricCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  emphasis?: boolean;
  compact?: boolean;
}

export function MetricCard({ label, value, hint, icon, emphasis, compact }: MetricCardProps) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <p className="text-[13px] font-medium">{label}</p>
      </div>
      <p
        className={cn(
          'mt-2 font-display font-bold tabular-nums',
          compact ? 'text-lg leading-tight' : 'text-3xl',
          emphasis ? 'text-brasa' : 'text-ink',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-soft">{hint}</p>}
    </div>
  );
}
