import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';

// Tipado JSX del custom element para que el wrapper (y los consumidores que escriban
// <ledesma-agent> directo) compilen sin any. Con @types/react >= 19 el namespace JSX
// vive en el modulo 'react' (React.JSX), no en el global; la augmentacion de modulo
// requiere un namespace, de ahi la excepcion puntual a la regla.
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'ledesma-agent': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        class?: string;
        endpoint?: string;
        'token-url'?: string;
        'session-token'?: string;
        'provider-key'?: string;
        placeholder?: string;
        'ai-notice'?: string;
        'privacy-url'?: string;
      };
    }
  }
}

export interface LedesmaAgentProps {
  endpoint: string;
  tokenUrl?: string;
  sessionToken?: string;
  providerKey?: string;
  title?: string;
  placeholder?: string;
  /** Texto de la divulgacion de IA (EU AI Act Art 50). Si se omite, el widget muestra un texto por defecto. */
  aiNotice?: string;
  /** URL del aviso de privacidad para enlazar desde la divulgacion. Solo http(s) o rutas relativas. */
  privacyUrl?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Wrapper React del custom element <ledesma-agent>: mapea props camelCase a los atributos
 * kebab-case del elemento (setAttribute al montar y cuando cambian; removeAttribute cuando la
 * prop es undefined). El script del widget (ledesma-agent.js, servido por la plataforma) debe
 * cargarse aparte: este wrapper NO lo incluye ni lo inyecta.
 */
export function LedesmaAgent({
  endpoint,
  tokenUrl,
  sessionToken,
  providerKey,
  title,
  placeholder,
  aiNotice,
  privacyUrl,
  className,
  style,
}: LedesmaAgentProps): ReactElement {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const attributes: Record<string, string | undefined> = {
      endpoint,
      'token-url': tokenUrl,
      'session-token': sessionToken,
      'provider-key': providerKey,
      title,
      placeholder,
      'ai-notice': aiNotice,
      'privacy-url': privacyUrl,
    };
    for (const [name, value] of Object.entries(attributes)) {
      if (value === undefined) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  }, [endpoint, tokenUrl, sessionToken, providerKey, title, placeholder, aiNotice, privacyUrl]);

  return <ledesma-agent ref={ref} class={className} style={style} />;
}
