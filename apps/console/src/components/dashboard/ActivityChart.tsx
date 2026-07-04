import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTheme } from './chart-theme';
import { ChartTooltip } from './ChartTooltip';
import type { ActivityPoint } from '../../lib/dashboard';

// Altura fija reservada para la grafica: evita saltos de layout entre carga y datos.
const CHART_HEIGHT = 260;

/** Etiqueta del tooltip: "3 ejecuciones" / "1 ejecucion" (redondeado, con separador de miles es-MX). */
function formatRuns(value: number): string {
  const runs = Math.round(value);
  return `${runs.toLocaleString('es-MX')} ${runs === 1 ? 'ejecucion' : 'ejecuciones'}`;
}

/**
 * Grafica de ACTIVIDAD: ejecuciones por dia en el rango, como area con la serie en brasa (paleta del
 * sistema, no los colores default de Recharts). Responsive (ResponsiveContainer) y con altura reservada.
 * Ejes tenues, tooltip estilizado con los tokens de la consola. Serie unica: el titulo de la seccion la
 * nombra, asi que no lleva leyenda.
 */
export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-line bg-surface text-sm text-muted"
        style={{ height: CHART_HEIGHT }}
      >
        Sin ejecuciones en este periodo.
      </div>
    );
  }
  return (
    <div
      className="rounded-2xl border border-line bg-surface p-4"
      role="img"
      aria-label="Grafica de ejecuciones por dia en el rango seleccionado"
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="dashboard-activity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chartTheme.brasa} stopOpacity={0.2} />
              <stop offset="100%" stopColor={chartTheme.brasa} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={chartTheme.grid} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: chartTheme.axisLine }}
            tick={{ fontSize: 11, fill: chartTheme.tick }}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            allowDecimals={false}
            width={32}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: chartTheme.tick }}
          />
          <Tooltip
            cursor={{ stroke: chartTheme.axisLine, strokeWidth: 1 }}
            content={<ChartTooltip format={formatRuns} />}
          />
          <Area
            type="monotone"
            dataKey="runs"
            name="Ejecuciones"
            stroke={chartTheme.brasa}
            strokeWidth={2}
            fill="url(#dashboard-activity-fill)"
            dot={false}
            activeDot={{ r: 4, fill: chartTheme.brasa, stroke: chartTheme.surface, strokeWidth: 2 }}
            // Sin animacion de entrada: el area pinta sus datos de inmediato (evita el "flash vacio"
            // que puede dejar la animacion basada en requestAnimationFrame hasta que corre el primer frame).
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
