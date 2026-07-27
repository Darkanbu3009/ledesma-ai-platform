import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Sparkles, Trash2 } from 'lucide-react';
import { useTareasEnsenadas } from '../lib/queries';
import { useOlvidarTareaEnsenada } from '../lib/mutations';
import { agruparPorSitio, formatearFecha, type TareaEnsenada } from '../lib/tareas-ensenadas';
import { PageHeader } from '../components/ui/PageHeader';
import { SkeletonList } from '../components/ui/SkeletonList';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { focusRing } from '../lib/utils';

/**
 * TAREAS QUE YA SABE HACER: lo que el usuario le enseno haciendolo el mismo una vez, y lo que el
 * sistema aprendio solo de una tarea que salio bien. Se ven agrupadas por sitio, con lo que hace cada
 * una, cuando se enseno, cuantas veces la hizo y que datos hay que darle. Y se pueden borrar.
 *
 * NO ES /recetas. Esa pantalla es otra funcionalidad (cadenas de instrucciones para un agente
 * conversacional) y sigue intacta. Esta es la unica forma que tiene el usuario de VER y BORRAR lo que
 * enseno: hasta ahora eso vivia solo en la base y no habia donde mirarlo.
 *
 * VOCABULARIO, y es una regla dura de esta pantalla: NO se nombra nada tecnico. Ni receta, ni firma,
 * ni selector, ni parametro. Quien la lee no programa: lee "tareas que ya sabe hacer" y "datos que le
 * tienes que dar".
 *
 * BORRAR PREGUNTA SIEMPRE, en la propia tarjeta (no hay dialogo aparte): es una accion que no se
 * puede deshacer -- habria que volver a ensenarle la tarea -- y el boton esta al lado de una lista,
 * donde un clic de mas es facil.
 */
function TarjetaDeTarea({ tarea }: { tarea: TareaEnsenada }) {
  const { t } = useTranslation();
  const olvidar = useOlvidarTareaEnsenada();
  const [confirmando, setConfirmando] = useState(false);

  return (
    <li className="rounded-2xl border border-line bg-surface p-[18px] shadow-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">
            {tarea.descripcion ?? t('ensenadas.sinDescripcion')}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {t(tarea.descripcion === null ? 'ensenadas.aprendidaEn' : 'ensenadas.ensenadaEn', {
              fecha: formatearFecha(tarea.ensenadaEn),
            })}
            {' · '}
            {tarea.usos > 0 ? t('ensenadas.usos', { n: tarea.usos }) : t('ensenadas.sinUsos')}
          </p>
          {/* Solo si alguna vez se ajusto sola: una linea discreta, sin nada tecnico. */}
          {(tarea.ajustes ?? 0) > 0 && (
            <p className="mt-0.5 text-[12.5px] text-muted-soft">
              {t('ensenadas.ajustes', { n: tarea.ajustes })}
            </p>
          )}

          <div className="mt-3">
            <p className="text-[12px] uppercase tracking-[0.07em] text-muted">
              {t('ensenadas.datosQueNecesita')}
            </p>
            {tarea.datosQueNecesita.length === 0 ? (
              <p className="mt-1.5 text-[13px] text-muted">{t('ensenadas.sinDatos')}</p>
            ) : (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {tarea.datosQueNecesita.map((dato) => (
                  <li
                    key={dato}
                    className="rounded-full bg-line-soft px-2.5 py-[3px] text-[12.5px] text-ink-soft"
                  >
                    {t(`ensenadas.tipos.${dato}`)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {confirmando ? (
          <div className="sm:w-[260px] sm:flex-none">
            <p className="text-[13.5px] font-medium text-ink">{t('ensenadas.confirmarTitulo')}</p>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-muted">
              {t('ensenadas.confirmarTexto')}
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => olvidar.mutate(tarea.id)}
                disabled={olvidar.isPending}
                className={`inline-flex items-center gap-1.5 rounded-xl bg-brasa px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-brasa-hover disabled:opacity-60 ${focusRing}`}
              >
                <Trash2 className="h-[15px] w-[15px]" />
                {olvidar.isPending ? t('ensenadas.borrando') : t('ensenadas.borrar')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className={`rounded-xl border border-line px-3 py-1.5 text-[13px] font-medium text-muted transition hover:text-ink ${focusRing}`}
              >
                {t('ensenadas.confirmarCancelar')}
              </button>
            </div>
            {olvidar.isError && (
              <p role="alert" className="mt-2 text-[12.5px] text-brasa">
                {t('ensenadas.errorBorrar')}
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            className={`inline-flex flex-none items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[13px] font-medium text-muted transition hover:border-ink-soft hover:text-ink ${focusRing}`}
          >
            <Trash2 className="h-[15px] w-[15px]" />
            {t('ensenadas.borrar')}
          </button>
        )}
      </div>
    </li>
  );
}

export function TareasEnsenadasPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useTareasEnsenadas();
  const grupos = agruparPorSitio(data ?? []);

  return (
    <div className="mx-auto flex max-w-5xl flex-1 flex-col">
      <PageHeader title={t('ensenadas.titulo')} subtitle={t('ensenadas.subtitulo')} />

      {isLoading && <SkeletonList cardClassName="h-[132px]" />}
      {isError && <ErrorState title={t('ensenadas.error')} onRetry={() => void refetch()} />}

      {!isLoading && !isError && grupos.length === 0 && (
        <EmptyState
          variant="centered"
          media={
            <span
              aria-hidden="true"
              className="mb-5 flex h-[46px] w-[46px] items-center justify-center rounded-[12px] bg-brasa-soft text-brasa"
            >
              <Sparkles className="h-5 w-5" />
            </span>
          }
          title={t('ensenadas.vacio')}
          description={t('ensenadas.vacioAyuda')}
        />
      )}

      {!isLoading &&
        !isError &&
        grupos.map((grupo) => (
          <section key={grupo.dominio} className="mt-7 first:mt-6">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink-soft">
              <Globe className="h-4 w-4 flex-none text-muted" aria-hidden="true" />
              {grupo.dominio}
            </h2>
            <ul className="mt-3 space-y-3">
              {grupo.tareas.map((tarea) => (
                <TarjetaDeTarea key={tarea.id} tarea={tarea} />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
