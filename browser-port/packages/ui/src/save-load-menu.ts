/**
 * Save/Load menu component.
 *
 * Source parity: Generals/Code/GameClient/GUI/GUICallbacks/SaveLoadMenuCallbacks.cpp
 *
 * Pure DOM component for saving and loading game state.
 * Displays a slot list, description input, and action buttons.
 * Supports keyboard shortcuts: F5 quicksave, F9 quickload.
 */

import type { SaveMetadata } from '@generals/engine';

export interface SaveLoadMenuCallbacks {
  onSave(slotId: string, description: string): Promise<void>;
  onLoad(slotId: string): Promise<void>;
  onDelete(slotId: string): Promise<void>;
  onDownload(slotId: string): Promise<void>;
  onUpload(file: File): Promise<void>;
  onClose(): void;
  listSaves(): Promise<SaveMetadata[]>;
}

export class SaveLoadMenu {
  private container: HTMLDivElement | null = null;
  private slotList: HTMLDivElement | null = null;
  private descriptionInput: HTMLInputElement | null = null;
  private selectedSlotId: string | null = null;
  private callbacks: SaveLoadMenuCallbacks;
  private visible = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(callbacks: SaveLoadMenuCallbacks) {
    this.callbacks = callbacks;
  }

  isVisible(): boolean {
    return this.visible;
  }

  async show(parentElement: HTMLElement): Promise<void> {
    if (this.container) {
      this.hide();
    }

    this.visible = true;
    this.container = document.createElement('div');
    this.container.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'right: 0',
      'bottom: 0',
      'z-index: 1000',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'background: rgba(0, 0, 0, 0.7)',
      'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      'font-size: 13px',
      'color: #e8ecff',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'background: #1a1e2e',
      'border: 1px solid #3a4060',
      'padding: 20px',
      'min-width: 480px',
      'max-width: 640px',
      'max-height: 80vh',
      'overflow: hidden',
      'display: flex',
      'flex-direction: column',
      'gap: 12px',
    ].join(';');

    // Title
    const title = document.createElement('h2');
    title.textContent = 'Save / Load Game';
    title.style.cssText = 'margin: 0; font-size: 16px; color: #c0c8e0;';
    panel.appendChild(title);

    // Slot list
    this.slotList = document.createElement('div');
    this.slotList.style.cssText = [
      'flex: 1',
      'overflow-y: auto',
      'max-height: 300px',
      'border: 1px solid #2a2e40',
      'background: #12162a',
    ].join(';');
    panel.appendChild(this.slotList);

    // Description input
    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display: flex; gap: 8px; align-items: center;';

    const label = document.createElement('span');
    label.textContent = 'Description:';
    label.style.cssText = 'white-space: nowrap;';

    this.descriptionInput = document.createElement('input');
    this.descriptionInput.type = 'text';
    this.descriptionInput.placeholder = 'Enter save description...';
    this.descriptionInput.style.cssText = [
      'flex: 1',
      'background: #0a0e1a',
      'border: 1px solid #3a4060',
      'color: #e8ecff',
      'padding: 6px 8px',
      'font-family: inherit',
      'font-size: 13px',
    ].join(';');

    inputRow.appendChild(label);
    inputRow.appendChild(this.descriptionInput);
    panel.appendChild(inputRow);

    // Buttons row
    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

    const btnStyle = [
      'background: #2a3050',
      'border: 1px solid #4a5080',
      'color: #e8ecff',
      'padding: 6px 14px',
      'cursor: pointer',
      'font-family: inherit',
      'font-size: 12px',
    ].join(';');

    const saveBtn = this.createButton('Save', btnStyle, () => this.handleSave());
    const loadBtn = this.createButton('Load', btnStyle, () => this.handleLoad());
    const deleteBtn = this.createButton('Delete', btnStyle, () => this.handleDelete());
    const downloadBtn = this.createButton('Download', btnStyle, () => this.handleDownload());

    const uploadBtn = this.createButton('Upload', btnStyle, () => this.handleUpload());
    const closeBtn = this.createButton('Close [Esc]', btnStyle, () => this.hide());

    buttonRow.append(saveBtn, loadBtn, deleteBtn, downloadBtn, uploadBtn, closeBtn);
    panel.appendChild(buttonRow);

    // Hint
    const hint = document.createElement('div');
    hint.textContent = 'F5 = Quick Save | F9 = Quick Load';
    hint.style.cssText = 'color: #6a7090; font-size: 11px; text-align: center;';
    panel.appendChild(hint);

    this.container.appendChild(panel);
    parentElement.appendChild(this.container);

    // Keyboard handler
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    };
    document.addEventListener('keydown', this.keyHandler);

    // Populate slot list
    await this.refreshSlotList();
  }

  hide(): void {
    this.visible = false;
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    this.slotList = null;
    this.descriptionInput = null;
    this.selectedSlotId = null;

    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }

    this.callbacks.onClose();
  }

  async refreshSlotList(): Promise<void> {
    if (!this.slotList) return;

    const saves = await this.callbacks.listSaves();
    this.slotList.innerHTML = '';

    if (saves.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No saved games';
      empty.style.cssText = 'padding: 12px; color: #6a7090; text-align: center;';
      this.slotList.appendChild(empty);
      return;
    }

    for (const save of saves) {
      const row = document.createElement('div');
      row.style.cssText = [
        'padding: 8px 12px',
        'cursor: pointer',
        'border-bottom: 1px solid #1e2238',
      ].join(';');

      row.addEventListener('mouseenter', () => {
        if (this.selectedSlotId !== save.slotId) {
          row.style.background = '#1e2240';
        }
      });
      row.addEventListener('mouseleave', () => {
        if (this.selectedSlotId !== save.slotId) {
          row.style.background = '';
        }
      });

      row.addEventListener('click', () => {
        this.selectSlot(save.slotId);
      });

      const date = new Date(save.timestamp);
      const dateStr = date.toLocaleString();
      const sizeKb = (save.sizeBytes / 1024).toFixed(1);

      row.innerHTML = `
        <div style="font-weight: bold;">${save.slotId}</div>
        <div style="color: #8890b0; font-size: 12px;">${save.description} | ${dateStr} | ${sizeKb} KB</div>
      `;
      row.dataset.slotId = save.slotId;

      this.slotList.appendChild(row);
    }
  }

  private selectSlot(slotId: string): void {
    this.selectedSlotId = slotId;
    if (!this.slotList) return;

    for (const row of this.slotList.children) {
      const el = row as HTMLElement;
      el.style.background = el.dataset.slotId === slotId ? '#2a3060' : '';
    }

    if (this.descriptionInput) {
      this.descriptionInput.value = slotId;
    }
  }

  private createButton(text: string, style: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = style;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private async handleSave(): Promise<void> {
    const description = this.descriptionInput?.value || 'Quick Save';
    const slotId = this.selectedSlotId || `save-${Date.now()}`;
    await this.callbacks.onSave(slotId, description);
    await this.refreshSlotList();
  }

  private async handleLoad(): Promise<void> {
    if (!this.selectedSlotId) return;
    await this.callbacks.onLoad(this.selectedSlotId);
    this.hide();
  }

  private async handleDelete(): Promise<void> {
    if (!this.selectedSlotId) return;
    await this.callbacks.onDelete(this.selectedSlotId);
    this.selectedSlotId = null;
    await this.refreshSlotList();
  }

  private async handleDownload(): Promise<void> {
    if (!this.selectedSlotId) return;
    await this.callbacks.onDownload(this.selectedSlotId);
  }

  private handleUpload(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sav';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) {
        await this.callbacks.onUpload(file);
        await this.refreshSlotList();
      }
    });
    input.click();
  }
}

/**
 * Install global keyboard shortcuts for quicksave/quickload.
 * Returns a cleanup function to remove the listener.
 */
export function installSaveLoadShortcuts(
  onQuickSave: () => void,
  onQuickLoad: () => void,
): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'F5') {
      e.preventDefault();
      onQuickSave();
    } else if (e.key === 'F9') {
      e.preventDefault();
      onQuickLoad();
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}
