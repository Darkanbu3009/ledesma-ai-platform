import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * SCROLL INFINITO REUTILIZABLE para las listas paginadas de la consola (useInfiniteQuery de
 * react-query). Reemplaza el boton "cargar mas": la pagina siguiente se pide sola cuando el
 * usuario se acerca al final de la lista.
 *
 * Se observa un CENTINELA (un elemento vacio al final de la lista) con IntersectionObserver, no
 * con listeners de scroll: el navegador avisa el cruce y no hay trabajo por cada pixel scrolleado.
 *
 * Garantias que da el hook (las tres guardas del patron):
 *  1. NO DUPLICA CARGAS: `cargandoRef` se levanta al pedir una pagina y solo baja en el primer
 *     commit en que ya no hay nada en vuelo. Scrollear rapido puede intersectar el centinela varias
 *     veces; mientras la carga esta en curso ninguna de esas intersecciones pide una pagina nueva.
 *  2. LLENA EL VIEWPORT: la visibilidad del centinela vive en estado, no en un evento suelto. Si al
 *     terminar una pagina el centinela SIGUE visible (pantalla alta cuya primera pagina no llego a
 *     llenarla), el efecto vuelve a correr y pide la siguiente, hasta llenar o agotar la lista.
 *     IntersectionObserver no reemite el cruce por si solo en ese caso: por eso el estado.
 *  3. SE DESCONECTA: sin mas paginas (o con la lista deshabilitada, o tras un fallo) el observador
 *     se desconecta y no se hace ninguna peticion mas. Tras un fallo la siguiente carga la pide el
 *     usuario con Reintentar: el error de una pagina no debe reintentarse en bucle.
 */

/** Anticipacion del disparo: la carga arranca ~350 px antes de que el centinela entre a pantalla. */
export const INFINITE_SCROLL_ROOT_MARGIN = '0px 0px 350px 0px';

export interface UseInfiniteScrollOptions {
  /** Quedan paginas por pedir (hasNextPage de useInfiniteQuery). */
  hasNextPage: boolean;
  /** Hay una pagina en vuelo (isFetchingNextPage de useInfiniteQuery). */
  isFetchingNextPage: boolean;
  /** Pide la pagina siguiente (fetchNextPage de useInfiniteQuery). */
  fetchNextPage: () => void;
  /**
   * La ultima pagina fallo: el observador se apaga y la carga siguiente la pide el usuario con
   * Reintentar (unico boton que sobrevive al scroll infinito).
   */
  hasError?: boolean;
  /** Apaga el scroll infinito (carga inicial, lista vacia, estado de error de la lista entera). */
  enabled?: boolean;
  /** Anticipacion del disparo. Por defecto INFINITE_SCROLL_ROOT_MARGIN. */
  rootMargin?: string;
}

/**
 * Devuelve el ref del centinela a colgar de un elemento vacio al FINAL de la lista. Todo lo demas
 * (indicador de carga, fin de lista, aviso de error) lo pinta quien lo use: ver InfiniteListFooter,
 * que junta centinela y estados en un solo pie de lista.
 */
export function useInfiniteScroll<T extends HTMLElement>({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  hasError = false,
  enabled = true,
  rootMargin = INFINITE_SCROLL_ROOT_MARGIN,
}: UseInfiniteScrollOptions): { sentinelRef: RefObject<T | null> } {
  const sentinelRef = useRef<T | null>(null);
  const [sentinelVisible, setSentinelVisible] = useState(false);
  const cargandoRef = useRef(false);

  // Observar solo tiene sentido con lista habilitada, paginas pendientes y sin un fallo a la espera
  // de reintento. Cualquiera de las tres condiciones que caiga desconecta el observador (guarda 3).
  const activo = enabled && hasNextPage && !hasError;

  useEffect(() => {
    if (!activo) return;
    const el = sentinelRef.current;
    if (el === null || typeof IntersectionObserver === 'undefined') return;
    // Al (re)crear el observador la visibilidad previa ya no vale: el propio observe() reemite el
    // estado real del centinela apenas empieza a observarlo.
    setSentinelVisible(false);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setSentinelVisible(entry.isIntersecting);
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [activo, rootMargin]);

  // DISPARO. Corre en CADA commit a proposito (sin lista de dependencias): la senal que encadena la
  // pagina siguiente es "el centinela sigue visible y ya no hay nada en vuelo", y esa transicion
  // puede llegar en el mismo commit en que entran los datos nuevos, sin que cambie ninguna de las
  // banderas que serviria de dependencia. Las dos guardas viven aca:
  //  - se baja `cargandoRef` recien cuando la carga que disparo este hook termino (guarda 1);
  //  - si el centinela quedo visible, se pide la pagina siguiente (guarda 2, llenar el viewport).
  // No hay bucle posible: cada disparo levanta la bandera y solo un commit nuevo puede bajarla.
  // Al correr en cada commit, `fetchNextPage` es siempre el del render vigente: quien use el hook
  // puede pasar una lambda nueva en cada render sin quedar con un callback viejo.
  useEffect(() => {
    if (cargandoRef.current && !isFetchingNextPage) cargandoRef.current = false;
    if (!activo || !sentinelVisible) return;
    if (isFetchingNextPage || cargandoRef.current) return;
    cargandoRef.current = true;
    fetchNextPage();
  });

  return { sentinelRef };
}

/**
 * Une las paginas de un useInfiniteQuery DEDUPLICANDO por id y conservando el orden de llegada.
 *
 * Hace falta porque la paginacion del historial es POR OFFSET sobre una lista que crece por arriba
 * (las corridas nuevas entran primero): si llega una corrida mientras el usuario lee, la ventana se
 * corre y un mismo job puede caer en dos paginas. Sin dedupe React reventaria con keys repetidas y
 * la tarjeta se veria dos veces.
 */
export function unirPaginasPorId<T extends { id: string }>(
  paginas: readonly (readonly T[])[] | undefined,
): T[] {
  const vistos = new Set<string>();
  const unidos: T[] = [];
  for (const pagina of paginas ?? []) {
    for (const item of pagina) {
      if (vistos.has(item.id)) continue;
      vistos.add(item.id);
      unidos.push(item);
    }
  }
  return unidos;
}
