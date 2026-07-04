/**
 * Tooltip compartido de las graficas del dashboard, estilizado con los tokens del sistema (surface,
 * line, ink, muted) en vez del tooltip default de Recharts. Se pasa como `content={<ChartTooltip .../>}`:
 * Recharts clona el elemento e inyecta `active`, `label` y `payload` en tiempo de ejecucion (por eso van
 * opcionales aqui). `format` convierte el valor crudo al texto final (p.ej. formatUSD o "3 ejecuciones").
 */
export interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ value?: number | string | Array<number | string> }>;
  format: (value: number) => string;
}

export function ChartTooltip({ active, label, payload, format }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const raw = payload[0]?.value;
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  const value = Number.isFinite(numeric) ? numeric : 0;
  return (
    <div className="pointer-events-none rounded-xl border border-line bg-surface px-3 py-2 shadow-card">
      <p className="text-[11px] font-medium text-muted">{String(label ?? '')}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink">{format(value)}</p>
    </div>
  );
}
