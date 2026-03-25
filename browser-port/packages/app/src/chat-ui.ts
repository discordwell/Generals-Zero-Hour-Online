/**
 * In-game chat UI — text input and floating message display.
 *
 * Press Enter to open the chat input field. Type a message and press Enter to
 * send, or Escape to cancel. Messages display as floating text that fades over
 * 5 seconds.
 *
 * In single-player mode, sending a message shows "Chat not available in single player".
 * Network message dispatch is not yet implemented — this is the UI layer only.
 */

export interface ChatMessage {
  text: string;
  sender: string;
  timestamp: number;
}

export interface ChatUIOptions {
  /** Whether the game is in multiplayer mode. Default: false. */
  isMultiplayer?: boolean;
  /** Message fade duration in milliseconds. Default: 5000. */
  fadeDurationMs?: number;
  /** Maximum number of visible messages. Default: 8. */
  maxVisibleMessages?: number;
  /** Called when a message is sent (for network dispatch). */
  onSend?: (text: string) => void;
}

const DEFAULT_FADE_DURATION_MS = 5000;
const DEFAULT_MAX_VISIBLE = 8;

export class ChatUI {
  private readonly container: HTMLDivElement;
  private readonly messageList: HTMLDivElement;
  private readonly inputContainer: HTMLDivElement;
  private readonly inputField: HTMLInputElement;
  private readonly isMultiplayer: boolean;
  private readonly fadeDurationMs: number;
  private readonly maxVisibleMessages: number;
  private readonly onSend: ((text: string) => void) | null;

  private isOpen = false;
  private messages: Array<ChatMessage & { element: HTMLDivElement; createdAt: number }> = [];
  private animationFrameId: number | null = null;

  constructor(parentElement: HTMLElement, options: ChatUIOptions = {}) {
    this.isMultiplayer = options.isMultiplayer ?? false;
    this.fadeDurationMs = options.fadeDurationMs ?? DEFAULT_FADE_DURATION_MS;
    this.maxVisibleMessages = options.maxVisibleMessages ?? DEFAULT_MAX_VISIBLE;
    this.onSend = options.onSend ?? null;

    // Container — anchored to the bottom-left of the game area.
    this.container = document.createElement('div');
    this.container.id = 'chat-ui';
    Object.assign(this.container.style, {
      position: 'absolute',
      bottom: '80px',
      left: '8px',
      width: '400px',
      maxWidth: '40%',
      zIndex: '200',
      pointerEvents: 'none',
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
    });

    // Message list — floating messages that fade over time.
    this.messageList = document.createElement('div');
    this.messageList.id = 'chat-messages';
    Object.assign(this.messageList.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      marginBottom: '4px',
    });
    this.container.appendChild(this.messageList);

    // Input container — visible only when chat is open.
    this.inputContainer = document.createElement('div');
    this.inputContainer.id = 'chat-input-container';
    Object.assign(this.inputContainer.style, {
      display: 'none',
      pointerEvents: 'auto',
    });

    this.inputField = document.createElement('input');
    this.inputField.type = 'text';
    this.inputField.maxLength = 200;
    this.inputField.placeholder = 'Type a message...';
    Object.assign(this.inputField.style, {
      width: '100%',
      padding: '4px 8px',
      border: '1px solid rgba(0, 200, 0, 0.6)',
      borderRadius: '2px',
      background: 'rgba(0, 0, 0, 0.7)',
      color: '#00ff00',
      fontSize: '13px',
      fontFamily: 'Arial, sans-serif',
      outline: 'none',
      boxSizing: 'border-box',
    });

    this.inputField.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendMessage();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeInput();
      }
    });

    this.inputContainer.appendChild(this.inputField);
    this.container.appendChild(this.inputContainer);
    parentElement.appendChild(this.container);

    this.startFadeLoop();
  }

  /** Handle a keydown event — returns true if the chat consumed the event. */
  handleKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Enter' && !this.isOpen) {
      this.openInput();
      return true;
    }
    return false;
  }

  openInput(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.inputContainer.style.display = 'block';
    this.inputField.value = '';
    this.inputField.focus();
  }

  closeInput(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.inputContainer.style.display = 'none';
    this.inputField.value = '';
    this.inputField.blur();
  }

  get isInputOpen(): boolean {
    return this.isOpen;
  }

  sendMessage(): void {
    const text = this.inputField.value.trim();
    this.closeInput();

    if (text.length === 0) return;

    if (!this.isMultiplayer) {
      this.addMessage({ text: 'Chat not available in single player', sender: 'System', timestamp: Date.now() });
      return;
    }

    const message: ChatMessage = {
      text,
      sender: 'You',
      timestamp: Date.now(),
    };

    this.addMessage(message);

    if (this.onSend) {
      this.onSend(text);
    }
  }

  addMessage(message: ChatMessage): void {
    const element = document.createElement('div');
    Object.assign(element.style, {
      color: message.sender === 'System' ? '#ffcc00' : '#00ff00',
      textShadow: '1px 1px 2px rgba(0,0,0,0.9)',
      padding: '1px 4px',
      background: 'rgba(0, 0, 0, 0.4)',
      borderRadius: '2px',
      transition: `opacity ${this.fadeDurationMs}ms ease-out`,
      opacity: '1',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    });

    const senderSpan = document.createElement('span');
    senderSpan.style.fontWeight = 'bold';
    senderSpan.textContent = `${message.sender}: `;
    element.appendChild(senderSpan);
    element.appendChild(document.createTextNode(message.text));

    this.messageList.appendChild(element);
    const entry = { ...message, element, createdAt: Date.now() };
    this.messages.push(entry);

    // Trim excess messages.
    while (this.messages.length > this.maxVisibleMessages) {
      const oldest = this.messages.shift()!;
      oldest.element.remove();
    }
  }

  private startFadeLoop(): void {
    const tick = (): void => {
      const now = Date.now();
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const msg = this.messages[i]!;
        const elapsed = now - msg.createdAt;
        if (elapsed >= this.fadeDurationMs) {
          msg.element.remove();
          this.messages.splice(i, 1);
        } else if (elapsed >= this.fadeDurationMs * 0.6) {
          // Start fading at 60% of the duration.
          const fadeProgress = (elapsed - this.fadeDurationMs * 0.6) / (this.fadeDurationMs * 0.4);
          msg.element.style.opacity = String(Math.max(0, 1 - fadeProgress));
        }
      }
      this.animationFrameId = requestAnimationFrame(tick);
    };
    this.animationFrameId = requestAnimationFrame(tick);
  }

  dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.container.remove();
  }
}
