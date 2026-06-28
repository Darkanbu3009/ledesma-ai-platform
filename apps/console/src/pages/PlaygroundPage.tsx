import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  Square,
  Wrench,
  X,
} from 'lucide-react';
import { providerLabel } from '../lib/agents';
import type { AttachmentRef } from '../lib/attachments';
import { MAX_ADJUNTOS, planificarEnvio, subirArchivos } from '../lib/attachment-upload';
import { buildRequestChat, commitTurn } from '../lib/chat-turn';
import { useAgent } from '../lib/queries';
import { runAgentStream, type ChatMessage } from '../lib/run-agent';
import type { SseMessage } from '../lib/sse';
import { Field, inputClass } from '../components/ui/Field';

/**
 * Filtros del dialogo del SO por categoria de adjunto. Son SOLO una sugerencia para el picker;
 * la validacion real (mimeType, tamano, etc.) la sigue haciendo subirAdjunto, no el menu.
 */
const ACEPTA_IMAGENES = 'image/png,image/jpeg,image/webp,image/gif';
const ACEPTA_DOCUMENTOS = '.pdf,.docx,.xlsx,.xls';

/** Opciones del menu "+": etiqueta, icono y el accept que cada una pasa al file picker. */
const OPCIONES_ADJUNTO = [
  { label: 'Imagen', Icono: ImageIcon, accept: ACEPTA_IMAGENES },
  { label: 'Documento', Icono: FileText, accept: ACEPTA_DOCUMENTOS },
] as const;

/** Icono de la miniatura segun la categoria del adjunto. */
function iconoAdjunto(kind: AttachmentRef['kind']) {
  if (kind === 'image') return ImageIcon;
  if (kind === 'excel') return FileSpreadsheet;
  return FileText; // pdf y word
}

/**
 * Boton "+" que abre un menu en lista con las opciones para adjuntar (Imagen / Documento).
 * Es solo UI: al elegir una opcion delega en `onElegir` con el accept de esa categoria; la subida
 * y su validacion siguen viviendo en subirAdjunto. Maneja su propio estado abierto/cerrado, el
 * cierre al hacer clic fuera, el cierre con Escape y es navegable por teclado.
 */
function MenuAdjuntar({
  disabled,
  titulo,
  onElegir,
}: {
  disabled: boolean;
  titulo: string;
  onElegir: (accept: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement | null>(null);

  // Cerrar el menu al hacer clic fuera o al presionar Escape, solo mientras esta abierto.
  useEffect(() => {
    if (!abierto) return;
    const alClicFuera = (event: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(event.target as Node)) {
        setAbierto(false);
      }
    };
    const alEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('mousedown', alClicFuera);
    document.addEventListener('keydown', alEscape);
    return () => {
      document.removeEventListener('mousedown', alClicFuera);
      document.removeEventListener('keydown', alEscape);
    };
  }, [abierto]);

  function elegir(accept: string) {
    setAbierto(false);
    onElegir(accept);
  }

  return (
    <div ref={contenedorRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label="Adjuntar archivo"
        title={titulo}
        className="inline-flex items-center justify-center rounded-lg p-1.5 text-hueso-muted transition hover:bg-line-soft hover:text-hueso disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Plus className="h-4 w-4" />
      </button>
      {abierto && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-10 mb-2 min-w-[11rem] overflow-hidden rounded-lg border border-grafito-border bg-grafito py-1 shadow-lg"
        >
          {OPCIONES_ADJUNTO.map(({ label, Icono, accept }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => elegir(accept)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-hueso-muted transition hover:bg-carbon hover:text-hueso"
            >
              <Icono className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type ViewItem =
  | { kind: 'user'; text: string; attachments?: AttachmentRef[] }
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
  // Adjuntos ya subidos para el turno actual + estado de subida en curso y su error.
  const [adjuntos, setAdjuntos] = useState<AttachmentRef[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [adjuntoError, setAdjuntoError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const assistantTextRef = useRef('');
  const turnClosedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const keyMissing = providerKey.trim() === '';
  // Heuristica de formato (NO es validacion real ni llama a ninguna API): la key "parece"
  // presente si, tras recortar espacios, no esta vacia y empieza con "sk-". Solo decide el
  // color de fondo; toda la logica de habilitar/enviar sigue usando keyMissing.
  const keyPresente = providerKey.trim().startsWith('sk-');
  // Fondo condicional del panel de chat y de la caja del input: hueso cuando hay key,
  // gris apagado cuando no. La transicion suave la agrega cada elemento con transition.
  const fondoSegunKey = keyPresente ? 'bg-[#FAF9F5]' : 'bg-[#E7E4DD]';

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
  async function sendText(content: string, attachments: AttachmentRef[] = []) {
    if (!id || !agent || running || keyMissing || content === '') return;

    // El request usa el historial confirmado mas este user; chat NO se actualiza todavia.
    const requestChat: ChatMessage[] = buildRequestChat(chat, content);
    setVista((items) => [
      ...items,
      { kind: 'user', text: content, attachments: attachments.length > 0 ? attachments : undefined },
    ]);
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
        attachments,
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
    if (!agent || running || keyMissing || subiendo) return;
    // Se puede enviar solo-texto, texto + adjuntos, o adjuntos solos (con un texto por defecto).
    const plan = planificarEnvio({ draft, adjuntos });
    if (!plan) return;
    setDraft(plan.siguiente.draft);
    setAdjuntos(plan.siguiente.adjuntos);
    setAdjuntoError(null);
    void sendText(plan.envio.texto, plan.envio.attachments);
  }

  /**
   * Aplica el filtro de tipo elegido en el menu y abre el selector del SO. Solo cambia el accept
   * (sugerencia del dialogo); el archivo elegido sigue pasando por handleArchivos -> subirAdjunto.
   */
  function abrirSelector(accept: string) {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept;
    input.click();
  }

  /** Sube los archivos elegidos y los agrega a los pendientes del turno. */
  async function handleArchivos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Limpiar el value permite volver a elegir el mismo archivo despues de quitarlo.
    event.target.value = '';
    if (files.length === 0) return;

    setAdjuntoError(null);
    setSubiendo(true);
    await subirArchivos(files, adjuntos.length, {
      onSubido: (ref) => setAdjuntos((prev) => [...prev, ref]),
      onError: (mensaje) => setAdjuntoError(mensaje),
    });
    setSubiendo(false);
  }

  function quitarAdjunto(index: number) {
    setAdjuntos((prev) => prev.filter((_, i) => i !== index));
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
            className={`mt-4 h-[26rem] overflow-y-auto rounded-xl border border-grafito-border ${fondoSegunKey} p-4 transition-colors duration-300`}
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
                          <div className="max-w-[80%] rounded-xl border border-brasa/30 bg-brasa/10 px-4 py-2.5 text-sm text-hueso">
                            <p className="whitespace-pre-wrap">{item.text}</p>
                            {item.attachments && item.attachments.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-brasa/20 pt-2">
                                {item.attachments.map((a, j) => {
                                  const Icono = iconoAdjunto(a.kind);
                                  return (
                                    <span
                                      key={j}
                                      className="inline-flex items-center gap-1 rounded-full border border-brasa/30 px-2 py-0.5 text-xs text-hueso-muted"
                                    >
                                      <Icono className="h-3 w-3 shrink-0" />
                                      <span className="max-w-[10rem] truncate">{a.name}</span>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
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

          <div className="mt-4 space-y-2">
            {(adjuntos.length > 0 || subiendo) && (
              <div className="flex flex-wrap items-center gap-2">
                {adjuntos.map((a, i) => {
                  const Icono = iconoAdjunto(a.kind);
                  return (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-full border border-grafito-border bg-grafito px-3 py-1 text-xs text-hueso-muted"
                    >
                      <Icono className="h-3.5 w-3.5 shrink-0" />
                      <span className="max-w-[12rem] truncate">{a.name}</span>
                      <button
                        type="button"
                        onClick={() => quitarAdjunto(i)}
                        aria-label={`Quitar ${a.name}`}
                        className="text-hueso-muted transition hover:text-brasa"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  );
                })}
                {subiendo && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-hueso-muted">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    Subiendo...
                  </span>
                )}
              </div>
            )}

            {adjuntoError && <p className="text-xs text-brasa">{adjuntoError}</p>}

            <div className="flex items-end gap-3">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                onChange={(e) => void handleArchivos(e)}
              />
              {/* La caja del input contiene el textarea arriba y, en su fila inferior, el "+". */}
              <div
                className={`flex min-w-0 flex-1 flex-col rounded-xl border border-line ${fondoSegunKey} transition duration-300 focus-within:border-brasa focus-within:ring-2 focus-within:ring-brasa/20`}
              >
                <textarea
                  rows={2}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={keyMissing}
                  className="w-full resize-none bg-transparent px-3.5 pt-2.5 text-sm text-ink outline-none transition placeholder:text-muted-soft disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="Escribe un mensaje..."
                />
                <div className="flex items-center px-2 pb-2">
                  <MenuAdjuntar
                    disabled={keyMissing || subiendo || adjuntos.length >= MAX_ADJUNTOS}
                    titulo={
                      adjuntos.length >= MAX_ADJUNTOS
                        ? `Maximo ${MAX_ADJUNTOS} archivos`
                        : 'Adjuntar archivo'
                    }
                    onElegir={abrirSelector}
                  />
                </div>
              </div>
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
                  disabled={keyMissing || subiendo || (draft.trim() === '' && adjuntos.length === 0)}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brasa px-4 py-2.5 text-sm font-semibold text-carbon transition hover:bg-brasa-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  Enviar
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
