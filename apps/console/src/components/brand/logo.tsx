import { type JSX } from 'react';

interface LogoProps {
  /**
   * Clases para controlar el tamano (alto). El SVG escala manteniendo la
   * proporcion via viewBox, asi que normalmente solo se ajusta el alto.
   */
  className?: string;
  /**
   * Recorta el margen interno del lienzo para que la tinta llene el alto
   * dado por className (la consola lo usa en el sidebar y el aviso). Sin
   * esta prop se conserva el lienzo original con margen, que es del que
   * dependen los tamanos de la landing (h-12/h-14 en el nav, h-16 en el footer).
   */
  tight?: boolean;
}

/**
 * Logo horizontal de Ledesma AI Labs en SVG (reemplaza al PNG).
 *
 * Reproduce fielmente el diseno actual:
 *  - Icono "L": barra vertical alta y angosta + pie horizontal mas ancho, ambos
 *    como <rect> (esquinas rectas).
 *  - Cuadrito de acento en naranja brasa (#FF5722, el mismo token "accent" de
 *    la app), arriba y a la derecha de la barra vertical, con un pequeno gap.
 *  - "Ledesma", peso regular, centrado verticalmente con el icono.
 *  - "AI LABS" debajo, BOLD (700) con tracking amplio.
 *
 * Las partes de "tinta" (icono y textos) usan `currentColor` en vez de un hueso
 * fijo, de modo que el logo se adapta al tema del contexto: hereda el color de
 * texto del contenedor (claro sobre el tema oscuro de la app; oscuro sobre el
 * fondo hueso de la landing). El cuadrito de acento se mantiene en brasa. Antes
 * estas partes eran #F8F8F6 / #FFFFFF fijas, lo que desaparecia sobre fondo claro.
 *
 * El viewBox conserva el mismo margen interno (relacion contenido/lienzo ~45%)
 * que tenia el PNG, de modo que con las mismas clases de alto (h-10/h-12/h-6)
 * se ve del mismo tamano que antes. El texto es real (fuente Geist) para que
 * "AI LABS" sea facil de poner blanco + bold + tracking y se vea nitido a
 * cualquier escala.
 */
export function Logo({ className = 'h-10 w-auto', tight = false }: LogoProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox={tight ? '8 40 250 80' : '0 0 280 160'}
      role="img"
      aria-label="Ledesma AI Labs"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Ledesma AI Labs</title>

      {/* Icono "L": barra vertical (alta y angosta) + pie horizontal */}
      <rect x="10" y="44" width="14" height="72" fill="currentColor" />
      <rect x="10" y="104" width="50" height="12" fill="currentColor" />

      {/* Cuadrito de acento naranja brasa: arriba-derecha de la barra, con gap */}
      <rect x="28" y="44" width="14" height="14" fill="#FF5722" />

      {/* "Ledesma": regular, centrado verticalmente con el icono */}
      <text
        x="102"
        y="93"
        fill="currentColor"
        fontFamily="Geist, system-ui, sans-serif"
        fontSize="36"
        fontWeight="400"
      >
        Ledesma
      </text>

      {/* "AI LABS": BOLD + tracking amplio */}
      <text
        x="102"
        y="114"
        fill="currentColor"
        fontFamily="Geist, system-ui, sans-serif"
        fontSize="14"
        fontWeight="700"
        letterSpacing="3"
      >
        AI LABS
      </text>
    </svg>
  );
}
