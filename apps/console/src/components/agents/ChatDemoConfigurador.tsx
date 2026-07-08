import { type JSX, type ReactNode, useEffect, useState } from 'react';

/**
 * Mini-conversacion ANIMADA de la tarjeta Configurador del estado vacio de Agentes. Es
 * logica de presentacion autocontenida: guion hardcodeado, estado local de animacion y
 * cero datos externos (sin props, sin fetching, sin contexto global).
 *
 *  - Cada burbuja entra con fade + translateY (keyframe `cdc-pop`, via `motion-safe`).
 *  - Los mensajes del usuario se escriben con typewriter directo; los del Configurador
 *    muestran antes un indicador "···" y luego el typewriter.
 *  - Al terminar el guion: pausa, fade-out del contenedor y el bucle reinicia.
 *  - Movimiento reducido (`prefers-reduced-motion: reduce`): se renderizan las 4 burbujas
 *    estaticas completas, sin motor ni timers.
 *  - Cero layout shift: un duplicado invisible de la conversacion completa reserva el alto
 *    real de las 4 burbujas a cualquier ancho, y la capa animada se superpone encima; la
 *    tarjeta (y su CTA) no cambian de tamano durante el ciclo.
 *  - El contenedor es decorativo (`aria-hidden`); el contenido informativo de la tarjeta
 *    sigue siendo titulo + descripcion + CTA.
 */

type Role = 'user' | 'config';

/** Guion fijo de la demo (no viene de API). */
const SCRIPT: readonly { role: Role; text: string }[] = [
  {
    role: 'user',
    text: 'Quiero un agente que revise las facturas que llegan a mi correo y las registre en mi sistema',
  },
  {
    role: 'config',
    text: 'Entendido. ¿Las facturas llegan como PDF adjunto o como enlace? Con eso armo la extracción…',
  },
  { role: 'user', text: 'Como PDF adjunto' },
  {
    role: 'config',
    text: 'Perfecto. Agente listo: lee el PDF, extrae proveedor, monto y fecha, y lo registra vía HTTP. ¿Lo probamos?',
  },
];

// azul de la demo de chat (landing): mismo hex que las burbujas de usuario del widget
// animado de la seccion de integracion (integration-chat-widget, agente Sales Analysis).
// Es un color de la demo de chat, NO un acento de la consola: no usarlo fuera de aqui.
const AZUL_DEMO_CHAT = '#2D6FB3';

/** Tiempos de la animacion (en ms, salvo perChar que es ms por caracter). */
const TIMING = {
  perChar: 14,
  dots: 700,
  betweenMessages: 650,
  beforeRestart: 3200,
  fadeOut: 400,
} as const;

/** Entrada de burbuja: fade + translateY(6px -> 0). Solo con `motion-safe`. */
const KEYFRAMES =
  '@keyframes cdc-pop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Burbuja de la mini-conversacion: azul solido para el usuario, greige para el Configurador. */
function Burbuja({ role, children }: { role: Role; children: ReactNode }): JSX.Element {
  const base =
    'max-w-[85%] px-[13px] py-[9px] text-[12.5px] leading-[1.45] motion-safe:[animation:cdc-pop_0.3s_ease_both]';
  if (role === 'user') {
    return (
      <p
        className={`${base} self-end rounded-[12px_12px_3px_12px] text-white`}
        style={{ backgroundColor: AZUL_DEMO_CHAT }}
      >
        {children}
      </p>
    );
  }
  return (
    <p className={`${base} self-start rounded-[12px_12px_12px_3px] bg-[#F1EFE8] text-[#444441]`}>
      {children}
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
}

export function ChatDemoConfigurador(): JSX.Element {
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

    const typeMessage = async (index: number, text: string): Promise<void> => {
      for (let length = 1; length <= text.length; length += 1) {
        await sleep(TIMING.perChar);
        if (cancelled) return;
        const shown = text.slice(0, length);
        setBubbles((prev) =>
          prev.map((bubble) =>
            bubble.index === index ? { ...bubble, text: shown, dots: false } : bubble
          )
        );
      }
    };

    const run = async (): Promise<void> => {
      while (!cancelled) {
        for (let index = 0; index < SCRIPT.length; index += 1) {
          const message = SCRIPT[index];
          if (!message) break;
          setBubbles((prev) => [
            ...prev,
            { index, role: message.role, text: '', dots: message.role === 'config' },
          ]);
          if (message.role === 'config') {
            await sleep(TIMING.dots);
            if (cancelled) return;
          }
          await typeMessage(index, message.text);
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

    void run();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [reduceMotion]);

  // Movimiento reducido: la conversacion completa, estatica y sin motor.
  if (reduceMotion) {
    return (
      <div className="mt-4 flex flex-col gap-2" aria-hidden="true">
        {SCRIPT.map((message, index) => (
          <Burbuja key={index} role={message.role}>
            {message.text}
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
            {message.text}
          </p>
        ))}
      </div>
      <div
        className={`absolute inset-0 flex flex-col gap-2 transition-opacity duration-[400ms] ${
          fading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {bubbles.map((bubble) => (
          <Burbuja key={bubble.index} role={bubble.role}>
            {bubble.dots ? (
              <span className="tracking-[0.25em] text-[#B4B2A9]">···</span>
            ) : (
              bubble.text || ' '
            )}
          </Burbuja>
        ))}
      </div>
    </div>
  );
}
