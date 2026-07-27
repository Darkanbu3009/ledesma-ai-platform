import { useTranslation } from 'react-i18next';
import { CheckCircle2, Globe, Loader2, XCircle } from 'lucide-react';
import { useTrayectoriasDeJob } from '../../lib/queries';
import {
  formatearDuracion,
  sitiosUsados,
  tituloDePaso,
  trayectoriaEstadoLabel,
  type PasoDeTrayectoria,
  type Trayectoria,
} from '../../lib/trayectorias';

/**
 * DETALLE DE TRAYECTORIA de una tarea web (Fase F, V030), SOLO LECTURA: las ejecuciones del motor de
 * navegacion registradas para un job, con sus pasos (accion, selector, url, exito) y el resumen
 * (estado, duracion, tokens). Se monta recien cuando la tarjeta se expande, asi la query corre solo
 * si alguien abre la tarea. Los valores sensibles ya llegan censurados desde el worker
 * ('[CENSURADO]'); aqui no hay nada que ocultar de mas. Sin promocion a receta ni replay (PR futuro).
 */

/** Pill de estado de una trayectoria (mismos tonos que los estados de jobs). Una ejecucion cuyo
 *  job sigue corriendo se muestra "En curso" (FIX D): su estado persistido es provisional. */
function EstadoTrayectoriaBadge({ estado, enCurso }: { estado: Trayectoria['estado']; enCurso?: boolean }) {
  const { t } = useTranslation();
  const tone: Record<Trayectoria['estado'], string> = {
    exitosa: 'border-ok/30 bg-ok/10 text-ok',
    fallida: 'border-[rgba(192,73,43,0.3)] bg-[rgba(192,73,43,0.08)] text-[#C0492B]',
    pausada: 'border-brasa-line bg-brasa-soft text-brasa',
  };
  return (
    <span
      className={[
        'inline-flex flex-none items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        enCurso === true ? 'border-line bg-line-soft text-muted' : tone[estado],
      ].join(' ')}
    >
      {enCurso === true ? t('actividad.trayectoria.estado.enCurso') : trayectoriaEstadoLabel(estado)}
    </span>
  );
}

/** Una fila de paso: numero, exito, instruccion y los datos tecnicos (selector, url, valor). */
function PasoRow({ paso }: { paso: PasoDeTrayectoria }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-start gap-2.5 border-t border-line-soft px-3 py-2 first:border-t-0">
      <span className="mt-0.5 w-6 flex-none text-right text-[11px] font-semibold tabular-nums text-muted-soft">
        {paso.idx + 1}
      </span>
      {paso.exito === false ? (
        <XCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-[#C0492B]" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-ok" />
      )}
      <div className="min-w-0 flex-1">
        <p className="break-words text-[12.5px] text-ink">
          <span className="mr-1.5 rounded border border-line bg-line-soft px-1 py-px font-mono text-[10px] uppercase text-muted">
            {paso.accion.tipo}
          </span>
          {tituloDePaso(paso)}
        </p>
        {paso.selector && (
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted" title={paso.selector}>
            {t('actividad.trayectoria.selector')}: {paso.selector}
          </p>
        )}
        {paso.valorCensurado !== null && (
          <p className="mt-0.5 break-words font-mono text-[11px] text-muted">
            {t('actividad.trayectoria.valor')}: {paso.valorCensurado}
          </p>
        )}
        {paso.url && (
          <p className="mt-0.5 truncate text-[11px] text-muted-soft" title={paso.url}>
            {paso.url}
          </p>
        )}
      </div>
    </li>
  );
}

/** Una ejecucion del motor: resumen (estado, duracion, tokens) + lista de pasos ordenada. */
function TrayectoriaBloque({
  trayectoria,
  numero,
  enCurso,
}: {
  trayectoria: Trayectoria;
  numero: number;
  enCurso?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-line bg-line-soft/40">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11.5px] text-muted">
        <span className="font-semibold text-ink">
          {t('actividad.trayectoria.ejecucion', { num: numero })}
        </span>
        <EstadoTrayectoriaBadge estado={trayectoria.estado} {...(enCurso === true ? { enCurso: true } : {})} />
        <span>{t('actividad.trayectoria.duracion', { valor: formatearDuracion(trayectoria.duracionMs) })}</span>
        {trayectoria.tokensIn !== null && trayectoria.tokensOut !== null && (
          <span>
            {t('actividad.trayectoria.tokens', {
              entrada: trayectoria.tokensIn,
              salida: trayectoria.tokensOut,
            })}
          </span>
        )}
        <span>{t('actividad.trayectoria.pasos', { count: trayectoria.pasos.length })}</span>
      </div>
      {trayectoria.pasos.length > 0 && (
        <ul className="border-t border-line-soft">
          {trayectoria.pasos.map((paso) => (
            <PasoRow key={paso.idx} paso={paso} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function TrayectoriaDetalle({ jobId, enCurso = false }: { jobId: string; enCurso?: boolean }) {
  const { t } = useTranslation();
  const { data: trayectorias, isLoading, isError } = useTrayectoriasDeJob(jobId, true, enCurso);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-[12px] text-muted" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('actividad.trayectoria.cargando')}
      </div>
    );
  }
  if (isError) {
    return <p className="py-2 text-[12px] text-[#C0492B]">{t('actividad.trayectoria.error')}</p>;
  }
  if (!trayectorias || trayectorias.length === 0) {
    return <p className="py-2 text-[12px] text-muted">{t('actividad.trayectoria.vacia')}</p>;
  }
  const sitios = sitiosUsados(trayectorias);
  return (
    <div className="space-y-2.5">
      {/* Una tarea puede trabajar en varios sitios del usuario (buscar en uno, escribir en otro).
          Cuando eso pasa, se listan TODOS: es la unica forma de que se vea donde estuvo la tarea. */}
      {sitios.length > 1 && (
        <div className="rounded-xl border border-line bg-line-soft/40 px-3 py-2">
          <p className="text-[11.5px] font-semibold text-ink">{t('multisitio.sitiosUsados')}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {sitios.map((sitio) => (
              <li
                key={sitio}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-muted"
              >
                <Globe className="h-3 w-3 flex-none" />
                {sitio}
              </li>
            ))}
          </ul>
        </div>
      )}
      {trayectorias.map((trayectoria, i) => (
        <TrayectoriaBloque
          key={trayectoria.id}
          trayectoria={trayectoria}
          numero={i + 1}
          // Solo la ULTIMA ejecucion de un job que sigue corriendo esta en curso (FIX D): las
          // anteriores ya terminaron con su estado real.
          enCurso={enCurso && i === trayectorias.length - 1}
        />
      ))}
    </div>
  );
}
