import { useTranslation } from 'react-i18next';

/**
 * Splash de carga de marca: reemplaza el "Cargando..." de texto plano en los splashes
 * INICIALES de pantalla completa (ProtectedRoute, RegistrationGate, ConsentGate y el
 * loading de RegistrationPage). Solo presentacion: la condicion que decide CUANDO se
 * muestra sigue viviendo en cada gate; este componente solo define QUE se ve.
 *
 * Composicion:
 *  - Isotipo L de la marca dibujado inline (mismas proporciones que el icono del
 *    lockup de components/brand/logo.tsx): barra vertical + pie en ink y el cuadrito
 *    brasa arriba-derecha. Solo el cuadrito pulsa (opacity + scale, keyframes
 *    splash-pulso en tailwind.config); el resto del isotipo es estatico.
 *  - Barra de progreso indeterminada debajo: pista fija con un segmento del 35% que
 *    recorre en bucle (keyframes splash-barra).
 *
 * La animacion es CSS puro (Tailwind animate-*): cero JS de animacion, cero timers,
 * cero estado. Con prefers-reduced-motion el cuadrito queda estatico y la barra se
 * oculta (variantes motion-reduce). Sin texto visible: el contenedor anuncia
 * role="status" + aria-label={t('ui.estado.cargandoAria')} para lectores de pantalla.
 */
export function SplashCarga() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t('ui.estado.cargandoAria')}
      className="flex min-h-screen flex-col items-center justify-center gap-[22px] bg-cream"
    >
      <svg viewBox="0 0 56 64" className="h-16 w-14" aria-hidden="true">
        {/* Barra vertical + pie del L, en ink. */}
        <rect x="0" y="0" width="12" height="64" fill="#1F1E1C" />
        <rect x="0" y="54" width="44" height="10" fill="#1F1E1C" />
        {/* Cuadrito brasa: unico elemento animado (pulso). transform-box: fill-box para
            que origin-center sea el centro del cuadrito y no del SVG. */}
        <rect
          x="16"
          y="0"
          width="12"
          height="12"
          fill="#E5511E"
          className="origin-center animate-splash-pulso [transform-box:fill-box] motion-reduce:animate-none"
        />
      </svg>
      <div className="relative h-[2px] w-[140px] overflow-hidden rounded-[2px] bg-[#E9E7DF] motion-reduce:hidden">
        <div className="absolute inset-y-0 w-[35%] animate-splash-barra rounded-[2px] bg-ink" />
      </div>
    </div>
  );
}
