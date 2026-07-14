import i18n, { currentLanguage } from '../i18n';

export interface AgentUsageTotals {
  runs: number;
  completed: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentRunSummary {
  id: string;
  status: 'completed' | 'error' | 'aborted' | string;
  errorCode: string | null;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  createdAt: string;
}

export interface AgentRunsByDay {
  date: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentUsage {
  totals: AgentUsageTotals;
  recent: AgentRunSummary[];
  runsByDay: AgentRunsByDay[];
}

export type UsageRangePreset = '7d' | '30d' | 'all';

export interface UsageRange {
  from?: string;
  to?: string;
}

/** Rango ISO hacia atras desde `now` segun el preset; 'all' no acota ({}). */
export function rangeFromPreset(preset: UsageRangePreset, now: Date = new Date()): UsageRange {
  if (preset === 'all') return {};
  const days = preset === '7d' ? 7 : 30;
  return { from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString() };
}

/** 950 -> '950'; 12400 -> '12,4k'; 3200000 -> '3,2M' (es-MX usa coma decimal). */
export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1).replace('.', ',').replace(',0', '')}k`;
  return `${(value / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')}M`;
}

/** 850 -> '850 ms'; 1500 -> '1,5 s'; 65000 -> '1 min 5 s'. */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace('.', ',').replace(',0', '')} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

// Formateador de dinero reutilizable (USD, 2 decimales). Se construye una sola vez: instanciar
// Intl.NumberFormat en cada llamada es caro. en-US para el simbolo '$' y separador de miles con coma.
const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Monto en USD con simbolo y 2 decimales: 0 -> '$0.00'; 1234.5 -> '$1,234.50'. El gasto del dashboard
 * es transparencia BYOK (lo que el cliente quemo en SU key), no un cobro; el formateo solo lo presenta.
 * Un valor no finito (NaN/Infinity, defensa ante datos incompletos) degrada a '$0.00' en vez de 'NaN'.
 */
export function formatUSD(value: number): string {
  if (!Number.isFinite(value)) return '$0.00';
  return USD_FORMATTER.format(value);
}

/** 'YYYY-MM-DD' -> '10 jun' (es-MX). Se interpreta en UTC para no desfasar el dia por zona horaria. */
export function formatDayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** ISO -> fecha corta es-MX, p.ej. '10 jun, 14:32'. */
export function formatRunDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(currentLanguage() === 'en' ? 'en' : 'es-MX', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Etiqueta y tono visual por estado. */
export function statusLabel(status: string): { label: string; tone: 'ok' | 'error' | 'muted' } {
  switch (status) {
    case 'completed':
      return { label: i18n.t('uso.estado.completada'), tone: 'ok' };
    case 'error':
      return { label: i18n.t('uso.estado.error'), tone: 'error' };
    case 'aborted':
      return { label: i18n.t('uso.estado.detenida'), tone: 'muted' };
    default:
      return { label: status, tone: 'muted' };
  }
}
