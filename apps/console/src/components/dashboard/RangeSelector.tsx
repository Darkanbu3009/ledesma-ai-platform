import { useTranslation } from 'react-i18next';
import { focusRing } from '../../lib/utils';
import type { DashboardRangePreset } from '../../lib/dashboard';

// `label` guarda la CLAVE de traduccion; se resuelve con t(...) en el render.
const OPTIONS: Array<{ value: DashboardRangePreset; label: string }> = [
  { value: '7d', label: 'panel.rango.dias7' },
  { value: '30d', label: 'panel.rango.dias30' },
  { value: '90d', label: 'panel.rango.dias90' },
];

/**
 * Selector de rango del dashboard (7d / 30d / 90d) como control segmentado, neutro: greige para el
 * activo (el brasa del Panel queda para spark, CTA y progreso). Todos los presets caben dentro de
 * la retencion de datos, asi que no hay que acotar la seleccion. Estado en React (sin localStorage).
 */
export function RangeSelector({
  value,
  onChange,
}: {
  value: DashboardRangePreset;
  onChange: (next: DashboardRangePreset) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('panel.rango.etiqueta')}
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
              active ? 'bg-[#F1EFE8] text-ink' : 'text-[#8A8880] hover:text-ink',
            ].join(' ')}
          >
            {t(option.label)}
          </button>
        );
      })}
    </div>
  );
}
