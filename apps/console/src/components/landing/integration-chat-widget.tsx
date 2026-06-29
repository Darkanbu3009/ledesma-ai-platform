import { type CSSProperties, type JSX, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  FileCheck,
  Headphones,
  LineChart,
  Send,
  type LucideIcon
} from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Widget de chat ANIMADO de la seccion de integracion. Reemplaza al widget estatico de la
 * derecha: corre una conversacion que avanza sola y, al terminar, CAMBIA de agente en ciclo,
 * tinendo todo el widget con el acento del agente activo. El orden del ciclo es:
 * Sales Analysis (azul) -> Facturacion (verde) -> Operaciones (morado) -> Customer Success
 * (brasa) y vuelve a empezar. Arranca mostrando Sales Analysis.
 *
 * Cada agente trae su guion y, algunos, un artefacto visual propio:
 *  - Sales Analysis: tarjeta de analisis con 3 KPIs y una mini-grafica de barras que crecen.
 *  - Facturacion: tarjeta de validacion de factura (datos extraidos + checklist con un aviso).
 *  - Operaciones: arranca PROACTIVO (sin pregunta previa) y emite una tarjeta de ALERTA.
 *  - Customer Success: solo texto.
 *
 * Convenciones del repo (mismas que el panel del hero):
 *  - El acento se propaga por la custom property `--widget-accent`, definida en la raiz del
 *    widget; los fondos/bordes suaves se derivan con `color-mix` (igual que `--panel-accent`).
 *    El acento de Customer Success REUSA el token de marca del tema claro (`--ll-accent`,
 *    brasa); los de Sales Analysis, Facturacion y Operaciones son colores LOCALES de este
 *    widget (no tocan el tema global).
 *  - Los estados de las tarjetas (ok/aviso/error) usan una paleta LOCAL del mockup (ver
 *    `STATE`), porque el `success` del tema claro es un verde mas profundo pensado para texto.
 *  - Las animaciones (entrada de burbujas, puntos de "escribiendo", crecimiento de las barras)
 *    se aplican con la variante `motion-safe` de Tailwind sobre keyframes inyectados una sola
 *    vez (mismo patron que las pistas punteadas del hero), de modo que con
 *    `prefers-reduced-motion: reduce` no hay movimiento.
 *  - El motor arranca cuando el widget entra al viewport (IntersectionObserver), no al cargar
 *    la pagina, y limpia sus timers al desmontar para no dejar estados huerfanos.
 *
 * Movimiento reducido: no anima ni cicla. Muestra estatica y completa la conversacion de
 * Sales Analysis (con su tarjeta de analisis visible).
 *
 * Altura fija + scroll interno: la conversacion crece y cambia, asi que el widget tiene alto
 * fijo y el cuerpo hace scroll al ultimo mensaje. Asi la seccion no salta de tamano mientras
 * los mensajes entran (sin layout shift) y el bloque de codigo de la izquierda no se ve
 * afectado mas alla de igualar la altura de la fila, como ya hacia.
 */

type AgentKey = 'sales' | 'ap' | 'ops' | 'support';

interface Agent {
  name: string;
  icon: LucideIcon;
  /** Valor para `--widget-accent`: un color CSS completo (no canales RGB sueltos). */
  accent: string;
}

/**
 * Mensaje del guion. El motor inserta el indicador de "escribiendo" antes de cada respuesta
 * de texto o tarjeta del agente, asi que el guion solo declara el contenido. La alerta de
 * Operaciones es la excepcion: entra sin "escribiendo" porque es una salida proactiva.
 */
type ScriptMessage =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'report' }
  | { kind: 'validation' }
  | { kind: 'alert' };

const AGENTS: Record<AgentKey, Agent> = {
  // Sales Analysis: azul LOCAL del widget (no es token de marca; vive solo aqui).
  sales: { name: 'Sales Analysis', icon: LineChart, accent: '#2D6FB3' },
  // Facturacion: verde LOCAL del widget.
  ap: { name: 'Facturación', icon: FileCheck, accent: '#2F855A' },
  // Operaciones: morado LOCAL del widget.
  ops: { name: 'Operaciones', icon: Activity, accent: '#6D4AB8' },
  // Customer Success: reusa el acento de marca del tema claro (brasa).
  support: { name: 'Customer Success', icon: Headphones, accent: 'rgb(var(--ll-accent))' }
};

/** Orden del ciclo: arranca en Sales Analysis y termina en Customer Success, luego repite. */
const AGENT_ORDER: readonly AgentKey[] = ['sales', 'ap', 'ops', 'support'];

const SCRIPTS: Record<AgentKey, readonly ScriptMessage[]> = {
  sales: [
    { kind: 'user', text: 'Dame el análisis de ventas del último trimestre.' },
    { kind: 'report' },
    { kind: 'user', text: '¿Qué explica la caída de octubre?' },
    {
      kind: 'agent',
      text: 'El quiebre de stock en la categoría estrella (12 días sin inventario) y menor tráfico tras la promoción. Sin ese quiebre, octubre habría cerrado en ~$2.1M.'
    },
    { kind: 'user', text: '¿Y la proyección del próximo trimestre?' },
    {
      kind: 'agent',
      text: 'Proyecto $7.4M (intervalo 95%: $6.9M–$7.9M). El mayor riesgo sigue siendo el inventario de la categoría estrella.'
    }
  ],
  ap: [
    { kind: 'user', text: 'Procesa esta factura y valídala.' },
    { kind: 'validation' },
    { kind: 'user', text: '¿El duplicado es real?' },
    {
      kind: 'agent',
      text: 'Sí: mismo proveedor y monto que el folio A-1182 del 03 de junio. Te recomiendo no pagar A-1207 hasta confirmarlo. ¿La marco en revisión?'
    },
    { kind: 'user', text: 'Márcala.' },
    {
      kind: 'agent',
      text: 'Hecho. La factura A-1207 quedó en revisión y notifiqué al responsable de pagos.'
    }
  ],
  ops: [
    { kind: 'agent', text: 'Revisé los pagos de hoy y encontré algo que necesita tu atención.' },
    { kind: 'alert' },
    { kind: 'user', text: '¿Qué recomiendas?' },
    {
      kind: 'agent',
      text: 'Retener el segundo pago (folio A-1207) hasta aclarar con el proveedor. Ya preparé la nota de aclaración. ¿La envío?'
    },
    { kind: 'user', text: 'Sí, adelante.' },
    {
      kind: 'agent',
      text: 'Listo. Retuve el pago y envié la aclaración. Te aviso en cuanto el proveedor responda.'
    }
  ],
  support: [
    { kind: 'user', text: '¿Dónde reviso el estatus de mi pedido?' },
    {
      kind: 'agent',
      text: 'Tu pedido va en camino y llega mañana. Te comparto la guía de rastreo y el detalle de la orden.'
    },
    { kind: 'user', text: '¿Puedo cambiar la dirección de entrega?' },
    {
      kind: 'agent',
      text: 'Claro. Actualicé la dirección a tu nueva sucursal y la paquetería ya lo confirmó.'
    },
    { kind: 'user', text: 'Perfecto, gracias.' },
    { kind: 'agent', text: 'Para eso estoy. ¿Algo más en lo que te pueda ayudar?' }
  ]
};

/**
 * Paleta de estado del widget (ok/aviso/error), LOCAL al componente. El tema claro define
 * `success` como un verde mas profundo (#047857) pensado para texto; aqui usamos los
 * verdes/ambar/rojo del mockup para los indicadores de las tarjetas, sin tocar el tema global.
 */
const STATE = {
  ok: '#3F9D54',
  warn: '#C9852B',
  bad: '#C0492B'
} as const;

/** KPIs de la tarjeta de analisis (delta hacia arriba en verde, hacia abajo en rojo). */
const REPORT_KPIS: readonly { value: string; label: string; delta: string; trend: 'up' | 'down' }[] = [
  { value: '$6.2M', label: 'Ventas totales', delta: '▲ 18% vs Q2', trend: 'up' },
  { value: '$3,840', label: 'Ticket promedio', delta: '▲ 6%', trend: 'up' },
  { value: '3.1%', label: 'Conversión', delta: '▼ 0.4 pts', trend: 'down' }
];

/** Mini-grafica: alto de cada barra en % del area (Jul, Ago, Oct, Nov, Dic). */
const REPORT_BARS: readonly { label: string; height: number }[] = [
  { label: 'Jul', height: 62 },
  { label: 'Ago', height: 48 },
  { label: 'Oct', height: 38 },
  { label: 'Nov', height: 78 },
  { label: 'Dic', height: 100 }
];

/** Datos extraidos de la factura (tarjeta de validacion de Facturacion). */
const VALIDATION_FIELDS: readonly { label: string; value: string }[] = [
  { label: 'Proveedor', value: 'Aceros del Norte' },
  { label: 'RFC', value: 'ANO080514QF2' },
  { label: 'Folio', value: 'A-1207' },
  { label: 'Subtotal', value: '$41,552.00' },
  { label: 'IVA 16%', value: '$6,648.00' },
  { label: 'Total', value: '$48,200.00' }
];

/** Checklist de validacion: tres en orden y un aviso (posible duplicado). */
const VALIDATION_CHECKS: readonly { text: string; status: 'ok' | 'warn' }[] = [
  { text: 'RFC válido ante el SAT', status: 'ok' },
  { text: 'Monto coincide con la OC-4471', status: 'ok' },
  { text: 'IVA del 16% correcto', status: 'ok' },
  { text: 'Posible duplicado: folio A-1182 el 03/jun', status: 'warn' }
];

/** Tiempos del motor (en ms). Mismo ritmo natural del mockup. */
const TIMING = {
  start: 500,
  userPause: 1100,
  agentTypingBase: 900,
  agentTypingPerChar: 20,
  agentTypingMax: 1500,
  afterAgent: 1300,
  reportTyping: 1500,
  afterReport: 1700,
  validationTyping: 1600,
  afterValidation: 1900,
  afterAlert: 1700,
  headerSwap: 360,
  betweenAgents: 2200,
  beforeRestart: 3000
} as const;

/** Tiempos de "escribiendo" y pausa posterior por tipo de tarjeta (ventas / factura). */
const CARD_TIMING: Record<'report' | 'validation', { typing: number; after: number }> = {
  report: { typing: TIMING.reportTyping, after: TIMING.afterReport },
  validation: { typing: TIMING.validationTyping, after: TIMING.afterValidation }
};

/**
 * Keyframes propios del widget, inyectados una vez (mismo patron que el flujo de pistas del
 * hero). Se aplican con `motion-safe:[animation:...]`, asi `prefers-reduced-motion: reduce`
 * los deja sin movimiento: las burbujas aparecen ya visibles y las barras quedan a su alto.
 */
const WIDGET_KEYFRAMES = `
@keyframes cw-pop { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes cw-typing { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
@keyframes cw-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
`;

/** Acento del widget: fondos/bordes suaves derivados del acento activo con `color-mix`. */
const accentSurfaceStyle: CSSProperties = { backgroundColor: 'var(--widget-accent)' };
const accentSoftStyle: CSSProperties = {
  color: 'var(--widget-accent)',
  backgroundColor: 'color-mix(in srgb, var(--widget-accent) 10%, transparent)',
  borderColor: 'color-mix(in srgb, var(--widget-accent) 26%, transparent)'
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Indicador de "escribiendo": tres puntos que rebotan suave (decorativo). */
function TypingIndicator(): JSX.Element {
  return (
    <div
      className="mr-auto inline-flex items-center gap-1 rounded-2xl rounded-bl-sm border border-border bg-background-tertiary px-4 py-3.5 motion-safe:[animation:cw-pop_0.25s_ease_both]"
      aria-hidden="true"
    >
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="h-1.5 w-1.5 rounded-full bg-foreground-secondary/70 motion-safe:[animation:cw-typing_1.2s_infinite]"
          style={{ animationDelay: `${dot * 0.18}s` }}
        />
      ))}
    </div>
  );
}

/**
 * Tarjeta de analisis (una de las respuestas de Sales Analysis): etiqueta, 3 KPIs y la
 * mini-grafica de barras que crecen animadas. La pill y las barras heredan el acento activo
 * (azul mientras corre Sales Analysis, que es cuando aparece la tarjeta).
 */
function ReportCard(): JSX.Element {
  return (
    <div className="mr-auto w-[94%] rounded-2xl rounded-bl-sm border border-border bg-background p-4 shadow-sm motion-safe:[animation:cw-pop_0.4s_ease_both]">
      <div className="mb-3 flex items-center gap-2 font-jetbrains text-[10px] uppercase tracking-[0.08em] text-foreground-secondary">
        <span style={accentSoftStyle} className="rounded-full border px-2 py-0.5">
          Q3 2026
        </span>
        Análisis de ventas · 3 meses
      </div>

      <div className="mb-3.5 grid grid-cols-3 gap-2.5">
        {REPORT_KPIS.map((kpi) => (
          <div key={kpi.label}>
            <div className="font-display text-lg font-extrabold leading-none tracking-tight text-foreground">
              {kpi.value}
            </div>
            <div className="mt-1 text-[11px] text-foreground-secondary">{kpi.label}</div>
            <div
              className="mt-1 font-jetbrains text-[10px] font-medium"
              style={{ color: kpi.trend === 'up' ? STATE.ok : STATE.bad }}
            >
              {kpi.delta}
            </div>
          </div>
        ))}
      </div>

      {/* Mini-grafica: barras (alto en %) sobre una linea base; etiquetas alineadas debajo. */}
      <div className="border-t border-border pt-2">
        <div className="flex h-[68px] items-end gap-2">
          {REPORT_BARS.map((bar, index) => (
            <div
              key={bar.label}
              style={{
                ...accentSurfaceStyle,
                height: `${bar.height}%`,
                transformOrigin: 'bottom',
                animationDelay: `${index * 0.06}s`
              }}
              className="flex-1 rounded-t opacity-90 motion-safe:[animation:cw-grow_0.7s_ease_both]"
              aria-hidden="true"
            />
          ))}
        </div>
        <div className="mt-1.5 flex gap-2">
          {REPORT_BARS.map((bar) => (
            <div
              key={bar.label}
              className="flex-1 text-center font-jetbrains text-[9px] text-foreground-secondary"
            >
              {bar.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Tarjeta de validacion de factura (respuesta de Facturacion): etiqueta, grid de datos
 * extraidos y un checklist con tres validaciones en orden y un aviso (posible duplicado). La
 * pill hereda el acento activo (verde mientras corre Facturacion); los iconos del checklist
 * usan la paleta de estado del widget (verde ok / ambar aviso).
 */
function ValidationCard(): JSX.Element {
  return (
    <div className="mr-auto w-[94%] rounded-2xl rounded-bl-sm border border-border bg-background p-4 shadow-sm motion-safe:[animation:cw-pop_0.4s_ease_both]">
      <div className="mb-3 flex items-center gap-2 font-jetbrains text-[10px] uppercase tracking-[0.08em] text-foreground-secondary">
        <span style={accentSoftStyle} className="rounded-full border px-2 py-0.5">
          Factura · CFDI
        </span>
        Datos extraídos y validados
      </div>

      <div className="mb-3.5 grid grid-cols-3 gap-x-3 gap-y-2.5">
        {VALIDATION_FIELDS.map((field) => (
          <div key={field.label} className="flex flex-col">
            <span className="font-jetbrains text-[9.5px] uppercase tracking-[0.04em] text-foreground-secondary">
              {field.label}
            </span>
            <span className="mt-0.5 text-[13px] font-semibold text-foreground">{field.value}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        {VALIDATION_CHECKS.map((check) => {
          const CheckIcon = check.status === 'ok' ? Check : AlertTriangle;
          return (
            <div
              key={check.text}
              className={cn(
                'flex items-start gap-2 text-[12.5px] leading-snug',
                check.status === 'ok' ? 'text-foreground-secondary' : 'text-foreground'
              )}
            >
              <CheckIcon
                className="mt-px h-[15px] w-[15px] flex-none"
                style={{ color: check.status === 'ok' ? STATE.ok : STATE.warn }}
                strokeWidth={check.status === 'ok' ? 3 : 2.4}
                aria-hidden="true"
              />
              {check.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Tarjeta de alerta (salida proactiva de Operaciones): fondo ambar tenue, icono de triangulo
 * y el detalle del cargo duplicado. Usa la paleta de estado (aviso) y es independiente del
 * acento del agente.
 */
function AlertCard(): JSX.Element {
  return (
    <div
      className="mr-auto flex w-[94%] gap-3 rounded-2xl rounded-bl-sm border p-3.5 motion-safe:[animation:cw-pop_0.4s_ease_both]"
      style={{
        backgroundColor: `color-mix(in srgb, ${STATE.warn} 9%, transparent)`,
        borderColor: `color-mix(in srgb, ${STATE.warn} 32%, transparent)`
      }}
    >
      <AlertTriangle
        className="h-5 w-5 flex-none"
        style={{ color: STATE.warn }}
        strokeWidth={2.4}
        aria-hidden="true"
      />
      <div>
        <div className="mb-0.5 font-display text-sm font-bold text-foreground">
          Cargo duplicado detectado
        </div>
        <div className="text-[13px] leading-snug text-foreground-secondary">
          Aceros del Norte facturó dos veces la OC-4471 (folios A-1182 y A-1207). Riesgo de doble
          pago: $48,200.
        </div>
      </div>
    </div>
  );
}

/** Una entrada del cuerpo del chat segun su tipo (usuario / agente texto / tarjetas). */
function ChatItem({ item }: { item: ScriptMessage }): JSX.Element {
  if (item.kind === 'user') {
    return (
      <div
        style={accentSurfaceStyle}
        className="ml-auto max-w-[84%] rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm font-medium text-white motion-safe:[animation:cw-pop_0.35s_ease_both]"
      >
        {item.text}
      </div>
    );
  }
  if (item.kind === 'agent') {
    return (
      <div className="mr-auto max-w-[84%] rounded-2xl rounded-bl-sm border border-border bg-background-tertiary px-3.5 py-2.5 text-sm text-foreground-secondary motion-safe:[animation:cw-pop_0.35s_ease_both]">
        {item.text}
      </div>
    );
  }
  if (item.kind === 'report') return <ReportCard />;
  if (item.kind === 'validation') return <ValidationCard />;
  return <AlertCard />;
}

/**
 * Widget de chat animado multi-agente. Ver la nota de cabecera del archivo para el detalle
 * de acento, animaciones, disparo por viewport y movimiento reducido.
 */
export function IntegrationChatWidget(): JSX.Element {
  // Se calcula una vez al montar: define si animamos o mostramos el estado final estatico.
  const [reduceMotion] = useState(prefersReducedMotion);

  const [agentKey, setAgentKey] = useState<AgentKey>('sales');
  const [items, setItems] = useState<ScriptMessage[]>(() =>
    reduceMotion ? [...SCRIPTS.sales] : []
  );
  const [typing, setTyping] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  // Si el entorno no tiene IntersectionObserver (sin viewport observable) arranca de una; si lo
  // tiene, espera a entrar en pantalla. Se decide en el inicializador para no llamar a setState
  // de forma sincrona dentro del efecto.
  const [started, setStarted] = useState<boolean>(() => typeof IntersectionObserver === 'undefined');

  const rootRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const agent = AGENTS[agentKey];
  const AgentIcon = agent.icon;

  // Disparo por viewport: el motor no corre hasta que el widget entra en pantalla.
  useEffect(() => {
    if (reduceMotion) return;
    const el = rootRef.current;
    if (!el) return;
    // Sin IntersectionObserver ya arrancamos via el inicializador de `started`: nada que observar.
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setStarted(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduceMotion]);

  // Motor de la conversacion. Usa esperas cancelables y limpia el timer pendiente al
  // desmontar, mas un flag `cancelled` que corta cualquier paso ya encolado.
  useEffect(() => {
    if (reduceMotion || !started) return;

    let cancelled = false;
    let timer: number | null = null;

    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        timer = window.setTimeout(() => {
          timer = null;
          resolve();
        }, ms);
      });

    const typingDuration = (text: string): number =>
      TIMING.agentTypingBase + Math.min(text.length * TIMING.agentTypingPerChar, TIMING.agentTypingMax);

    const playConversation = async (key: AgentKey): Promise<void> => {
      for (const message of SCRIPTS[key]) {
        if (cancelled) return;

        if (message.kind === 'user') {
          setItems((prev) => [...prev, message]);
          await sleep(TIMING.userPause);
          continue;
        }

        // Operaciones es proactivo: su tarjeta de alerta entra sin "escribiendo" previo.
        if (message.kind === 'alert') {
          setItems((prev) => [...prev, message]);
          await sleep(TIMING.afterAlert);
          continue;
        }

        // Respuesta con "escribiendo": texto del agente o tarjeta (ventas / factura).
        setTyping(true);
        await sleep(
          message.kind === 'agent'
            ? typingDuration(message.text)
            : CARD_TIMING[message.kind].typing
        );
        if (cancelled) return;
        setTyping(false);
        setItems((prev) => [...prev, message]);
        await sleep(message.kind === 'agent' ? TIMING.afterAgent : CARD_TIMING[message.kind].after);
      }
    };

    // Transicion al siguiente agente: se limpia el cuerpo y el header se desvanece a la vez;
    // ya invisible, se cambian nombre/icono/acento y el header reaparece con el agente nuevo.
    const transitionTo = async (key: AgentKey): Promise<void> => {
      setHeaderHidden(true);
      setItems([]);
      setTyping(false);
      await sleep(TIMING.headerSwap);
      if (cancelled) return;
      setAgentKey(key);
      setHeaderHidden(false);
    };

    const run = async (): Promise<void> => {
      await sleep(TIMING.start);
      let index = 0;
      // La primera vuelta ya arranca en Sales Analysis con el cuerpo vacio, sin transicion.
      while (!cancelled) {
        const key = AGENT_ORDER[index % AGENT_ORDER.length];
        if (!key) break;
        if (index > 0) {
          await transitionTo(key);
          if (cancelled) return;
        }
        await playConversation(key);
        if (cancelled) return;
        const isLastOfCycle = index % AGENT_ORDER.length === AGENT_ORDER.length - 1;
        await sleep(isLastOfCycle ? TIMING.beforeRestart : TIMING.betweenAgents);
        index += 1;
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [reduceMotion, started]);

  // Auto-scroll al ultimo mensaje mientras la conversacion avanza (no en estatico).
  useEffect(() => {
    if (reduceMotion) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, typing, reduceMotion]);

  return (
    <div
      ref={rootRef}
      style={{ '--widget-accent': agent.accent } as CSSProperties}
      className="flex h-[30rem] flex-col overflow-hidden rounded-2xl border border-border bg-background-secondary shadow-md"
    >
      <style>{WIDGET_KEYFRAMES}</style>

      <div
        className={cn(
          'flex items-center gap-3 border-b border-border px-4 py-3 transition-opacity duration-300',
          headerHidden && 'opacity-0'
        )}
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-lg border transition-colors duration-500"
          style={accentSoftStyle}
          aria-hidden="true"
        >
          <AgentIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="font-display text-sm font-semibold text-foreground">{agent.name}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 font-jetbrains text-[10px] uppercase tracking-[0.06em] text-success">
          <span
            className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_7px_rgba(16,185,129,0.6)]"
            aria-hidden="true"
          />
          En línea
        </span>
      </div>

      <div ref={bodyRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {items.map((item, index) => (
          <ChatItem key={`${agentKey}-${index}`} item={item} />
        ))}
        {typing && <TypingIndicator />}
      </div>

      <div className="flex items-center gap-2 border-t border-border p-3">
        <div className="flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground-secondary/60">
          Escribe tu mensaje
        </div>
        <button
          type="button"
          aria-label="Enviar mensaje"
          style={accentSurfaceStyle}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-xl text-white transition-colors duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background-secondary"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
