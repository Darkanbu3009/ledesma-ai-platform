import {
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { useTranslation } from 'react-i18next';
import { Plane } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Cadencia del giro automatico entre las dos caras de la tarjeta. */
const FLIP_CYCLE_MS = 7000;

/**
 * Sistemas conectados de la cara A (la de empresa). Las rutas apuntan a los logos ya
 * cargados en `public/` y se respetan tal cual (mayusculas incluidas). "Power BI" lleva
 * un espacio en el nombre del archivo, por eso va codificado (%20).
 */
const SYSTEMS = [
  { src: '/Oracle.png', name: 'Oracle', sub: 'ERP' },
  { src: '/SAP.png', name: 'SAP', sub: 'S/4HANA' },
  { src: '/Salesforce.png', name: 'Salesforce', sub: 'CRM' },
  { src: '/Microsoft.png', name: 'Microsoft 365', sub: 'Email & Docs' },
  { src: '/Power%20BI.png', name: 'Power BI', sub: 'Analytics' }
] as const;

/** Icono de una fila de la cara B: logo oficial de marca (asset local) o avion generico. */
type IconoDiaADia =
  | { tipo: 'logo'; src: string; chipClaro?: boolean }
  | { tipo: 'avion' };

interface AppDiaADia {
  id: string;
  /** Nombre de marca fijo (no se traduce) o, en su lugar, clave i18n del nombre. */
  nombre?: string;
  nombreKey?: string;
  subKey: string;
  icono: IconoDiaADia;
}

/**
 * Apps de la cara B (la de personas). Los logos son los oficiales de cada marca, como
 * assets estaticos en `public/` por la misma via y convencion de nombres que los de la
 * cara A (SVG en lugar de PNG porque las marcas los publican vectoriales). La "a" de
 * Amazon es negra, asi que su chip es claro (chipClaro) en vez del oscuro estandar: al
 * ser un color fijo no cambia con el tema y la "a" contrasta en light y dark. El avion
 * es del set generico del proyecto (lucide) por decision de diseno.
 */
const DIA_A_DIA: readonly AppDiaADia[] = [
  {
    id: 'whatsapp',
    nombre: 'WhatsApp',
    subKey: 'landing.heroShowcase.diaADia.mensajes',
    icono: { tipo: 'logo', src: '/WhatsApp.svg' }
  },
  {
    id: 'gmail',
    nombre: 'Gmail',
    subKey: 'landing.heroShowcase.diaADia.correo',
    icono: { tipo: 'logo', src: '/Gmail.svg' }
  },
  {
    id: 'amazon',
    nombre: 'Amazon',
    subKey: 'landing.heroShowcase.diaADia.compras',
    icono: { tipo: 'logo', src: '/Amazon.svg', chipClaro: true }
  },
  {
    id: 'facebook',
    nombre: 'Facebook',
    subKey: 'landing.heroShowcase.diaADia.redesSociales',
    icono: { tipo: 'logo', src: '/Facebook.svg' }
  },
  {
    id: 'vuelos',
    nombreKey: 'landing.heroShowcase.diaADia.vuelos',
    subKey: 'landing.heroShowcase.diaADia.aerolineas',
    icono: { tipo: 'avion' }
  }
];

function prefersReducedMotion(): boolean {
  return (
    typeof window === 'object' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Icono de la cara B con el mismo tratamiento (tamano, ajuste) que los logos de la cara A. */
function IconoApp({ icono, alt }: { icono: IconoDiaADia; alt: string }): JSX.Element {
  if (icono.tipo === 'avion') {
    // Icono generico: sin color de marca, va en el hueso claro para leerse sobre el chip.
    return <Plane className="h-[22px] w-[22px] text-[#ECEBE7]" aria-hidden="true" />;
  }
  return (
    <img
      src={icono.src}
      alt={alt}
      className="h-[22px] w-[22px] object-contain"
      loading="lazy"
      decoding="async"
    />
  );
}

interface CaraProps {
  /** Cara visible ahora mismo; la oculta va aria-hidden e inert (fuera del tab order). */
  visible: boolean;
  /** Con movimiento reducido las caras se cruzan por opacidad, sin rotacion 3D. */
  reduceMotion: boolean;
  /** La cara B va superpuesta y pre-rotada 180 grados para verse de frente al girar. */
  reverso?: boolean;
  children: ReactNode;
}

/**
 * Una cara de la tarjeta. La cara A (relative) define el tamano; la B (absolute inset-0)
 * lo hereda, de modo que la tarjeta nunca cambia de tamano al girar: si la B necesita mas
 * sitio, comprime su espaciado interno (filas flex-1 con py menor), no agranda la caja.
 */
function Cara({ visible, reduceMotion, reverso = false, children }: CaraProps): JSX.Element {
  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        'flex w-full flex-col rounded-2xl border border-border bg-background-secondary p-3 shadow-md',
        reverso ? 'absolute inset-0' : 'relative h-full',
        !reduceMotion && '[backface-visibility:hidden]',
        !reduceMotion && reverso && '[transform:rotateY(180deg)]',
        reduceMotion && 'transition-opacity duration-300',
        reduceMotion && (visible ? 'opacity-100' : 'opacity-0')
      )}
    >
      {children}
    </div>
  );
}

/**
 * Tarjeta "Tus sistemas" de dos caras. La cara A es la tarjeta de sistemas de empresa de
 * siempre (sin cambios); la cara B, "Tu dia a dia", cuenta el lado de personas con apps
 * cotidianas y es la que se ve al cargar. Gira sobre su eje Y con perspectiva (mismo
 * lenguaje 3D que la carta del modelo) alternando caras cada 7s (el primer giro revela
 * "Tus sistemas"); hover o foco pausan el ciclo y clic/tap (o Enter/Espacio) voltea al
 * momento y reinicia la cuenta.
 *
 * Las lineas punteadas del carril central NO viven aqui: son un SVG hermano con geometria
 * fija (ver HeroShowcase), asi que el transform 3D de esta tarjeta no las toca y quedan
 * estables durante el giro. La caja exterior conserva el ancho/alto de la tarjeta
 * original (la cara A define el tamano), por lo que el nacimiento de las lineas tampoco
 * se mueve.
 *
 * Accesibilidad: el contenedor es focusable (role=button) y una region aria-live anuncia
 * la cara visible; la cara oculta va aria-hidden e inert. Con prefers-reduced-motion no
 * hay ciclo automatico y el cambio manual es un crossfade sin rotacion.
 */
export function SystemsFlipCard(): JSX.Element {
  const { t } = useTranslation();
  // Se calcula una vez al montar, como el resto de animaciones del hero.
  const [reduceMotion] = useState(prefersReducedMotion);
  // Arranca en true: la cara B ("Tu dia a dia") es la visible desde el primer render,
  // sin flash de la cara A, porque el contenedor ya nace rotado 180 grados (no hay
  // transicion inicial: el estilo se aplica en el primer pintado). El primer giro
  // automatico revela "Tus sistemas" y de ahi alterna.
  const [flipped, setFlipped] = useState(true);

  const hoverRef = useRef(false);
  const focusRef = useRef(false);
  const intervalRef = useRef<number | null>(null);

  const stopCycle = useCallback((): void => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  /** (Re)arranca la cuenta de 7s desde cero, salvo pausa activa o movimiento reducido. */
  const startCycle = useCallback((): void => {
    stopCycle();
    if (reduceMotion || hoverRef.current || focusRef.current) return;
    intervalRef.current = window.setInterval(() => {
      setFlipped((prev) => !prev);
    }, FLIP_CYCLE_MS);
  }, [reduceMotion, stopCycle]);

  useEffect(() => {
    startCycle();
    return stopCycle;
  }, [startCycle, stopCycle]);

  // Voltea al momento y reinicia el ciclo; si hay pausa (hover/foco), el ciclo queda
  // detenido y se retoma al salir. En movil el tap deja foco en la tarjeta, asi que la
  // pausa por foco dura hasta tocar fuera: el ciclo sigue al soltar el foco.
  const handleFlip = useCallback((): void => {
    setFlipped((prev) => !prev);
    startCycle();
  }, [startCycle]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      handleFlip();
    },
    [handleFlip]
  );

  const pauseByHover = useCallback((): void => {
    hoverRef.current = true;
    stopCycle();
  }, [stopCycle]);

  const resumeFromHover = useCallback((): void => {
    hoverRef.current = false;
    startCycle();
  }, [startCycle]);

  const pauseByFocus = useCallback((): void => {
    focusRef.current = true;
    stopCycle();
  }, [stopCycle]);

  const resumeFromFocus = useCallback((): void => {
    focusRef.current = false;
    startCycle();
  }, [startCycle]);

  return (
    // Wrapper de perspectiva (mismo valor que la carta del modelo): toma el sitio en el
    // layout que ocupaba la tarjeta original y dentro rota el contenedor de dos caras.
    <div className="w-full [perspective:1500px] min-[1100px]:w-[180px] min-[1100px]:flex-shrink-0">
      <div
        role="button"
        tabIndex={0}
        aria-label={t('landing.heroShowcase.diaADia.voltearAria')}
        onClick={handleFlip}
        onKeyDown={handleKeyDown}
        onMouseEnter={pauseByHover}
        onMouseLeave={resumeFromHover}
        onFocus={pauseByFocus}
        onBlur={resumeFromFocus}
        className={cn(
          'relative h-full w-full cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          !reduceMotion && '[transform-style:preserve-3d] transition-transform duration-700'
        )}
        style={!reduceMotion ? { transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' } : undefined}
      >
        {/* Cara A: los sistemas de empresa, exactamente la tarjeta de siempre. */}
        <Cara visible={!flipped} reduceMotion={reduceMotion}>
          <div className="flex h-6 items-center px-1">
            <span className="font-jetbrains text-[0.7rem] uppercase tracking-[0.18em] text-foreground-secondary">
              {t('landing.heroShowcase.tusSistemas')}
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
                    alt={t('landing.heroShowcase.logoAlt', { name: system.name })}
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
        </Cara>

        {/* Cara B: el dia a dia de personas. Misma estructura de filas; el py baja a 1.5
            para hacer sitio a la linea final sin que la tarjeta cambie de tamano. */}
        <Cara visible={flipped} reduceMotion={reduceMotion} reverso>
          <div className="flex h-6 items-center px-1">
            <span className="font-jetbrains text-[0.7rem] uppercase tracking-[0.18em] text-foreground-secondary">
              {t('landing.heroShowcase.diaADia.titulo')}
            </span>
          </div>
          <ul className="flex min-h-0 flex-1 flex-col" role="list">
            {DIA_A_DIA.map((app) => {
              const nombre = app.nombreKey === undefined ? app.nombre : t(app.nombreKey);
              return (
              <li key={app.id} className="flex min-h-0 flex-1 items-center gap-2.5 px-1 py-1.5">
                {/* Mismo mosaico que la cara A (8x8, rounded-lg). El de Amazon es claro
                    para que su "a" negra contraste; como es un color fijo (igual que el
                    #26241F oscuro del resto), no se oscurece en dark mode. */}
                <span
                  className={cn(
                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
                    app.icono.tipo === 'logo' && app.icono.chipClaro === true
                      ? 'bg-[#ECEBE7]'
                      : 'bg-[#26241F]'
                  )}
                >
                  <IconoApp
                    icono={app.icono}
                    alt={t('landing.heroShowcase.logoAlt', { name: nombre })}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[0.8rem] font-semibold leading-tight text-foreground">
                    {nombre}
                  </span>
                  <span className="block text-[0.7rem] text-foreground-secondary">
                    {t(app.subKey)}
                  </span>
                </span>
              </li>
              );
            })}
          </ul>
          <p className="px-1 pt-1 text-[0.65rem] leading-snug text-foreground-secondary">
            {t('landing.heroShowcase.diaADia.masLinea')}
          </p>
        </Cara>

        {/* Anuncia la cara visible a lectores de pantalla al girar (manual o automatico). */}
        <span className="sr-only" aria-live="polite">
          {flipped
            ? t('landing.heroShowcase.diaADia.titulo')
            : t('landing.heroShowcase.tusSistemas')}
        </span>
      </div>
    </div>
  );
}
