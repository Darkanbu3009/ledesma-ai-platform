import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';

/**
 * PIE DE UNA LISTA CON SCROLL INFINITO: el centinela que observa useInfiniteScroll mas el unico
 * feedback visible del patron. Es el reemplazo del boton "cargar mas" y esta pensado para cualquier
 * lista paginada de la consola (hoy /actividad; el mismo pie sirve para /admin y otras listas).
 *
 * Tres estados, todos discretos (nada de spinners grandes ni saltos de layout):
 *  - cargando la pagina siguiente: una linea con el spinner chico, anunciada con role="status";
 *  - fallo de una pagina: aviso breve con Reintentar (el unico boton que sobrevive al patron). La
 *    lista ya cargada queda intacta arriba;
 *  - no hay mas resultados: cierre de fin de lista, y el observador ya quedo desconectado.
 */
export function InfiniteListFooter({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  hasError = false,
  enabled = true,
  className = 'pt-1',
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  /** La ultima pagina fallo: se ofrece Reintentar en lugar del disparo automatico. */
  hasError?: boolean;
  /** Apaga el scroll infinito (lista vacia o todavia en su carga inicial). */
  enabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { sentinelRef } = useInfiniteScroll<HTMLDivElement>({
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    hasError,
    enabled,
  });

  return (
    <div className={cn('flex flex-col items-center', className)}>
      {/* Centinela: sin alto propio ni contenido, solo la marca de "aca termina la lista". */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

      {hasError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 py-3 text-[13px] text-muted"
        >
          <span className="inline-flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4 text-brasa" />
            {t('ui.scrollInfinito.error')}
          </span>
          <button
            type="button"
            onClick={fetchNextPage}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-muted transition hover:border-ink-soft hover:text-ink"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('ui.acciones.reintentar')}
          </button>
        </div>
      ) : isFetchingNextPage ? (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 py-3 text-[12px] text-muted-soft"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('ui.scrollInfinito.cargando')}
        </span>
      ) : (
        enabled &&
        !hasNextPage && (
          <span className="py-3 text-[12px] text-muted-soft">{t('ui.scrollInfinito.finDeLista')}</span>
        )
      )}
    </div>
  );
}
