import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Bot,
  ChefHat,
  ChevronDown,
  Clock,
  Globe,
  ListTree,
  Loader2,
  MessageSquare,
  XCircle,
} from 'lucide-react';
import { formatRunAt } from '../../lib/schedule';
import {
  AVISO_TAREA_LENTA_MS,
  esJobCancelado,
  esJobDetenido,
  isJobInFlight,
  jobStatusLabel,
  jobTypeLabel,
  msEnEjecucion,
  type JobActivity,
  type JobStatus,
} from '../../lib/jobs';
import { useTerminarJob } from '../../lib/mutations';
import { TerminarTareaDialog } from './TerminarTareaDialog';
import { TrayectoriaDetalle } from './TrayectoriaDetalle';

/**
 * RELOJ para el aviso de tarea lenta: avanza en cubetas de 10 s (el mismo ritmo que el auto-refresh
 * del historial con tareas en curso). useSyncExternalStore permite leer la hora sin llamar una
 * funcion impura durante el render y sin setState en efectos: el snapshot es estable dentro de cada
 * cubeta, asi que solo re-renderiza cuando la cubeta cambia.
 */
const RELOJ_TICK_MS = 10_000;
function suscribirReloj(onTick: () => void): () => void {
  const timer = setInterval(onTick, RELOJ_TICK_MS);
  return () => clearInterval(timer);
}
function leerReloj(): number {
  return Math.floor(Date.now() / RELOJ_TICK_MS) * RELOJ_TICK_MS;
}

/**
 * Pill de estado de una ejecucion. Colores por estado: completada = verde (ok), fallida = rojo
 * (destructivo, mismo tono que las acciones de borrado), pendiente/en curso = neutro. "En curso" ademas
 * lleva un spinner sutil para comunicar que sigue corriendo. Dos casos especiales sobre 'failed', que
 * se distinguen por el prefijo estable de lastError: Cancelada (el usuario la termino a proposito:
 * tono neutro, no el rojo destructivo) y Detenida (el sistema la termino al dejar de responder).
 */
function StatusBadge({ job }: { job: JobActivity }) {
  const { t } = useTranslation();
  const cancelada = esJobCancelado(job);
  const detenida = esJobDetenido(job);
  const tone: Record<JobStatus, string> = {
    completed: 'border-ok/30 bg-ok/10 text-ok',
    failed: 'border-[rgba(192,73,43,0.3)] bg-[rgba(192,73,43,0.08)] text-[#C0492B]',
    pending: 'border-line bg-line-soft text-muted',
    running: 'border-line bg-line-soft text-muted',
    pausado: 'border-brasa-line bg-brasa-soft text-brasa',
  };
  const etiqueta = cancelada
    ? t('estadoCancelada')
    : detenida
      ? t('estadoDetenida')
      : jobStatusLabel(job.status);
  return (
    <span
      className={[
        'inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        cancelada ? 'border-line bg-line-soft text-muted' : tone[job.status],
      ].join(' ')}
    >
      {job.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
      {etiqueta}
    </span>
  );
}

/**
 * Tarjeta de UNA ejecucion en el historial (/actividad). Muestra el agente que corrio, el tipo (receta o
 * mensaje), cuando se encolo y, si termino, cuando finalizo, los intentos y —si fallo— el error truncado.
 * Espeja la estructura de RecipeCard / ScheduledTaskCard. El nombre del agente lo resuelve la pantalla
 * (useAgents); null = agente ya eliminado.
 */
export function JobActivityCard({ job, agentName }: { job: JobActivity; agentName: string | null }) {
  const { t } = useTranslation();
  // TRAYECTORIA (Fase F, V030): solo las tareas web tienen pasos que abrir. Estado local derivado
  // del click (sin useEffect); el detalle se monta recien al expandir y ahi corre su query.
  const [pasosAbiertos, setPasosAbiertos] = useState(false);
  // Un fallo tecnico se muestra con el texto amable; el last_error crudo queda detras de
  // "Detalle tecnico" (una cancelacion o una detencion tienen su propio texto y no lo usan).
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  // TERMINAR TAREA: confirmacion explicita antes de disparar la mutacion (estado derivado del
  // click, sin useEffect). Disponible mientras la tarea siga en vuelo (pending/running/pausado).
  const [confirmandoTerminar, setConfirmandoTerminar] = useState(false);
  const terminar = useTerminarJob();
  const terminable = isJobInFlight(job.status);
  const cancelada = esJobCancelado(job);
  const detenida = esJobDetenido(job);
  // AVISO de tarea lenta: en curso por encima del umbral. El reloj por cubetas mantiene fresco el
  // tiempo mostrado aunque el refetch tarde.
  const ahora = useSyncExternalStore(suscribirReloj, leerReloj);
  const msCorriendo = msEnEjecucion(job, ahora);
  const tareaLenta = msCorriendo !== null && msCorriendo >= AVISO_TAREA_LENTA_MS;
  const minutosCorriendo = msCorriendo !== null ? Math.floor(msCorriendo / 60_000) : 0;
  const TypeIcon =
    job.type === 'recipe'
      ? ChefHat
      : job.type === 'sitio' || job.type === 'tarea_web'
        ? Globe
        : MessageSquare;
  const created = formatRunAt(job.createdAt) ?? '—';
  const finished = formatRunAt(job.finishedAt);
  // Un job de sitios conectados o de tarea web no tiene agente: el titular es la seccion.
  const title =
    job.type === 'sitio'
      ? t('actividad.card.sitios')
      : job.type === 'tarea_web'
        ? t('actividad.card.tareaWeb')
        : (agentName ?? t('actividad.card.agenteEliminado'));

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-xl bg-brasa-soft text-brasa">
            <TypeIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="inline-flex min-w-0 items-center gap-1.5 truncate font-display text-[15px] font-bold text-ink">
                {job.type === 'sitio' || job.type === 'tarea_web' ? (
                  <Globe className="h-4 w-4 flex-none text-muted" />
                ) : (
                  <Bot className="h-4 w-4 flex-none text-muted" />
                )}
                <span className="truncate">{title}</span>
              </h3>
              <span className="flex-none rounded-full border border-line bg-line-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                {jobTypeLabel(job.type)}
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 flex-none" />
                {created}
              </span>
              {finished && (
                <span className="text-muted-soft">{t('actividad.card.fin', { fecha: finished })}</span>
              )}
              <span className="text-muted-soft">
                {t('actividad.card.intentos', { count: job.attempts })}
              </span>
            </div>

            {job.status === 'failed' && !cancelada && (detenida || job.lastError) && (
              <div className="mt-2.5 rounded-lg border border-[rgba(192,73,43,0.25)] bg-[rgba(192,73,43,0.05)] px-2.5 py-1.5 text-[12px] text-[#C0492B]">
                <div className="flex items-start gap-1.5">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                  {/* Tres desenlaces distintos sobre 'failed': Cancelada no muestra caja (fue una
                      decision del usuario, no un fallo); Detenida trae su propio texto legible en
                      lugar del prefijo tecnico; cualquier otro fallo muestra el texto amable y deja
                      el error crudo detras de "Detalle tecnico". */}
                  <span className="whitespace-pre-wrap break-words">
                    {detenida ? t('detenidaPorSistema') : t('actividad.errorAmable.generico')}
                  </span>
                </div>
                {!detenida && job.lastError && (
                  <>
                    <button
                      type="button"
                      aria-expanded={detalleAbierto}
                      onClick={() => setDetalleAbierto((abierto) => !abierto)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold underline-offset-2 hover:underline"
                    >
                      {t('actividad.errorAmable.detalleTecnico')}
                      <ChevronDown
                        className={['h-3 w-3 transition-transform', detalleAbierto ? 'rotate-180' : ''].join(' ')}
                      />
                    </button>
                    {detalleAbierto && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-[11px] opacity-80">
                        {job.lastError}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {tareaLenta && (
              <div className="mt-2.5 rounded-lg border border-brasa-line bg-brasa-soft px-3 py-2.5">
                <p className="text-[13px] font-semibold text-brasa">{t('avisoTareaLenta.titulo')}</p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {t('avisoTareaLenta.detalle', { minutos: minutosCorriendo })}
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmandoTerminar(true)}
                  className="mt-2 rounded-[10px] bg-brasa px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-brasa-hover"
                >
                  {t('avisoTareaLenta.boton')}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-none flex-col items-start gap-2 sm:items-end">
          <StatusBadge job={job} />
          {terminable && (
            <button
              type="button"
              onClick={() => setConfirmandoTerminar(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-line-soft px-2.5 py-1 text-[12px] font-semibold text-muted transition hover:border-brasa-line hover:text-brasa"
            >
              <XCircle className="h-3.5 w-3.5" />
              {t('avisoTareaLenta.boton')}
            </button>
          )}
        </div>
      </div>

      {job.type === 'tarea_web' && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={pasosAbiertos}
            onClick={() => setPasosAbiertos((abiertos) => !abiertos)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-line-soft px-2.5 py-1 text-[12px] font-semibold text-muted transition hover:border-brasa-line hover:text-brasa"
          >
            <ListTree className="h-3.5 w-3.5" />
            {pasosAbiertos ? t('actividad.trayectoria.ocultarPasos') : t('actividad.trayectoria.verPasos')}
            <ChevronDown
              className={['h-3.5 w-3.5 transition-transform', pasosAbiertos ? 'rotate-180' : ''].join(' ')}
            />
          </button>
          {pasosAbiertos && (
            <div className="mt-2.5">
              <TrayectoriaDetalle jobId={job.id} />
            </div>
          )}
        </div>
      )}

      {confirmandoTerminar && (
        <TerminarTareaDialog
          busy={terminar.isPending}
          {...(terminar.isError ? { error: t('confirmarTerminar.error') } : {})}
          onConfirm={() => terminar.mutate(job.id, { onSuccess: () => setConfirmandoTerminar(false) })}
          onCancel={() => setConfirmandoTerminar(false)}
        />
      )}
    </div>
  );
}
