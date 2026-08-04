import { useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Lleva la pagina al tope en cada navegacion del router. Sin esto, la consola y la landing son la
 * MISMA SPA (ver App.tsx: `/` es la landing publica y el resto la consola), asi que al cambiar de
 * ruta el documento conserva el scroll de la vista anterior: cerrar sesion desde /actividad
 * (navigate('/', { replace: true })) aterrizaba la landing a media pagina en vez del hero.
 *
 * El elemento que scrollea es el DOCUMENTO en ambas vistas -- ni el layout de la consola
 * (AppLayout) ni la landing declaran un contenedor con overflow propio; el sidebar es un item flex
 * del mismo flujo, no un panel fijo con scroll interno. Por eso el reset es `window.scrollTo`.
 *
 * Se excluyen dos casos A PROPOSITO:
 * - POP (atras/adelante del navegador, y la carga inicial): el navegador restaura la posicion
 *   previa por su cuenta (history.scrollRestoration sigue en 'auto'), que es lo esperado.
 * - Rutas con ancla (#seccion): el destino es el ancla, no el tope. Los enlaces de la landing
 *   (#integracion, ...) son anchors nativos y el navegador ya salta a la seccion.
 *
 * Corre en useLayoutEffect (antes del paint) para que no se vea la posicion vieja.
 */
export function useScrollAlTopeEnNavegacion(): void {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useLayoutEffect(() => {
    if (navigationType === 'POP') return;
    if (hash !== '') return;
    window.scrollTo(0, 0);
  }, [pathname, hash, navigationType]);
}
