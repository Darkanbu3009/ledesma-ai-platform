import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTheme } from './chart-theme';
import { ChartTooltip } from './ChartTooltip';
import { formatUSD } from '../../lib/usage';
import type { ModelSpendPoint } from '../../lib/dashboard';

// Altura por barra + minimo: la altura se reserva segun el numero de modelos (sin salto de layout).
const ROW_HEIGHT = 40;
const MIN_HEIGHT = 132;

/** Ticks del eje de dinero: enteros de dolar para no saturar; el tooltip da el monto exacto. */
function formatAxisUsd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/**
 * Grafica de GASTO por modelo: barras horizontales (mas legibles para los identificadores de modelo)
 * con el costo en USD de cada uno, en brasa (paleta del sistema). Una sola serie de magnitud, asi que
 * un solo tono: la comparacion es por longitud de barra, no por color. Los datos llegan ya ordenados de
 * mayor a menor gasto; solo modelos CON tarifa (los sin tarifa se comunican aparte en la pantalla).
 */
export function SpendByModelChart({ data }: { data: ModelSpendPoint[] }) {
  const { t } = useTranslation();
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-line bg-surface text-sm text-muted"
        style={{ height: MIN_HEIGHT }}
      >
        {t('panel.grafica.gastoVacio')}
      </div>
    );
  }
  const height = Math.max(MIN_HEIGHT, data.length * ROW_HEIGHT + 32);
  return (
    <div
      className="rounded-2xl border border-line bg-surface p-4"
      role="img"
      aria-label={t('panel.grafica.gastoAria')}
    >
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid horizontal={false} stroke={chartTheme.grid} />
          <XAxis
            type="number"
            tickFormatter={formatAxisUsd}
            tickLine={false}
            axisLine={{ stroke: chartTheme.axisLine }}
            tick={{ fontSize: 11, fill: chartTheme.tick }}
          />
          <YAxis
            type="category"
            dataKey="model"
            width={152}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: chartTheme.tickStrong }}
          />
          <Tooltip
            cursor={{ fill: chartTheme.brasaWash }}
            content={<ChartTooltip format={formatUSD} />}
          />
          <Bar
            dataKey="costUsd"
            name="Gasto"
            fill={chartTheme.brasa}
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            // Sin animacion de entrada: las barras pintan su valor de inmediato (ver ActivityChart).
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
