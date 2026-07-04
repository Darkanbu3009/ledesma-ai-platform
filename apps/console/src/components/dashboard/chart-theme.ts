/**
 * Paleta de las graficas del dashboard. Recharts pinta con colores literales (no clases de Tailwind),
 * asi que estos hex ESPEJAN los tokens del sistema definidos en tailwind.config.js -- brasa para las
 * series, y line/muted/ink para grid, ejes y texto. La consola es light-only: un solo juego de valores.
 * Mantener sincronizado con tailwind.config.js si algun token cambia.
 */
export const chartTheme = {
  /** Serie principal (ejecuciones, gasto): brasa, el acento del sistema. */
  brasa: '#E5511E',
  brasaHover: '#D2481A',
  /** Relleno del area: brasa con opacidad (gradiente definido por-grafica). */
  brasaFillTop: 'rgba(229,81,30,0.20)',
  brasaFillBottom: 'rgba(229,81,30,0.02)',
  /** Cursor/hover tenue sobre las barras. */
  brasaWash: 'rgba(229,81,30,0.06)',
  /** Lineas guia (grid) y ejes: line-soft / line del sistema. */
  grid: '#EFEEE8',
  axisLine: '#E4E2DB',
  /** Texto de ejes y etiquetas: muted / muted-soft / ink-soft. */
  tick: '#8A8984',
  tickStrong: '#46443F',
  /** Superficie de la tarjeta (para el anillo del punto activo). */
  surface: '#FFFFFF',
} as const;
