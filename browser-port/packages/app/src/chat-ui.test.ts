// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChatUI } from './chat-ui.js';

describe('ChatUI', () => {
  let parent: HTMLDivElement;
  let chatUI: ChatUI;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
  });

  afterEach(() => {
    chatUI?.dispose();
    parent.remove();
  });

  it('creates the chat container in the parent element', () => {
    chatUI = new ChatUI(parent);
    expect(parent.querySelector('#chat-ui')).not.toBeNull();
    expect(parent.querySelector('#chat-messages')).not.toBeNull();
    expect(parent.querySelector('#chat-input-container')).not.toBeNull();
  });

  it('opens input when handleKeyDown receives Enter', () => {
    chatUI = new ChatUI(parent);
    expect(chatUI.isInputOpen).toBe(false);

    const consumed = chatUI.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(consumed).toBe(true);
    expect(chatUI.isInputOpen).toBe(true);
  });

  it('does not consume non-Enter keys', () => {
    chatUI = new ChatUI(parent);
    const consumed = chatUI.handleKeyDown(new KeyboardEvent('keydown', { key: 'a' }));
    expect(consumed).toBe(false);
    expect(chatUI.isInputOpen).toBe(false);
  });

  it('closes input on Escape', () => {
    chatUI = new ChatUI(parent);
    chatUI.openInput();
    expect(chatUI.isInputOpen).toBe(true);

    chatUI.closeInput();
    expect(chatUI.isInputOpen).toBe(false);
  });

  it('shows system message in single player mode when sending', () => {
    chatUI = new ChatUI(parent, { isMultiplayer: false });
    chatUI.openInput();
    const input = parent.querySelector('input')! as HTMLInputElement;
    input.value = 'Hello world';
    chatUI.sendMessage();

    const messages = parent.querySelector('#chat-messages')!;
    expect(messages.children.length).toBe(1);
    expect(messages.children[0]!.textContent).toContain('Chat not available in single player');
  });

  it('adds user message in multiplayer mode', () => {
    const onSend = vi.fn();
    chatUI = new ChatUI(parent, { isMultiplayer: true, onSend });
    chatUI.openInput();
    const input = parent.querySelector('input')! as HTMLInputElement;
    input.value = 'Attack now!';
    chatUI.sendMessage();

    const messages = parent.querySelector('#chat-messages')!;
    expect(messages.children.length).toBe(1);
    expect(messages.children[0]!.textContent).toContain('You:');
    expect(messages.children[0]!.textContent).toContain('Attack now!');
    expect(onSend).toHaveBeenCalledWith('Attack now!');
  });

  it('does not send empty messages', () => {
    const onSend = vi.fn();
    chatUI = new ChatUI(parent, { isMultiplayer: true, onSend });
    chatUI.openInput();
    chatUI.sendMessage();

    const messages = parent.querySelector('#chat-messages')!;
    expect(messages.children.length).toBe(0);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('closes input after sending', () => {
    chatUI = new ChatUI(parent, { isMultiplayer: true });
    chatUI.openInput();
    const input = parent.querySelector('input')! as HTMLInputElement;
    input.value = 'Test';
    chatUI.sendMessage();
    expect(chatUI.isInputOpen).toBe(false);
  });

  it('trims excess messages beyond maxVisibleMessages', () => {
    chatUI = new ChatUI(parent, { isMultiplayer: true, maxVisibleMessages: 3 });
    for (let i = 0; i < 5; i++) {
      chatUI.addMessage({ text: `msg ${i}`, sender: 'Player', timestamp: Date.now() });
    }
    const messages = parent.querySelector('#chat-messages')!;
    expect(messages.children.length).toBe(3);
    // The last 3 messages should remain.
    expect(messages.children[0]!.textContent).toContain('msg 2');
    expect(messages.children[2]!.textContent).toContain('msg 4');
  });

  it('dispose removes the container from the DOM', () => {
    chatUI = new ChatUI(parent);
    expect(parent.querySelector('#chat-ui')).not.toBeNull();
    chatUI.dispose();
    expect(parent.querySelector('#chat-ui')).toBeNull();
  });
});
