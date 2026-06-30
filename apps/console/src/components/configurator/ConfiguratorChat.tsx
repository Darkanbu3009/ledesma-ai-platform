import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ArrowUp, RefreshCw, Sparkles } from 'lucide-react';
import type { ConfiguratorMessage } from '../../lib/configurator';

/**
 * Panel de chat del Configurador. Es presentacional: el historial enviable, los turnos y los errores
 * los maneja la pagina (estado React, sin persistencia). Aqui solo se renderiza el transcripto, el
 * mensaje en vuelo (pending) con indicador de carga, y el error con reintento. El log es accesible
 * (role="log", aria-live) y el textarea esta etiquetado.
 */
export function ConfiguratorChat({
  messages,
  pending,
  loading,
  errorText,
  onSend,
  onRetry,
}: {
  messages: ConfiguratorMessage[];
  pending: string | null;
  loading: boolean;
  errorText: string | null;
  onSend: (text: string) => void;
  onRetry: () => void;
}) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending, loading, errorText]);

  const isEmpty = messages.length === 0 && pending === null;

  function send() {
    const text = draft.trim();
    if (text === '' || loading) return;
    onSend(text);
    setDraft('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Conversacion con el Configurador"
        aria-busy={loading}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brasa-soft text-brasa">
              <Sparkles className="h-5 w-5" />
            </span>
            <p className="mt-4 max-w-xs text-sm text-muted">
              Conta que agente queres crear y el Configurador lo arma con vos, paso a paso.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message, i) =>
              message.role === 'user' ? (
                <UserBubble key={i} text={message.content} />
              ) : (
                <AssistantBubble key={i} text={message.content} />
              ),
            )}

            {pending !== null && <UserBubble text={pending} />}

            {loading && <TypingIndicator />}

            {errorText && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl border border-brasa-line bg-brasa-soft px-4 py-2.5 text-sm text-brasa">
                  <p>{errorText}</p>
                  <button
                    type="button"
                    onClick={onRetry}
                    disabled={loading}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-brasa-line px-3 py-1 text-xs font-medium text-brasa transition hover:bg-brasa/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Reintentar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2.5">
          <label htmlFor="configurador-input" className="sr-only">
            Mensaje para el Configurador
          </label>
          <textarea
            id="configurador-input"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribi lo que queres que haga tu agente..."
            className="min-w-0 flex-1 resize-none rounded-xl border border-line bg-field px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted-soft focus:border-brasa focus:ring-2 focus:ring-brasa/20"
          />
          <button
            type="button"
            onClick={send}
            disabled={loading || draft.trim() === ''}
            aria-label="Enviar mensaje"
            className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brasa text-white transition-colors hover:bg-brasa-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl border border-brasa-line bg-brasa-soft px-4 py-2.5 text-sm text-ink">
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl border border-line bg-field px-4 py-2.5 text-sm text-ink">
        {text}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start" aria-label="El Configurador esta escribiendo">
      <div className="flex items-center gap-1 rounded-2xl border border-line bg-field px-4 py-3">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-soft"
      style={{ animationDelay: delay }}
    />
  );
}
