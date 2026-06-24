import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Send, Square, Wrench } from 'lucide-react';
import { providerLabel } from '../lib/agents';
import { buildRequestChat, commitTurn } from '../lib/chat-turn';
import { useAgent } from '../lib/queries';
import { runAgentStream, type ChatMessage } from '../lib/run-agent';
import type { SseMessage } from '../lib/sse';
import { Field, inputClass } from '../components/ui/Field';

type ViewItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; isError: boolean }
  | { kind: 'usage'; inputTokens: number; outputTokens: number }
  | { kind: 'error'; code: string; message?: string; retryText: string };

export function PlaygroundPage() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading, isError, refetch } = useAgent(id);

  // Todo vive SOLO en memoria: la key y la conversacion JAMAS se persisten.
  const [providerKey, setProviderKey] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [vista, setVista] = useState<ViewItem[]>([]);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const assistantTextRef = useRef('');
  const turnClosedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const keyMissing = providerKey.trim() === '';

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [vista]);

  // Si el usuario navega fuera con un stream activo, lo cortamos.
  useEffect(() => () => abortRef.current?.abort(), []);

  function appendDelta(text: string) {
    assistantTextRef.current += text;
    setVista((items) => {
      const last = items[items.length - 1];
      if (last && last.kind === 'assistant') {
        return [...items.slice(0, -1), { kind: 'assistant', text: last.text + text }];
      }
      return [...items, { kind: 'assistant', text }];
    });
  }

  /**
   * Cierra el turno una sola vez. El historial enviable (chat) es transaccional: solo incorpora
   * el par (user, assistant) cuando el turno termina bien; en error o abort queda como estaba,
   * asi el siguiente envio no produce dos user consecutivos (el proveedor exige alternancia).
   */
  function closeTurn(userText: string, keepText: boolean) {
    if (!turnClosedRef.current) {
      turnClosedRef.current = true;
      const text = assistantTextRef.current;
      if (keepText && text !== '') {
        setChat((prev) => commitTurn(prev, userText, text));
      }
    }
    setRunning(false);
  }

  function handleMessage(message: SseMessage, userText: string) {
    if (message.kind === 'done') {
      closeTurn(userText, true);
      return;
    }
    if (message.kind === 'error') {
      setVista((items) => [
        ...items,
        { kind: 'error', code: message.code, message: message.message, retryText: userText },
      ]);
      closeTurn(userText, false);
      return;
    }
    const event = message.event;
    switch (event.type) {
      case 'text_delta':
        appendDelta(event.text);
        break;
      case 'tool_use':
        setVista((items) => [...items, { kind: 'tool', id: event.id, name: event.name, isError: false }]);
        break;
      case 'tool_result':
        if (event.isError) {
          setVista((items) =>
            items.map((item) =>
              item.kind === 'tool' && item.id === event.toolUseId ? { ...item, isError: true } : item,
            ),
          );
        }
        break;
      case 'stop':
        setVista((items) => [
          ...items,
          { kind: 'usage', inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens },
        ]);
        break;
    }
  }

  /** Ejecuta un turno con el texto dado. Si ya hay un turno corriendo, retorna (doble envio). */
  async function sendText(content: string) {
    if (!id || !agent || running || keyMissing || content === '') return;

    // El request usa el historial confirmado mas este user; chat NO se actualiza todavia.
    const requestChat: ChatMessage[] = buildRequestChat(chat, content);
    setVista((items) => [...items, { kind: 'user', text: content }]);
    setRunning(true);
    assistantTextRef.current = '';
    turnClosedRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await runAgentStream({
        agentId: id,
        providerKey,
        messages: requestChat,
        signal: controller.signal,
        onMessage: (message) => handleMessage(message, content),
      });
      closeTurn(content, true);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Turno cancelado por el usuario: la vista conserva el parcial, el historial no.
        closeTurn(content, false);
      } else {
        if (!turnClosedRef.current) {
          setVista((items) => [...items, { kind: 'error', code: 'UNKNOWN', retryText: content }]);
        }
        closeTurn(content, false);
      }
    } finally {
      abortRef.current = null;
    }
  }

  function send() {
    const content = draft.trim();
    if (!agent || running || keyMissing || content === '') return;
    setDraft('');
    void sendText(content);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!running) send();
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      {isLoading ? (
        <div className="space-y-5">
          <div className="h-12 animate-pulse rounded-xl border border-grafito-border bg-grafito" />
          <div className="h-28 animate-pulse rounded-xl border border-grafito-border bg-grafito" />
          <div className="h-72 animate-pulse rounded-xl border border-grafito-border bg-grafito" />
        </div>
      ) : isError || !agent ? (
        <div className="mt-10 rounded-xl border border-grafito-border bg-grafito p-8 text-center">
          <p className="font-display text-lg text-hueso">No pudimos cargar el agente</p>
          <p className="mt-2 text-sm text-hueso-muted">Revisa tu conexion e intenta de nuevo.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate font-display text-2xl font-bold text-hueso">
                Playground: {agent.name}
              </h1>
              <p className="mt-1 text-sm text-hueso-muted">
                {providerLabel(agent.providerId)} · <span className="font-mono">{agent.model}</span>
              </p>
            </div>
            <Link
              to={`/agentes/${agent.id}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-grafito-border px-4 py-2 text-sm text-hueso-muted transition hover:border-hueso-muted hover:text-hueso"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver
            </Link>
          </div>

          <div className="mt-6 rounded-xl border border-grafito-border bg-grafito p-5">
            <Field
              label="API key del proveedor"
              hint="Tu llave se usa solo para esta sesion de prueba, viaja cifrada en cada peticion y NUNCA se guarda en la plataforma."
            >
              <input
                type="password"
                value={providerKey}
                onChange={(e) => setProviderKey(e.target.value)}
                className={inputClass}
                placeholder="sk-..."
                autoComplete="off"
              />
            </Field>
          </div>

          <div
            ref={scrollRef}
            className="mt-4 h-[26rem] overflow-y-auto rounded-xl border border-grafito-border bg-carbon p-4"
          >
            {keyMissing ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-hueso-muted">Pega tu API key para probar el agente.</p>
              </div>
            ) : vista.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-hueso-muted">Escribe un mensaje para empezar.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {vista.map((item, i) => {
                  switch (item.kind) {
                    case 'user':
                      return (
                        <div key={i} className="flex justify-end">
                          <div className="max-w-[80%] whitespace-pre-wrap rounded-xl border border-brasa/30 bg-brasa/10 px-4 py-2.5 text-sm text-hueso">
                            {item.text}
                          </div>
                        </div>
                      );
                    case 'assistant':
                      return (
                        <div key={i} className="flex justify-start">
                          <div className="max-w-[80%] whitespace-pre-wrap rounded-xl border border-grafito-border bg-grafito px-4 py-2.5 text-sm text-hueso">
                            {item.text}
                          </div>
                        </div>
                      );
                    case 'tool':
                      return (
                        <div key={i} className="flex justify-start">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                              item.isError
                                ? 'border-brasa/40 text-brasa'
                                : 'border-grafito-border text-hueso-muted'
                            }`}
                          >
                            <Wrench className="h-3.5 w-3.5" />
                            {item.name}
                          </span>
                        </div>
                      );
                    case 'usage':
                      return (
                        <p key={i} className="text-center text-xs text-hueso-muted">
                          {item.inputTokens} in / {item.outputTokens} out tokens
                        </p>
                      );
                    case 'error':
                      return (
                        <div key={i} className="flex justify-start">
                          <div className="max-w-[80%] rounded-xl border border-brasa/40 bg-brasa/10 px-4 py-2.5 text-sm text-brasa">
                            <p className="font-mono text-xs font-semibold">{item.code}</p>
                            <p className="mt-1">
                              {item.message ?? 'Revisa tu key o el identificador del modelo.'}
                            </p>
                            <button
                              type="button"
                              onClick={() => void sendText(item.retryText)}
                              disabled={running}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-brasa/40 px-3 py-1 text-xs font-medium text-brasa transition hover:border-brasa disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              Reintentar
                            </button>
                          </div>
                        </div>
                      );
                  }
                })}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-end gap-3">
            <textarea
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={keyMissing}
              className={`${inputClass} resize-none disabled:cursor-not-allowed disabled:opacity-60`}
              placeholder="Escribe un mensaje..."
            />
            {running ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-grafito-border px-4 py-2.5 text-sm font-medium text-brasa transition hover:border-brasa"
              >
                <Square className="h-4 w-4" />
                Detener
              </button>
            ) : (
              <button
                type="button"
                onClick={() => send()}
                disabled={keyMissing || draft.trim() === ''}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brasa px-4 py-2.5 text-sm font-semibold text-carbon transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                Enviar
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
