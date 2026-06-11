import { streamAgent } from './client.js';
import type { SseMessage } from './sse.js';
import { buildRequestChat, commitTurn, type ChatMessage } from './turns.js';

/**
 * Estilos del Shadow DOM. Tema oscuro por defecto, personalizable desde la pagina anfitriona
 * via CSS custom properties --la-* (las variables atraviesan el shadow boundary). Tipografia
 * del sistema: el widget no carga fuentes externas.
 */
const styles = `
:host {
  display: block;
  width: 100%;
  font-family: var(--la-font, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif);
}
* {
  box-sizing: border-box;
}
.root {
  display: flex;
  flex-direction: column;
  height: var(--la-height, 480px);
  background: var(--la-bg, #0f0f11);
  border: 1px solid var(--la-border, #2a2a30);
  border-radius: var(--la-radius, 12px);
  color: var(--la-text, #f2efe9);
  overflow: hidden;
}
.header {
  flex-shrink: 0;
  padding: 12px 16px;
  background: var(--la-surface, #1a1a1f);
  border-bottom: 1px solid var(--la-border, #2a2a30);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  overflow-y: auto;
}
.bubble {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: var(--la-radius, 12px);
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.bubble.user {
  align-self: flex-end;
  border: 1px solid color-mix(in srgb, var(--la-accent, #e5562a) 30%, transparent);
  background: color-mix(in srgb, var(--la-accent, #e5562a) 10%, transparent);
}
.bubble.assistant {
  align-self: flex-start;
  border: 1px solid var(--la-border, #2a2a30);
  background: var(--la-surface, #1a1a1f);
}
.bubble.error {
  align-self: flex-start;
  border: 1px solid color-mix(in srgb, var(--la-accent, #e5562a) 40%, transparent);
  background: color-mix(in srgb, var(--la-accent, #e5562a) 10%, transparent);
  color: var(--la-accent, #e5562a);
}
.error-code {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
}
.error-text {
  margin: 4px 0 0;
}
.chip {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border: 1px solid var(--la-border, #2a2a30);
  border-radius: 999px;
  color: var(--la-muted, #a8a29a);
  font-size: 11px;
}
.chip.error {
  border-color: color-mix(in srgb, var(--la-accent, #e5562a) 40%, transparent);
  color: var(--la-accent, #e5562a);
}
.usage {
  align-self: center;
  color: var(--la-muted, #a8a29a);
  font-size: 11px;
}
.composer {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--la-border, #2a2a30);
}
.composer textarea {
  flex: 1;
  min-height: 38px;
  max-height: 60px;
  padding: 9px 12px;
  resize: none;
  background: var(--la-surface, #1a1a1f);
  border: 1px solid var(--la-border, #2a2a30);
  border-radius: calc(var(--la-radius, 12px) - 4px);
  color: var(--la-text, #f2efe9);
  font: inherit;
  font-size: 14px;
  line-height: 1.4;
  outline: none;
}
.composer textarea:focus {
  border-color: var(--la-muted, #a8a29a);
}
.composer textarea::placeholder {
  color: var(--la-muted, #a8a29a);
}
.action {
  flex-shrink: 0;
  min-height: 38px;
  padding: 9px 16px;
  border: 1px solid var(--la-accent, #e5562a);
  border-radius: calc(var(--la-radius, 12px) - 4px);
  background: var(--la-accent, #e5562a);
  color: var(--la-bg, #0f0f11);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.action:hover {
  filter: brightness(1.08);
}
.action.stop {
  background: transparent;
  border-color: color-mix(in srgb, var(--la-accent, #e5562a) 50%, transparent);
  color: var(--la-accent, #e5562a);
}
.config {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: var(--la-muted, #a8a29a);
  font-size: 14px;
  text-align: center;
}
.config code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--la-text, #f2efe9);
}
.footer {
  flex-shrink: 0;
  padding: 6px 12px 10px;
  text-align: center;
  color: var(--la-muted, #a8a29a);
  font-size: 11px;
}
`;

/**
 * <ledesma-agent>: chat embebible contra el contrato publico del agente (POST {endpoint} con
 * { messages }, respuesta SSE). Atributos: endpoint (requerido), provider-key (opcional),
 * title y placeholder. El historial enviable es transaccional via turns.ts: un turno solo se
 * incorpora cuando termina bien.
 */
export class LedesmaAgentElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['endpoint', 'provider-key', 'title', 'placeholder'];
  }

  private chat: ChatMessage[] = [];
  private running = false;
  private abortController: AbortController | null = null;
  private assistantText = '';
  private turnClosed = false;
  private assistantBubble: HTMLDivElement | null = null;
  private readonly toolChips = new Map<string, HTMLSpanElement>();
  private configured = false;

  private titleEl: HTMLDivElement | null = null;
  private messagesEl: HTMLDivElement | null = null;
  private textareaEl: HTMLTextAreaElement | null = null;
  private actionEl: HTMLButtonElement | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
  }

  disconnectedCallback(): void {
    this.abortController?.abort();
  }

  attributeChangedCallback(name: string): void {
    if (!this.isConnected) return;
    if (name === 'endpoint') {
      // Solo re-monta cuando cambia el modo (configurado <-> sin endpoint); un cambio de URL
      // se toma en el proximo envio sin perder la conversacion en pantalla.
      if ((this.endpoint !== null) !== this.configured) this.render();
      return;
    }
    if (name === 'title' && this.titleEl !== null) this.titleEl.textContent = this.headerTitle;
    if (name === 'placeholder' && this.textareaEl !== null) {
      this.textareaEl.placeholder = this.placeholderText;
    }
  }

  private get endpoint(): string | null {
    const value = this.getAttribute('endpoint');
    if (value === null || value.trim() === '') return null;
    return value.trim();
  }

  private get headerTitle(): string {
    return this.getAttribute('title') ?? 'Asistente';
  }

  private get placeholderText(): string {
    return this.getAttribute('placeholder') ?? 'Escribe un mensaje...';
  }

  /** Re-monta el shadow completo. Resetea el turno en curso y el historial. */
  private render(): void {
    const shadow = this.shadowRoot;
    if (shadow === null) return;
    this.abortController?.abort();
    this.abortController = null;
    this.running = false;
    this.chat = [];
    this.assistantText = '';
    this.turnClosed = false;
    this.assistantBubble = null;
    this.toolChips.clear();
    this.configured = this.endpoint !== null;

    const body = this.configured
      ? '<div class="messages"></div>' +
        '<div class="composer"><textarea rows="1"></textarea><button type="button" class="action"></button></div>'
      : '<div class="config">Falta el atributo <code>endpoint</code></div>';
    shadow.innerHTML =
      `<style>${styles}</style>` +
      `<div class="root"><div class="header"></div>${body}<div class="footer">Impulsado por Ledesma AI Labs</div></div>`;

    this.titleEl = shadow.querySelector<HTMLDivElement>('.header');
    this.messagesEl = shadow.querySelector<HTMLDivElement>('.messages');
    this.textareaEl = shadow.querySelector<HTMLTextAreaElement>('textarea');
    this.actionEl = shadow.querySelector<HTMLButtonElement>('.action');

    // El texto de los atributos entra SIEMPRE via textContent (nunca innerHTML).
    if (this.titleEl !== null) this.titleEl.textContent = this.headerTitle;
    if (this.textareaEl !== null) {
      this.textareaEl.placeholder = this.placeholderText;
      this.textareaEl.addEventListener('keydown', (event) => this.onKeyDown(event));
      this.textareaEl.addEventListener('input', () => this.autoGrow());
    }
    if (this.actionEl !== null) {
      this.actionEl.addEventListener('click', () => this.onAction());
    }
    this.updateAction();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!this.running) void this.send();
    }
  }

  private onAction(): void {
    if (this.running) {
      this.abortController?.abort();
      return;
    }
    void this.send();
  }

  /** El textarea crece de 1 a ~2 lineas y despues scrollea. */
  private autoGrow(): void {
    const textarea = this.textareaEl;
    if (textarea === null) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 60)}px`;
  }

  /** Ejecuta un turno con el texto del composer. Guard si ya hay un turno corriendo. */
  private async send(): Promise<void> {
    const endpoint = this.endpoint;
    const textarea = this.textareaEl;
    if (endpoint === null || textarea === null || this.running) return;
    const content = textarea.value.trim();
    if (content === '') return;
    textarea.value = '';
    this.autoGrow();

    // El request usa el historial confirmado mas este user; chat NO se actualiza todavia.
    const requestChat = buildRequestChat(this.chat, content);
    this.addUserBubble(content);
    this.running = true;
    this.assistantText = '';
    this.turnClosed = false;
    this.assistantBubble = null;
    const controller = new AbortController();
    this.abortController = controller;
    this.updateAction();

    const providerKey = this.getAttribute('provider-key');
    try {
      await streamAgent({
        endpoint,
        providerKey: providerKey === null || providerKey === '' ? undefined : providerKey,
        messages: requestChat,
        signal: controller.signal,
        onMessage: (message) => this.handleMessage(message, content),
      });
      this.closeTurn(content, true);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Turno cancelado por el usuario: la vista conserva el parcial, el historial no.
        this.closeTurn(content, false);
      } else {
        if (!this.turnClosed) {
          this.addErrorBubble('UNKNOWN', 'No se pudo conectar con el agente.');
        }
        this.closeTurn(content, false);
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Cierra el turno una sola vez. El historial enviable es transaccional: solo incorpora el
   * par (user, assistant) cuando el turno termina bien; en error o abort queda como estaba,
   * asi el siguiente envio no produce dos user consecutivos (el proveedor exige alternancia).
   */
  private closeTurn(userText: string, keepText: boolean): void {
    if (!this.turnClosed) {
      this.turnClosed = true;
      if (keepText && this.assistantText !== '') {
        this.chat = commitTurn(this.chat, userText, this.assistantText);
      }
    }
    this.running = false;
    this.assistantBubble = null;
    this.updateAction();
  }

  private handleMessage(message: SseMessage, userText: string): void {
    if (message.kind === 'done') {
      this.closeTurn(userText, true);
      return;
    }
    if (message.kind === 'error') {
      this.addErrorBubble(message.code, message.message);
      this.closeTurn(userText, false);
      return;
    }
    const event = message.event;
    switch (event.type) {
      case 'text_delta':
        this.appendDelta(event.text);
        break;
      case 'tool_use':
        this.addToolChip(event.id, event.name);
        break;
      case 'tool_result':
        if (event.isError) this.toolChips.get(event.toolUseId)?.classList.add('error');
        break;
      case 'stop':
        this.addUsageLine(event.usage.inputTokens, event.usage.outputTokens);
        break;
    }
  }

  private appendNode(node: HTMLElement): void {
    const messages = this.messagesEl;
    if (messages === null) return;
    messages.append(node);
    messages.scrollTop = messages.scrollHeight;
  }

  private addUserBubble(text: string): void {
    const bubble = document.createElement('div');
    bubble.className = 'bubble user';
    bubble.textContent = text;
    this.appendNode(bubble);
  }

  /** Streaming visible: acumula los deltas en la burbuja assistant abierta. */
  private appendDelta(text: string): void {
    this.assistantText += text;
    if (this.assistantBubble === null) {
      this.assistantBubble = document.createElement('div');
      this.assistantBubble.className = 'bubble assistant';
      this.appendNode(this.assistantBubble);
    }
    this.assistantBubble.textContent = (this.assistantBubble.textContent ?? '') + text;
    const messages = this.messagesEl;
    if (messages !== null) messages.scrollTop = messages.scrollHeight;
  }

  private addToolChip(id: string, name: string): void {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = name;
    this.toolChips.set(id, chip);
    // El proximo delta abre una burbuja nueva debajo del chip, como en la consola.
    this.assistantBubble = null;
    this.appendNode(chip);
  }

  private addUsageLine(inputTokens: number, outputTokens: number): void {
    const usage = document.createElement('div');
    usage.className = 'usage';
    usage.textContent = `${inputTokens} in / ${outputTokens} out tokens`;
    this.assistantBubble = null;
    this.appendNode(usage);
  }

  private addErrorBubble(code: string, message?: string): void {
    const bubble = document.createElement('div');
    bubble.className = 'bubble error';
    const codeEl = document.createElement('p');
    codeEl.className = 'error-code';
    codeEl.textContent = code;
    const textEl = document.createElement('p');
    textEl.className = 'error-text';
    textEl.textContent = message ?? 'Revisa la configuracion del agente e intenta de nuevo.';
    bubble.append(codeEl, textEl);
    this.appendNode(bubble);
  }

  private updateAction(): void {
    const action = this.actionEl;
    if (action === null) return;
    action.textContent = this.running ? 'Detener' : 'Enviar';
    action.classList.toggle('stop', this.running);
  }
}
