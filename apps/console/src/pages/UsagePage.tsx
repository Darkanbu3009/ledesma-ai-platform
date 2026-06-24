import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Play, RefreshCw } from 'lucide-react';
import { providerLabel } from '../lib/agents';
import { useAgent, useAgentUsage } from '../lib/queries';
import {
  formatDurationMs,
  formatRunDate,
  formatTokens,
  rangeFromPreset,
  statusLabel,
  type UsageRangePreset,
} from '../lib/usage';

const badgeBaseClass = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs';

const badgeToneClass = {
  ok: 'border border-grafito-border text-hueso',
  error: 'border border-brasa/40 text-brasa',
  muted: 'text-hueso-muted',
} as const;

const rangePresets: Array<{ value: UsageRangePreset; label: string }> = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'all', label: 'Todo' },
];

// 'YYYY-MM-DD' -> '10 jun' (es-MX). Se interpreta en UTC para no desfasar el dia.
function formatDayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function UsagePage() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading, isError, refetch } = useAgent(id);
  const [preset, setPreset] = useState<UsageRangePreset>('30d');
  // Memoizado por preset: evita que cada render genere un from distinto (y refetches en cadena).
  const range = useMemo(() => rangeFromPreset(preset), [preset]);
  const usage = useAgentUsage(id, range);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="h-12 animate-pulse rounded-xl border border-grafito-border bg-grafito" />
        <div className="h-24 animate-pulse rounded-xl border border-grafito-border bg-grafito" />
        <div className="h-64 animate-pulse rounded-xl border border-grafito-border bg-grafito" />
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mt-10 rounded-xl border border-grafito-border bg-grafito p-8 text-center">
          <p className="font-display text-lg text-hueso">No pudimos cargar el agente</p>
          <p className="mt-2 text-sm text-hueso-muted">Revisa tu conexion e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const totals = usage.data?.totals;
  const totalCards = totals
    ? [
        { label: 'Corridas', value: String(totals.runs) },
        { label: 'Completadas', value: String(totals.completed) },
        { label: 'Errores', value: String(totals.errors), accent: totals.errors > 0 },
        { label: 'Tokens entrada', value: formatTokens(totals.inputTokens) },
        { label: 'Tokens salida', value: formatTokens(totals.outputTokens) },
      ]
    : [];

  const runsByDay = usage.data?.runsByDay ?? [];
  // Tope del eje con un minimo sensato: una sola corrida se ve como barra corta, no como bloque.
  const maxRunsByDay = Math.max(4, ...runsByDay.map((day) => day.runs));
  // Mostrar solo algunas etiquetas de fecha (aprox. una de cada seis) para no saturar el eje.
  const dateLabelStep = Math.max(1, Math.ceil(runsByDay.length / 6));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold text-hueso">
            Uso — {agent.name}
          </h1>
          <p className="mt-1 text-sm text-hueso-muted">
            {providerLabel(agent.providerId)} · <span className="font-mono">{agent.model}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => void usage.refetch()}
            className="inline-flex items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
          >
            <RefreshCw className={`h-4 w-4 ${usage.isFetching ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          <Link
            to={`/agentes/${agent.id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Link>
        </div>
      </div>

      <div
        role="group"
        aria-label="Rango de fechas"
        className="mt-6 inline-flex rounded-lg border border-grafito-border bg-grafito p-1"
      >
        {rangePresets.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setPreset(option.value)}
            className={`rounded-md px-3 py-1.5 text-xs transition ${
              preset === option.value
                ? 'bg-grafito-border text-hueso'
                : 'text-hueso-muted hover:text-hueso'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {usage.isLoading ? (
        <div className="mt-6 space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-xl border border-grafito-border bg-grafito"
              />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-xl border border-grafito-border bg-grafito" />
        </div>
      ) : usage.isError || !usage.data ? (
        <div className="mt-10 rounded-xl border border-grafito-border bg-grafito p-8 text-center">
          <p className="font-display text-lg text-hueso">No pudimos cargar el uso del agente</p>
          <p className="mt-2 text-sm text-hueso-muted">Revisa tu conexion e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void usage.refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      ) : usage.data.totals.runs === 0 && preset === 'all' ? (
        <div className="mt-10 rounded-xl border border-dashed border-grafito-border py-16 text-center">
          <p className="text-sm text-hueso-muted">
            Aun no hay corridas registradas. Prueba tu agente en el Playground.
          </p>
          <Link
            to={`/agentes/${agent.id}/playground`}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
          >
            <Play className="h-4 w-4" />
            Ir al Playground
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {totalCards.map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-grafito-border bg-grafito p-4"
              >
                <p className="text-xs text-hueso-muted">{card.label}</p>
                <p
                  className={`mt-1 font-display text-2xl font-bold ${card.accent ? 'text-brasa' : 'text-hueso'}`}
                >
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          <section className="mt-8">
            <h2 className="font-display text-lg font-semibold text-hueso">Corridas por dia</h2>
            <div className="mt-3 rounded-xl border border-grafito-border bg-grafito p-4">
              {runsByDay.length === 0 ? (
                // Estado vacio: eje base y un texto tenue, sin bloque ni area en blanco.
                <div className="flex h-40 flex-col">
                  <div className="flex flex-1 items-center justify-center">
                    <p className="text-sm text-hueso-muted">Sin corridas en este periodo.</p>
                  </div>
                  <div className="border-t border-grafito-border" />
                </div>
              ) : (
                <div className="flex gap-3">
                  {/* Eje vertical: maximo, mitad y cero */}
                  <div className="flex h-40 w-8 shrink-0 flex-col justify-between py-px text-right font-mono text-[10px] leading-none text-hueso-muted">
                    <span>{maxRunsByDay}</span>
                    <span>{Math.round(maxRunsByDay / 2)}</span>
                    <span>0</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* Area de barras con lineas guia horizontales */}
                    <div className="relative h-40">
                      <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-grafito-border/60" />
                      <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-grafito-border/50" />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-grafito-border" />
                      <div className="absolute inset-0 flex items-end gap-1.5">
                        {runsByDay.map((day) => (
                          <div
                            key={day.date}
                            title={`${formatDayLabel(day.date)}: ${day.runs} ${day.runs === 1 ? 'corrida' : 'corridas'}`}
                            className="max-w-[22px] flex-1 rounded-t-[3px] bg-brasa transition-colors hover:bg-[#C8460F]"
                            style={{
                              height: `${(day.runs / maxRunsByDay) * 100}%`,
                              minHeight: day.runs > 0 ? '3px' : undefined,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    {/* Etiquetas de fecha (solo algunas para no saturar) */}
                    <div className="mt-2 flex gap-1.5">
                      {runsByDay.map((day, i) => (
                        <div key={day.date} className="max-w-[22px] flex-1 text-center">
                          {i % dateLabelStep === 0 && (
                            <span className="whitespace-nowrap font-mono text-[10px] leading-none text-hueso-muted">
                              {formatDayLabel(day.date)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {usage.data.recent.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-lg font-semibold text-hueso">Corridas recientes</h2>
              <div className="mt-3 overflow-x-auto rounded-xl border border-grafito-border bg-grafito">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-grafito-border text-xs text-hueso-muted">
                      <th className="px-4 py-3 font-medium">Fecha</th>
                      <th className="px-4 py-3 font-medium">Estado</th>
                      <th className="px-4 py-3 font-medium">Codigo</th>
                      <th className="px-4 py-3 font-medium">Tokens</th>
                      <th className="px-4 py-3 font-medium">Duracion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.data.recent.map((run) => {
                      const status = statusLabel(run.status);
                      return (
                        <tr key={run.id} className="border-b border-grafito-border last:border-b-0">
                          <td className="whitespace-nowrap px-4 py-3 text-hueso">
                            {formatRunDate(run.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`${badgeBaseClass} ${badgeToneClass[status.tone]}`}>
                              {status.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-hueso-muted">
                            {run.errorCode ?? '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-hueso">
                            {formatTokens(run.inputTokens)} in · {formatTokens(run.outputTokens)}{' '}
                            out
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-hueso-muted">
                            {formatDurationMs(run.durationMs)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <p className="mt-8 text-xs text-hueso-muted">
        Solo se registran metricas de cada corrida (tokens, duracion, estado). El contenido de las
        conversaciones nunca se almacena.
      </p>
    </div>
  );
}
