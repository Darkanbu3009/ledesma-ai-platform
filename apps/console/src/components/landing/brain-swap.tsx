import { type CSSProperties, type JSX, type RefObject } from 'react';
import { Cpu, ArrowRightLeft } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Proveedor de modelo que cicla el cerebro del hero. Cada proveedor define su color de
 * acento de marca; ese acento se aplica a traves de la custom property `--panel-accent`
 * (definida por el contenedor padre, comun a esta carta y al SVG de lineas) y recorre
 * todo el panel a la vez (icono, recuadro, etiqueta, chip activo y nombre grande).
 */
export interface ModelProvider {
  id: string;
  label: string;
  accent: string;
}

interface BrainSwapProps {
  /** Proveedores a mostrar como chips (orden del mockup: Claude, ChatGPT, Open source). */
  providers: readonly ModelProvider[];
  /** Indice del proveedor activo. */
  active: number;
  /** Ref a la tarjeta que rota: el padre la usa para orquestar el giro 3D. */
  cardRef: RefObject<HTMLDivElement | null>;
  /** Cambia el modelo al pulsar un chip (el giro lo aplica el padre via su `swapTo`). */
  onSelect: (index: number) => void;
}

/**
 * Estilos derivados del acento activo. Todos referencian la custom property
 * `--panel-accent` (definida en la raiz del contenedor padre), de modo que basta cambiar
 * esa variable para que la carta entera adopte el color del proveedor activo. El
 * fondo/borde/glow se derivan con `color-mix` en baja opacidad.
 */
const accentTextStyle: CSSProperties = { color: 'var(--panel-accent)' };

const boxStyle: CSSProperties = {
  borderColor: 'color-mix(in srgb, var(--panel-accent) 40%, transparent)',
  backgroundColor: 'color-mix(in srgb, var(--panel-accent) 10%, transparent)'
};

const softBgStyle: CSSProperties = {
  backgroundColor: 'color-mix(in srgb, var(--panel-accent) 10%, transparent)'
};

const glowStyle: CSSProperties = {
  background:
    'radial-gradient(circle, color-mix(in srgb, var(--panel-accent) 16%, transparent), transparent 70%)'
};

const activeChipStyle: CSSProperties = {
  borderColor: 'var(--panel-accent)',
  backgroundColor: 'color-mix(in srgb, var(--panel-accent) 10%, transparent)',
  color: 'var(--panel-accent)'
};

/**
 * BrainSwap: la carta giratoria del modelo (elemento signature del hero). Muestra el
 * proveedor activo (icono central tipo chip con glow, nombre grande en su color y
 * subtitulo) y tres chips (Claude / ChatGPT / Open source), tinendo todo con el acento
 * del proveedor activo (transicion suave de ~0.5s al cambiar).
 *
 * Es presentacional: el estado activo, el ciclado por timer y el giro 3D viven en el
 * contenedor padre (que tambien comparte el acento con el SVG de lineas via
 * `--panel-accent`). El padre pasa `cardRef` para rotar esta tarjeta sobre su eje Y, y
 * el intercambio de modelo/color/chip ocurre en el punto medio del giro (de perfil,
 * invisible). Un wrapper aporta la perspectiva y la tarjeta es el elemento que rota.
 *
 * Accesibilidad: los chips son botones (foco visible por teclado) que cambian el modelo;
 * la tarjeta lleva un aria-label que describe que el cerebro es intercambiable.
 */
export function BrainSwap({ providers, active, cardRef, onSelect }: BrainSwapProps): JSX.Element {
  const activeProvider = providers[active] ?? providers[0];
  const activeLabel = activeProvider?.label ?? '';

  return (
    // Wrapper de perspectiva: la tarjeta interior es la que rota sobre su eje Y.
    <div className="h-full w-full [perspective:1500px]">
      <div
        ref={cardRef}
        className="relative isolate flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-background-secondary p-8 shadow-md"
        aria-label={`Modelo intercambiable: el modelo de IA cambia entre Claude, ChatGPT y modelos open source sin rehacer el agente. Modelo activo: ${activeLabel}.`}
      >
        {/* Glow radial sutil detras del cerebro, tenido con el acento activo */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-16 -z-10 h-56 w-56 -translate-x-1/2 rounded-full blur-2xl"
          style={glowStyle}
        />

        {/* Encabezado: eyebrow a la izquierda y "Intercambiable" a la derecha, ambos en una
            sola linea y centrados verticalmente. La carta es angosta, asi que el eyebrow usa
            un cuerpo y un tracking algo menores que el resto de eyebrows para que ambos lados
            quepan sin partirse ni superponerse incluso en el ancho minimo de la carta. */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-jetbrains text-[0.5625rem] uppercase tracking-[0.06em] text-foreground-secondary whitespace-nowrap">
            Modelo activo
          </span>
          <span
            className="inline-flex items-center gap-1 font-jetbrains text-[0.5625rem] uppercase tracking-[0.06em] whitespace-nowrap transition-colors duration-500"
            style={accentTextStyle}
          >
            <ArrowRightLeft className="h-3 w-3" aria-hidden="true" />
            Intercambiable
          </span>
        </div>

        {/* Cerebro central */}
        <div className="mt-8 flex flex-1 flex-col items-center justify-center">
          <div
            className="relative flex h-24 w-24 items-center justify-center rounded-2xl border transition-colors duration-500"
            style={boxStyle}
          >
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-2xl transition-colors duration-500 motion-safe:animate-pulse"
              style={softBgStyle}
            />
            <Cpu
              className="relative h-10 w-10 transition-colors duration-500"
              style={accentTextStyle}
              aria-hidden="true"
            />
          </div>
          <p
            className="mt-5 text-center font-display text-2xl font-semibold transition-colors duration-500"
            style={accentTextStyle}
          >
            {activeLabel}
          </p>
          <p className="mt-1 text-center text-sm text-foreground-secondary">
            Cambia el modelo que mueve al agente, sin rehacer nada.
          </p>
        </div>

        {/* Chips de proveedor: clic para cambiar de modelo; el activo se resalta con su color.
            Apilados en una sola columna (grid de 1 columna, repeat(1, 1fr)) con el mismo gap:
            los tres ocupan el ancho de la carta y tienen el MISMO ancho y la misma altura (no
            salta al cambiar de modelo). Al ir a lo ancho caben grandes y legibles, con texto
            centrado y en una sola linea (whitespace-nowrap), incluso "Open source". */}
        <div className="mt-8 grid grid-cols-1 gap-2">
          {providers.map((provider, index) => {
            const isActive = index === active;
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => onSelect(index)}
                aria-pressed={isActive}
                aria-label={`Cambiar modelo a ${provider.label}`}
                className={cn(
                  'flex items-center justify-center whitespace-nowrap rounded-lg border px-4 py-3 font-jetbrains text-sm font-medium transition-colors duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background-secondary',
                  !isActive && 'border-border bg-background text-foreground-secondary hover:text-foreground'
                )}
                style={isActive ? activeChipStyle : undefined}
              >
                {provider.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
