import { type CSSProperties, type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { BrainSwap, type ModelProvider } from './brain-swap';
import { PixelDataFlow } from './pixel-data-flow';

/**
 * Proveedores de modelo (orden del mockup: Claude, ChatGPT y "Open source"). Cada uno
 * define su color de acento de marca, ya ajustado para el tema CLARO de la landing
 * (fondo hueso): los acentos deben verse y leerse bien sobre superficies claras.
 *  - Claude: arcilla/brasa un poco mas profunda que la de marca para contrastar.
 *  - ChatGPT: monocromatico (la marca de OpenAI es blanco y negro). Sobre fondo claro
 *    su acento es un casi-negro calido (antes era blanco #ECEBE7, que desaparecia).
 *  - Open source: verde de hoja mas profundo, legible sobre crema.
 */
const PROVIDERS: readonly ModelProvider[] = [
  { id: 'claude', label: 'Claude', accent: '#C2613B' },
  { id: 'chatgpt', label: 'ChatGPT', accent: '#26241F' },
  { id: 'compatible', label: 'Open source', accent: '#4E8B49' }
];

const CYCLE_MS = 2600;

/**
 * Duraciones del giro 3D que envuelve cada cambio de modelo (mismo timing que ya estaba
 * en produccion). La tarjeta gira sobre su eje Y: sale girando hasta el perfil (FASE OUT)
 * y, ya invisible, se intercambia el modelo y vuelve de frente desde el perfil opuesto
 * (FASE IN). El total ronda el medio segundo.
 */
const FLIP_OUT_MS = 240;
const FLIP_IN_MS = 260;

/**
 * Sistemas conectados de la tarjeta izquierda. Las rutas apuntan a los logos ya cargados
 * en `frontend/public/` y se respetan tal cual (mayusculas incluidas). "Power BI" lleva
 * un espacio en el nombre del archivo, por eso va codificado (%20).
 */
const SYSTEMS = [
  { src: '/Oracle.png', name: 'Oracle', sub: 'ERP' },
  { src: '/SAP.png', name: 'SAP', sub: 'S/4HANA' },
  { src: '/Salesforce.png', name: 'Salesforce', sub: 'CRM' },
  { src: '/Microsoft.png', name: 'Microsoft 365', sub: 'Email & Docs' },
  { src: '/Power%20BI.png', name: 'Power BI', sub: 'Analytics' }
] as const;

/**
 * Geometria de las lineas conectoras (SVG en el carril central, viewBox 0..100 con
 * `preserveAspectRatio="none"`). La X es % del ancho del carril y la Y es % del alto del
 * cuerpo de filas. Cada linea arranca en su propia altura (10/30/50/70/90, las cinco
 * filas con `flex-1`) en el borde izquierdo del carril (borde derecho de la tarjeta de
 * sistemas, por fuera del texto) y converge en un nodo unico cerca de la carta del
 * modelo. Los puntos de control tiran en horizontal para que las curvas se abran y no se
 * amontonen.
 */
const ROWS_Y = [10, 30, 50, 70, 90];
const NODE_X = 82;
const NODE_Y = 50;
const CTRL_X = NODE_X / 2;

/**
 * Keyframe del flujo de las pistas punteadas. Se inyecta una sola vez; la animacion se
 * aplica con la variante `motion-safe` de Tailwind, asi que con
 * `prefers-reduced-motion: reduce` las lineas quedan estaticas.
 */
const FLOW_KEYFRAME = '@keyframes hero-systems-flow { to { stroke-dashoffset: -18; } }';

/** Color y transicion de las lineas/nodo: heredan el acento activo via `--panel-accent`. */
const lineStyle: CSSProperties = { color: 'var(--panel-accent)', transition: 'color 500ms' };

const nodeStyle: CSSProperties = {
  backgroundColor: 'var(--panel-accent)',
  boxShadow: '0 0 10px 1px color-mix(in srgb, var(--panel-accent) 55%, transparent)',
  transition: 'background-color 500ms, box-shadow 500ms'
};

/** Tarjeta "Tus sistemas": cinco filas (logo + nombre + subtitulo + estado). */
function SystemsCard(): JSX.Element {
  return (
    <div className="flex w-full flex-col rounded-2xl border border-border bg-background-secondary p-3 shadow-md min-[1100px]:w-[180px] min-[1100px]:flex-shrink-0">
      <div className="flex h-6 items-center px-1">
        <span className="font-jetbrains text-[0.7rem] uppercase tracking-[0.18em] text-foreground-secondary">
          Tus sistemas
        </span>
      </div>
      <ul className="flex flex-1 flex-col" role="list">
        {SYSTEMS.map((system) => (
          <li key={system.name} className="flex flex-1 items-center gap-2.5 px-1 py-2">
            {/* El recuadro del logo se mantiene OSCURO aunque la landing sea clara:
                los PNG (Oracle, SAP, Salesforce, Copilot, Power BI) estan pensados
                para fondo oscuro y algunos (Power BI amarillo, el centro claro de
                Copilot) pierden contraste sobre crema. Un chip oscuro uniforme los
                deja todos legibles y se ve intencional. */}
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#26241F]">
              <img
                src={system.src}
                alt={`Logo de ${system.name}`}
                className="h-[22px] w-[22px] object-contain"
                loading="lazy"
                decoding="async"
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[0.8rem] font-semibold leading-tight text-foreground">
                {system.name}
              </span>
              <span className="block text-[0.7rem] text-foreground-secondary">
                {system.sub}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * HeroShowcase: lado derecho del hero. A la izquierda la tarjeta "Tus sistemas"; a la
 * derecha la carta giratoria del modelo (`BrainSwap`); en medio, un carril con las lineas
 * conectoras que van de los sistemas hacia la carta y convergen en un nodo.
 *
 * Este contenedor padre es el origen comun del acento: define `--panel-accent` en su raiz
 * y lo comparten la carta del modelo y el SVG de lineas/nodo. Tambien orquesta el cambio
 * de modelo (por timer cada ~2600ms y por clic en un chip), envolviendolo en el giro 3D de
 * la carta e intercambiando contenido/color en el punto medio (de perfil, invisible).
 *
 * Movimiento reducido: el cambio no gira (fundido simple, misma cadencia) y las lineas no
 * fluyen. En pantallas chicas (< 1100px) las dos tarjetas se apilan y las lineas se ocultan.
 */
export function HeroShowcase(): JSX.Element {
  const [active, setActive] = useState(0);

  // Refs para orquestar el giro de forma imperativa, sin re-renderizar en cada fase.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(0); // espejo del indice activo, para leerlo desde el timer
  const flippingRef = useRef(false); // flag de "ocupado": evita que un giro se solape con otro
  const timersRef = useRef<number[]>([]); // timeouts del giro en curso, para limpiarlos al desmontar

  /**
   * Unica via por la que cambia el modelo activo (timer y clic). Envuelve el cambio con el
   * giro 3D y hace el intercambio en el punto medio, con la tarjeta de perfil (invisible),
   * para ocultar el salto. Con `prefers-reduced-motion: reduce` no gira: cambio directo.
   */
  const swapTo = useCallback((next: number): void => {
    if (flippingRef.current) return; // ya hay un giro en curso: se ignora hasta terminar

    const card = cardRef.current;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Sin tarjeta montada o con movimiento reducido: cambio simple, sin giro 3D.
    if (!card || reduceMotion) {
      activeRef.current = next;
      setActive(next);
      return;
    }

    flippingRef.current = true;
    activeRef.current = next;
    timersRef.current = [];

    // FASE OUT: de frente (0deg) a perfil (90deg), desvaneciendose.
    card.style.transition = `transform ${FLIP_OUT_MS}ms ease-in, opacity ${FLIP_OUT_MS}ms ease-in`;
    card.style.transform = 'rotateY(90deg)';
    card.style.opacity = '0';

    const outTimer = window.setTimeout(() => {
      // PUNTO MEDIO (de perfil, invisible): se intercambia el modelo, el color y el chip.
      setActive(next);

      // Salto instantaneo al perfil opuesto, sin transicion y forzando un reflow.
      card.style.transition = 'none';
      card.style.transform = 'rotateY(-90deg)';
      void card.offsetWidth; // fuerza el reflow para fijar ese estado sin animarlo

      // FASE IN: del perfil opuesto (-90deg) de vuelta al frente (0deg), reapareciendo.
      card.style.transition = `transform ${FLIP_IN_MS}ms ease-out, opacity ${FLIP_IN_MS}ms ease-out`;
      card.style.transform = 'rotateY(0deg)';
      card.style.opacity = '1';

      const inTimer = window.setTimeout(() => {
        flippingRef.current = false;
      }, FLIP_IN_MS);
      timersRef.current.push(inTimer);
    }, FLIP_OUT_MS);
    timersRef.current.push(outTimer);
  }, []);

  useEffect(() => {
    // El ciclado conserva su cadencia y su orden; solo se envuelve con el giro.
    const id = window.setInterval(() => {
      swapTo((activeRef.current + 1) % PROVIDERS.length);
    }, CYCLE_MS);

    return () => {
      window.clearInterval(id);
      // Cancela cualquier fase del giro pendiente al desmontar.
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
    };
  }, [swapTo]);

  // Clic en un chip: cambia a ese modelo (ignora si ya es el activo) por la misma via.
  const handleSelect = useCallback(
    (index: number): void => {
      if (index !== activeRef.current) swapTo(index);
    },
    [swapTo]
  );

  const activeProvider = PROVIDERS[active] ?? PROVIDERS[0];
  const activeAccent = activeProvider?.accent ?? PROVIDERS[0]?.accent;

  return (
    <div
      className="relative flex w-full flex-col gap-4 min-[1100px]:flex-row min-[1100px]:items-stretch min-[1100px]:gap-0"
      style={{ '--panel-accent': activeAccent } as CSSProperties}
    >
      <style>{FLOW_KEYFRAME}</style>

      <SystemsCard />

      {/* Carril central con las lineas conectoras (solo en escritorio, donde hay sitio). */}
      <div className="relative hidden w-20 flex-shrink-0 min-[1100px]:block" aria-hidden="true">
        {/* La banda se alinea con el cuerpo de filas de la tarjeta de sistemas (deja fuera
            el encabezado y los paddings), para que cada linea nazca a la altura de su fila. */}
        <div className="absolute inset-x-0 bottom-3 top-9">
          <svg
            className="h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            fill="none"
            style={lineStyle}
          >
            {ROWS_Y.map((y) => (
              <path
                key={y}
                d={`M 0 ${y} C ${CTRL_X} ${y}, ${CTRL_X} ${NODE_Y}, ${NODE_X} ${NODE_Y}`}
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeDasharray="4 5"
                vectorEffect="non-scaling-stroke"
                className="motion-safe:[animation:hero-systems-flow_1.1s_linear_infinite]"
              />
            ))}
            <path
              d={`M ${NODE_X} ${NODE_Y} L 100 ${NODE_Y}`}
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeDasharray="4 5"
              vectorEffect="non-scaling-stroke"
              className="motion-safe:[animation:hero-systems-flow_1.1s_linear_infinite]"
            />
          </svg>
          {/* Nodo de convergencia, tenido con el acento activo */}
          <span
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full motion-safe:animate-pulse"
            style={{ ...nodeStyle, left: `${NODE_X}%`, top: `${NODE_Y}%` }}
          />
        </div>
      </div>

      {/* Carta giratoria del modelo */}
      <div className="w-full min-w-0 min-[1100px]:flex-1">
        <BrainSwap providers={PROVIDERS} active={active} cardRef={cardRef} onSelect={handleSelect} />
      </div>

      <PixelDataFlow accent={activeAccent} />
    </div>
  );
}
