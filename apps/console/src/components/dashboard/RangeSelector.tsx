import { focusRing } from '../../lib/utils';
import type { DashboardRangePreset } from '../../lib/dashboard';

const OPTIONS: Array<{ value: DashboardRangePreset; label: string }> = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
];

/**
 * Selector de rango del dashboard (7d / 30d / 90d) como control segmentado, con el mismo lenguaje visual
 * que las barras de filtro de la consola (brasa-soft para el activo). Todos los presets caben dentro de
 * la retencion de datos, asi que no hay que acotar la seleccion. Estado en React (sin localStorage).
 */
export function RangeSelector({
  value,
  onChange,
}: {
  value: DashboardRangePreset;
  onChange: (next: DashboardRangePreset) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Rango de tiempo"
      className="inline-flex rounded-xl border border-line bg-surface p-1"
    >
      {OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={[
              'rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
              focusRing,
              active ? 'bg-brasa-soft text-brasa' : 'text-muted hover:text-ink',
            ].join(' ')}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
