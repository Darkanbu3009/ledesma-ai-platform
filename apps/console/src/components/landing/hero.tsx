import { type JSX, type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Button } from '../ui/button';
import { HeroShowcase } from './hero-showcase';
import { PixelCloud } from './pixel-cloud';

/** Ritmo de escritura del titular en ms por caracter (~30 caracteres en poco mas de 1s). */
const MS_POR_CARACTER = 40;

/** Parpadeo a saltos del cursor del titular (mismo patron step-end que el Configurador). */
const KEYFRAMES_CURSOR = '@keyframes hero-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }';

/** Clases del h1 del titular, compartidas por la variante animada y la estatica. */
const CLASES_TITULO =
  'font-display text-3xl font-bold leading-[1.1] tracking-tight text-foreground min-[420px]:text-4xl sm:text-5xl min-[900px]:text-6xl';

/**
 * Eyebrow propio del hero, tratamiento tipografico estatico y sobrio: solo la frase en
 * la fuente body semibold con tracking cuidado, en color brasa. Sin caja, sin fondo,
 * sin adornos y sin ninguna animacion: es un acento superior quieto que no compite con
 * el h1. Mismo tratamiento en web y movil (solo escala el cuerpo) y en 360px cabe en
 * una linea sin cortarse.
 */
function EyebrowHero({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="font-sans text-sm font-semibold tracking-[0.04em] text-accent sm:text-base">
      {children}
    </p>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window === 'object' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Cursor de escritura del titular: barra vertical brasa que parpadea a saltos (step-end). */
function CursorTitulo(): JSX.Element {
  return (
    <span
      className="inline-block h-[0.9em] w-[3px] align-[-0.05em] bg-accent [animation:hero-blink_0.9s_step-end_infinite]"
      aria-hidden="true"
    />
  );
}

/** Progreso de escritura: `source` ata el conteo a la frase del idioma activo. */
interface EstadoEscritura {
  source: string;
  count: number;
}

/**
 * Titular del hero con efecto typewriter, patron replicado del chat del Configurador
 * (ChatDemoConfigurador.tsx):
 *
 *  - La frase sale de i18n (landing.hero.titulo) y se escribe caracter por caracter con un
 *    cursor parpadeante que sigue parpadeando de forma sutil al terminar. Al cambiar de
 *    idioma el effect se reinicia limpio y reescribe la frase del idioma activo.
 *  - Cero layout shift: un span fantasma invisible con la frase completa reserva el tamano
 *    final del h1 desde el primer frame y el texto se escribe en un span superpuesto.
 *  - Accesibilidad: la frase completa esta en un span sr-only desde el inicio; la capa
 *    animada es decorativa (aria-hidden).
 *  - Movimiento reducido (prefers-reduced-motion: reduce): titular completo estatico,
 *    sin motor, sin timers y sin cursor.
 *  - Cleanup: esperas cancelables; el cleanup marca `cancelled` y limpia el timer
 *    pendiente al desmontar o al cambiar de idioma. El estado solo se actualiza dentro
 *    del callback del timer, nunca en el cuerpo sincrono del effect.
 */
function TituloTypewriter(): JSX.Element {
  const { t } = useTranslation();
  // Se calcula una vez al montar: define si animamos o mostramos el titular estatico.
  const [reduceMotion] = useState(prefersReducedMotion);
  const [typed, setTyped] = useState<EstadoEscritura>({ source: '', count: 0 });
  const texto = t('landing.hero.titulo');

  useEffect(() => {
    if (reduceMotion) return;

    let cancelled = false;
    let timer: number | null = null;

    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        timer = window.setTimeout(() => {
          timer = null;
          resolve();
        }, ms);
      });

    const run = async (): Promise<void> => {
      for (let length = 1; length <= texto.length; length += 1) {
        await sleep(MS_POR_CARACTER);
        if (cancelled) return;
        setTyped({ source: texto, count: length });
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (typeof timer === 'number') window.clearTimeout(timer);
    };
  }, [reduceMotion, texto]);

  if (reduceMotion) {
    return <h1 className={CLASES_TITULO}>{texto}</h1>;
  }

  // El progreso solo aplica si pertenece a la frase actual: al cambiar de idioma se parte
  // de cero sin necesidad de resetear estado de forma sincrona en el effect.
  const visible = typed.source === texto ? texto.slice(0, typed.count) : '';

  return (
    <h1 className={CLASES_TITULO}>
      <span className="sr-only">{texto}</span>
      <span aria-hidden="true" className="relative block">
        <style>{KEYFRAMES_CURSOR}</style>
        <span className="invisible whitespace-pre-wrap">{texto}</span>
        <span className="absolute inset-0 whitespace-pre-wrap">
          {visible}
          <CursorTitulo />
        </span>
      </span>
    </h1>
  );
}

/**
 * Hero de la landing: a la izquierda el mensaje y los CTAs; a la derecha el showcase
 * (tarjeta de sistemas conectados + lineas + carta giratoria del modelo). En ~900px
 * pasa a una columna.
 *
 * El hero es transparente y se apoya sobre el fondo solido de marca del wrapper de la
 * landing.
 */
export function Hero(): JSX.Element {
  const { t } = useTranslation();

  return (
    <section className="relative isolate overflow-hidden">
      <PixelCloud />
      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:gap-12 sm:px-6 sm:py-20 min-[900px]:grid-cols-2 min-[900px]:py-28">
        <div>
          <div className="mb-5">
            <EyebrowHero>{t('landing.hero.eyebrow')}</EyebrowHero>
          </div>
          <TituloTypewriter />
          <p className="mt-5 max-w-xl text-base leading-relaxed text-foreground-secondary sm:mt-6 sm:text-lg sm:leading-relaxed">
            {t('landing.hero.descripcion')}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:mt-9 sm:flex-row sm:items-center">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link to="/crear-cuenta">
                {t('landing.comun.crearCuenta')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
              <a href="#integracion">{t('landing.comun.verComoFunciona')}</a>
            </Button>
          </div>
        </div>

        <div className="w-full">
          <HeroShowcase />
        </div>
      </div>
    </section>
  );
}
