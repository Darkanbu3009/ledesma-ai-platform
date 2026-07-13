import { type JSX, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Mini-conversacion ANIMADA de la tarjeta Configurador del estado vacio de Agentes. Es
 * logica de presentacion autocontenida: guion hardcodeado, estado local de animacion y
 * cero datos externos (sin props, sin fetching, sin contexto global).
 *
 *  - Cada burbuja entra con un fade corto (keyframe `cdc-fade`, sin transform) YA con su
 *    tamano final: un span fantasma con el texto completo (invisible, pre-wrap) reserva el
 *    ancho y alto desde el primer frame, y el texto se escribe en un span superpuesto.
 *  - La escritura es caracter por caracter con un cursor parpadeante al final del texto;
 *    el cursor desaparece al terminar cada mensaje.
 *  - Los mensajes del usuario escriben tras una pausa breve; los del Configurador muestran
 *    antes un indicador "···" y luego escriben.
 *  - Al terminar el guion: pausa, fade-out del contenedor y el bucle reinicia.
 *  - Movimiento reducido (`prefers-reduced-motion: reduce`): se renderizan las 4 burbujas
 *    estaticas completas, sin motor, sin timers y sin cursor.
 *  - Cero layout shift: un duplicado invisible de la conversacion completa reserva el alto
 *    real de las 4 burbujas a cualquier ancho, y la capa animada se superpone encima; la
 *    tarjeta (y su CTA) no cambian de tamano durante el ciclo.
 *  - El contenedor es decorativo (`aria-hidden`); el contenido informativo de la tarjeta
 *    sigue siendo titulo + descripcion + CTA.
 */

type Role = 'user' | 'config';

/** Guion fijo de la demo (no viene de API): claves de traduccion de cada mensaje. */
const SCRIPT: readonly { role: Role; textKey: string }[] = [
  { role: 'user', textKey: 'configurador.demo.usuario1' },
  { role: 'config', textKey: 'configurador.demo.configurador2' },
  { role: 'user', textKey: 'configurador.demo.usuario3' },
  { role: 'config', textKey: 'configurador.demo.configurador4' },
];

// tinte brasa de la demo de chat: uno de los tres puntos de brasa declarados en esta
// pagina (el brasa solido #E5511E queda solo en el CTA y el icono sparkles de la tarjeta).
// Es un color de la demo de chat, NO un acento de la consola: no usarlo fuera de aqui.
const TINTE_BRASA_DEMO_CHAT = '#FAECE7';

/** Tiempos de la animacion (en ms, salvo perChar que es ms por caracter). */
const TIMING = {
  perChar: 16,
  dots: 700,
  userStart: 150,
  betweenMessages: 650,
  beforeRestart: 3200,
  fadeOut: 400,
} as const;

/**
 * Entrada de burbuja: SOLO opacity (nada de transform ni width/height, la burbuja nace con
 * su tamano final) y parpadeo del cursor de escritura.
 */
const KEYFRAMES =
  '@keyframes cdc-fade { from { opacity: 0; } to { opacity: 1; } }\n' +
  '@keyframes cdc-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Cursor de escritura: barra vertical en currentColor que parpadea a saltos (step-end). */
function Cursor(): JSX.Element {
  return (
    <span
      className="inline-block h-[1em] w-[2px] align-[-2px] bg-current [animation:cdc-blink_0.9s_step-end_infinite]"
      aria-hidden="true"
    />
  );
}

/**
 * Burbuja de la mini-conversacion: tinte brasa para el usuario, greige para el Configurador.
 * `fullText` es el mensaje completo del guion: un span fantasma invisible lo renderiza en
 * flujo normal para fijar el ancho y alto finales de la burbuja desde el primer frame; el
 * contenido visible (children) se escribe encima en un span absoluto cuyo inset iguala el
 * padding de la burbuja (13px / 9px), asi la burbuja nunca cambia de tamano al escribir.
 */
function Burbuja({
  role,
  fullText,
  children,
}: {
  role: Role;
  fullText: string;
  children: ReactNode;
}): JSX.Element {
  const base =
    'relative max-w-[85%] px-[13px] py-[9px] text-[12.5px] leading-[1.45] motion-safe:[animation:cdc-fade_0.22s_ease_both]';
  const tone =
    role === 'user'
      ? 'self-end rounded-[12px_12px_3px_12px] text-[#712B13]'
      : 'self-start rounded-[12px_12px_12px_3px] bg-[#F1EFE8] text-[#444441]';
  return (
    <p
      className={`${base} ${tone}`}
      style={role === 'user' ? { backgroundColor: TINTE_BRASA_DEMO_CHAT } : undefined}
    >
      <span className="invisible whitespace-pre-wrap">{fullText}</span>
      <span className="absolute inset-x-[13px] inset-y-[9px] whitespace-pre-wrap">{children}</span>
    </p>
  );
}

/** Estado de una burbuja en pantalla mientras el motor avanza. */
interface BubbleState {
  index: number;
  role: Role;
  /** Texto ya "escrito" (prefijo del mensaje del guion). */
  text: string;
  /** Indicador "···" del Configurador, antes de empezar a escribir. */
  dots: boolean;
  /** Mensaje completo: al terminar se retira el cursor. */
  done: boolean;
}

export function ChatDemoConfigurador(): JSX.Element {
  const { t } = useTranslation();
  // Se calcula una vez al montar: define si animamos o mostramos las burbujas estaticas.
  const [reduceMotion] = useState(prefersReducedMotion);
  const [bubbles, setBubbles] = useState<BubbleState[]>([]);
  const [fading, setFading] = useState(false);

  // Motor del bucle. Esperas cancelables: el cleanup marca `cancelled` y limpia el timer
  // pendiente, asi ningun timeout queda huerfano al desmontar.
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

    const patchBubble = (index: number, patch: Partial<BubbleState>): void => {
      setBubbles((prev) =>
        prev.map((bubble) => (bubble.index === index ? { ...bubble, ...patch } : bubble))
      );
    };

    const typeMessage = async (index: number, text: string): Promise<void> => {
      for (let length = 1; length <= text.length; length += 1) {
        await sleep(TIMING.perChar);
        if (cancelled) return;
        patchBubble(index, { text: text.slice(0, length) });
      }
      patchBubble(index, { done: true });
    };

    const run = async (): Promise<void> => {
      while (!cancelled) {
        for (let index = 0; index < SCRIPT.length; index += 1) {
          const message = SCRIPT[index];
          if (!message) break;
          setBubbles((prev) => [
            ...prev,
            { index, role: message.role, text: '', dots: message.role === 'config', done: false },
          ]);
          // El Configurador "piensa" (···) antes de escribir; el usuario arranca tras una
          // pausa breve. En ambos casos la burbuja ya esta en pantalla con su tamano final.
          await sleep(message.role === 'config' ? TIMING.dots : TIMING.userStart);
          if (cancelled) return;
          if (message.role === 'config') patchBubble(index, { dots: false });
          await typeMessage(index, t(message.textKey));
          if (cancelled) return;
          await sleep(TIMING.betweenMessages);
          if (cancelled) return;
        }
        await sleep(TIMING.beforeRestart);
        if (cancelled) return;
        setFading(true);
        await sleep(TIMING.fadeOut);
        if (cancelled) return;
        setFading(false);
        setBubbles([]);
      }
    };

    // Si el efecto se relanza (ej. cambio de idioma via `t`), el guion arranca de cero.
    setBubbles([]);
    setFading(false);
    void run();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [reduceMotion, t]);

  // Movimiento reducido: la conversacion completa, estatica y sin motor ni cursor.
  if (reduceMotion) {
    return (
      <div className="mt-4 flex flex-col gap-2" aria-hidden="true">
        {SCRIPT.map((message, index) => (
          <Burbuja key={index} role={message.role} fullText={t(message.textKey)}>
            {t(message.textKey)}
          </Burbuja>
        ))}
      </div>
    );
  }

  return (
    <div className="relative mt-4" aria-hidden="true">
      <style>{KEYFRAMES}</style>
      {/* Duplicado invisible: reserva el alto exacto de las 4 burbujas completas para que
          la tarjeta no cambie de tamano mientras la capa animada escribe encima. */}
      <div className="invisible flex flex-col gap-2">
        {SCRIPT.map((message, index) => (
          <p
            key={index}
            className={`max-w-[85%] px-[13px] py-[9px] text-[12.5px] leading-[1.45] ${
              message.role === 'user' ? 'self-end' : 'self-start'
            }`}
          >
            {t(message.textKey)}
          </p>
        ))}
      </div>
      <div
        className={`absolute inset-0 flex flex-col gap-2 transition-opacity duration-[400ms] ${
          fading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {bubbles.map((bubble) => {
          const messageKey = SCRIPT[bubble.index]?.textKey;
          const fullText = messageKey ? t(messageKey) : '';
          return (
            <Burbuja key={bubble.index} role={bubble.role} fullText={fullText}>
              {bubble.dots ? (
                <span className="tracking-[0.25em] text-[#B4B2A9]">···</span>
              ) : (
                <>
                  {bubble.text}
                  {!bubble.done && <Cursor />}
                </>
              )}
            </Burbuja>
          );
        })}
      </div>
    </div>
  );
}
