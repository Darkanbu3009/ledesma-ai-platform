import { type JSX, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Globe,
  MessageCircle,
  Hash,
  Mail,
  Code2,
  Smartphone,
  Copy,
  Check,
  type LucideIcon
} from 'lucide-react';
import { IntegrationChatWidget } from './integration-chat-widget';

/**
 * Resaltado de sintaxis del snippet sin libreria: cada token lleva su color como
 * clase de Tailwind (valor arbitrario). Son colores de SINTAXIS, no tokens de marca,
 * por eso van como hex puntuales y no como `accent` u otros tokens del repo:
 * keyword (naranja claro), clase (amarillo calido), metodo (azul), string (verde),
 * puntuacion (gris) y propiedad (gris claro neutro).
 */
const KW = 'text-[#FF8A5C]';
const CLS = 'text-[#E8C07D]';
const MTH = 'text-[#7FB6E6]';
const STR = 'text-[#9BD08A]';
const PN = 'text-[#7A7B82]';
const PROP = 'text-[#C9CAD0]';

interface Token {
  text: string;
  className: string;
}

/**
 * Snippet de integracion en 3 lineas de codigo como tokens (SDK + BYOK: se instancia
 * el agente con su agentId, la apiKey del cliente y el modelo intercambiable, y se
 * monta). El texto que se copia al portapapeles se deriva de estos mismos tokens (ver
 * `CODE_TEXT`), asi lo que se ve y lo que se copia nunca se desincronizan.
 */
const CODE_LINES: Token[][] = [
  [
    { text: 'import', className: KW },
    { text: ' { ', className: PN },
    { text: 'LedesmaAgent', className: CLS },
    { text: ' } ', className: PN },
    { text: 'from', className: KW },
    { text: ' ', className: PN },
    { text: '"@ledesma/sdk"', className: STR }
  ],
  [
    { text: 'const', className: KW },
    { text: ' ', className: PN },
    { text: 'agente', className: PROP },
    { text: ' = ', className: PN },
    { text: 'new', className: KW },
    { text: ' ', className: PN },
    { text: 'LedesmaAgent', className: CLS },
    { text: '({ ', className: PN },
    { text: 'agentId', className: PROP },
    { text: ': ', className: PN },
    { text: '"customer-success"', className: STR },
    { text: ', ', className: PN },
    { text: 'apiKey', className: PROP },
    { text: ': ', className: PN },
    { text: 'process', className: PROP },
    { text: '.', className: PN },
    { text: 'env', className: PROP },
    { text: '.', className: PN },
    { text: 'LEDESMA_API_KEY', className: PROP },
    { text: ', ', className: PN },
    { text: 'model', className: PROP },
    { text: ': ', className: PN },
    { text: '"claude"', className: STR },
    { text: ' })', className: PN }
  ],
  [
    { text: 'agente', className: PROP },
    { text: '.', className: PN },
    { text: 'mount', className: MTH },
    { text: '(', className: PN },
    { text: '"#soporte"', className: STR },
    { text: ')', className: PN }
  ]
];

/** Texto plano del snippet (las 3 lineas) para el boton Copiar. */
const CODE_TEXT = CODE_LINES.map((line) => line.map((token) => token.text).join('')).join('\n');

/** Superficies donde corre el agente (fila de canales del mockup). Guardan la CLAVE i18n. */
const SURFACES: { icon: LucideIcon; labelKey: string }[] = [
  { icon: Globe, labelKey: 'landing.integracion.superficies.web' },
  { icon: MessageCircle, labelKey: 'landing.integracion.superficies.whatsapp' },
  { icon: Hash, labelKey: 'landing.integracion.superficies.slack' },
  { icon: Mail, labelKey: 'landing.integracion.superficies.correo' },
  { icon: Code2, labelKey: 'landing.integracion.superficies.api' },
  { icon: Smartphone, labelKey: 'landing.integracion.superficies.movil' }
];

/**
 * Seccion de integracion: el agente se monta en tres lineas (bloque de codigo con
 * resaltado y boton Copiar), se renderiza como widget de chat y corre en las
 * superficies que el equipo ya usa.
 */
export function Integration(): JSX.Element {
  const { t, i18n } = useTranslation();
  const [copiado, setCopiado] = useState(false);

  const copiar = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(CODE_TEXT);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Clipboard no disponible (permiso/contexto inseguro): no rompemos la demo.
    }
  };

  return (
    <section id="integracion" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <span className="font-jetbrains text-xs font-medium uppercase tracking-[0.18em] text-foreground-secondary">
            {t('landing.integracion.eyebrow')}
          </span>
          <h2 className="mt-5 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('landing.integracion.titulo')}
          </h2>
          <p className="mt-4 text-lg text-foreground-secondary">
            {t('landing.integracion.descripcion')}
          </p>
        </div>

        <div className="mt-12 grid gap-5 min-[900px]:grid-cols-[1.15fr_1fr] min-[900px]:gap-x-14">
          {/* Codigo en 3 lineas. El editor se queda OSCURO a proposito (patron tipo
              Cursor: un editor oscuro sobre pagina clara): conserva su resaltado de
              sintaxis y, para contrastar con el crema, lleva su propio fondo oscuro,
              borde y sombra. Por eso aqui los colores son explicitos (no los tokens
              de tema, que ahora son claros). */}
          <div className="flex flex-col overflow-hidden rounded-2xl border border-[#2A2A2A] bg-[#161616] shadow-md">
            <div className="flex items-center gap-2 border-b border-[#2A2A2A] px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-white/15" aria-hidden="true" />
              <span className="h-3 w-3 rounded-full bg-white/15" aria-hidden="true" />
              <span className="h-3 w-3 rounded-full bg-[#FF6E40]" aria-hidden="true" />
              <span className="ml-2 font-jetbrains text-xs text-white/45">widget.tsx</span>
              <button
                type="button"
                onClick={() => void copiar()}
                aria-live="polite"
                className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1.5 font-jetbrains text-[11px] text-white/55 transition-colors hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#161616]"
              >
                {copiado ? (
                  <Check className="h-3 w-3 shrink-0 text-[#10B981]" aria-hidden="true" />
                ) : (
                  <Copy className="h-3 w-3 shrink-0" aria-hidden="true" />
                )}
                {copiado ? t('landing.integracion.copiado') : t('landing.integracion.copiar')}
              </button>
            </div>
            <div className="flex flex-1 py-4 font-jetbrains text-[13.5px] leading-[2.1]">
              <div
                className="shrink-0 select-none px-4 text-right text-white/25"
                aria-hidden="true"
              >
                {CODE_LINES.map((_, index) => (
                  <div key={index}>{index + 1}</div>
                ))}
              </div>
              <div className="overflow-x-auto pr-5">
                {CODE_LINES.map((tokens, index) => (
                  <div key={index} className="whitespace-pre">
                    {tokens.length === 0
                      ? ' '
                      : tokens.map((token, tokenIndex) => (
                          <span key={tokenIndex} className={token.className}>
                            {token.text}
                          </span>
                        ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Widget renderizado: chat ANIMADO multi-agente (cuatro agentes en ciclo: Sales
              Analysis, Facturacion, Operaciones y Customer Success). Hereda el tema claro y
              propaga el acento del agente activo por una custom property; arranca al entrar al
              viewport y respeta el movimiento reducido. La logica vive en su propio componente.
              La key por idioma remonta el widget al cambiar de idioma: el guion animado arranca
              de cero en vez de mezclar mensajes de dos corridas. */}
          <IntegrationChatWidget key={i18n.language} />
        </div>

        {/* Fila de canales */}
        <div className="mt-12 border-t border-border pt-9">
          <div className="mb-5 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <p className="font-jetbrains text-xs uppercase tracking-[0.16em] text-foreground-secondary">
              {t('landing.integracion.canalesTitulo')}
            </p>
            <p className="text-sm text-foreground-secondary">{t('landing.integracion.canalesSubtitulo')}</p>
          </div>
          <ul className="flex flex-wrap gap-3">
            {SURFACES.map((surface) => {
              const Icon = surface.icon;
              return (
                <li
                  key={surface.labelKey}
                  className="group inline-flex cursor-default items-center gap-2.5 rounded-xl border border-border bg-background-secondary px-4 py-3 text-sm font-medium text-foreground-secondary transition-[transform,background-color,border-color] duration-200 hover:border-accent/30 hover:bg-background-tertiary motion-safe:hover:-translate-y-0.5"
                >
                  <Icon
                    className="h-[18px] w-[18px] text-foreground transition-colors duration-200 group-hover:text-accent"
                    aria-hidden="true"
                  />
                  {t(surface.labelKey)}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
