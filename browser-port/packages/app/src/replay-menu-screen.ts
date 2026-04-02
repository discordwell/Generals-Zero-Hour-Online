import type { ReplayMetadata } from '@generals/engine';

import { resolveLocalizedText } from './localization.js';

interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MappedImageBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ReplayMenuMappedImageResolver {
  resolve(name: string): Promise<string | null>;
  getEntry?(name: string): MappedImageBounds | undefined;
}

export interface ReplayMenuScreenCallbacks {
  listReplays(): Promise<ReplayMetadata[]>;
  onLoadReplay(replayId: string): Promise<void>;
  onDeleteReplay(replayId: string): Promise<void>;
  onCopyReplay(replayId: string): Promise<void>;
  onClose(): void;
}

const STYLES = `
  .replay-menu-overlay {
    position: absolute;
    inset: 0;
    z-index: 980;
    overflow: hidden;
    font-family: Arial, Helvetica, sans-serif;
    color: #f4f7ff;
    background:
      radial-gradient(circle at 18% 12%, rgba(27, 41, 94, 0.36), transparent 34%),
      linear-gradient(180deg, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 0.82) 100%);
  }
  .replay-menu-source-rect {
    position: absolute;
    box-sizing: border-box;
  }
  .replay-menu-ruler {
    background-repeat: no-repeat;
    background-size: 100% 100%;
    opacity: 0.94;
    pointer-events: none;
  }
  .replay-menu-gadget-parent {
    background: rgba(0, 0, 0, 0.74);
  }
  .replay-menu-panel {
    border: 1px solid rgba(47, 55, 168, 0.94);
    background:
      linear-gradient(180deg, rgba(2, 4, 18, 0.94) 0%, rgba(0, 0, 8, 0.88) 100%);
    box-shadow:
      inset 0 0 0 1px rgba(6, 10, 30, 0.95),
      0 0 24px rgba(0, 0, 0, 0.26);
  }
  .replay-menu-title {
    display: flex;
    align-items: center;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(1rem, 1.5vw, 1.26rem);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #f4f7ff;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.68);
  }
  .replay-menu-divider {
    background: rgba(76, 96, 184, 0.95);
    box-shadow: 0 0 6px rgba(76, 96, 184, 0.35);
  }
  .replay-menu-listbox {
    border: 1px solid rgba(49, 55, 168, 1);
    background: rgba(0, 0, 0, 0.5);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .replay-menu-list-header,
  .replay-menu-row {
    display: grid;
    grid-template-columns: minmax(0, 2.2fr) minmax(0, 1.6fr) minmax(0, 0.8fr) minmax(0, 1.8fr);
    align-items: center;
    column-gap: 0.7rem;
    padding: 0 0.7rem;
  }
  .replay-menu-list-header {
    min-height: 10%;
    border-bottom: 1px solid rgba(48, 64, 140, 0.72);
    color: rgba(214, 222, 246, 0.86);
    font-size: clamp(0.68rem, 0.9vw, 0.8rem);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .replay-menu-list-scroll {
    flex: 1 1 auto;
    overflow-y: auto;
  }
  .replay-menu-row {
    min-height: 16.6%;
    border-bottom: 1px solid rgba(27, 33, 78, 0.82);
    color: #f4f7ff;
    font-size: clamp(0.72rem, 0.96vw, 0.84rem);
    cursor: pointer;
  }
  .replay-menu-row:hover {
    background: rgba(34, 44, 108, 0.32);
  }
  .replay-menu-row.selected {
    background:
      linear-gradient(180deg, rgba(48, 72, 154, 0.62) 0%, rgba(16, 24, 78, 0.86) 100%);
    box-shadow: inset 0 0 0 1px rgba(122, 155, 255, 0.46);
  }
  .replay-menu-row-cell {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .replay-menu-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: rgba(195, 204, 233, 0.7);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .replay-menu-button {
    border: 1px solid rgba(88, 111, 171, 0.92);
    background:
      linear-gradient(180deg, rgba(36, 52, 112, 0.98) 0%, rgba(10, 18, 46, 0.98) 100%);
    box-shadow: inset 0 0 0 1px rgba(5, 9, 17, 0.82);
    color: #f4f7ff;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(0.78rem, 0.96vw, 0.92rem);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .replay-menu-button:hover:not(:disabled) {
    color: #d4ff63;
  }
  .replay-menu-button:disabled {
    color: rgba(98, 108, 146, 0.96);
    background:
      linear-gradient(180deg, rgba(26, 32, 56, 0.96) 0%, rgba(8, 11, 24, 0.98) 100%);
    cursor: default;
  }
  .replay-menu-message {
    display: flex;
    align-items: center;
    color: #d8e1ff;
    font-size: clamp(0.68rem, 0.86vw, 0.78rem);
    letter-spacing: 0.03em;
  }
  .replay-menu-message.error {
    color: #ffb2b2;
  }
`;

const SOURCE_RESOLUTION = { width: 800, height: 600 } as const;
const PARENT_RECT: SourceRect = { x: 0, y: 0, width: 800, height: 600 };
const GADGET_PARENT_RECT: SourceRect = { x: 42, y: 42, width: 717, height: 517 };
const PANEL_RECT: SourceRect = { x: 52, y: 86, width: 697, height: 359 };
const TITLE_RECT: SourceRect = { x: 57, y: 88, width: 480, height: 45 };
const DIVIDER_RECT: SourceRect = { x: 52, y: 134, width: 697, height: 2 };
const LISTBOX_RECT: SourceRect = { x: 68, y: 152, width: 485, height: 277 };
const LOAD_BUTTON_RECT: SourceRect = { x: 563, y: 153, width: 173, height: 37 };
const DELETE_BUTTON_RECT: SourceRect = { x: 563, y: 201, width: 173, height: 37 };
const COPY_BUTTON_RECT: SourceRect = { x: 563, y: 249, width: 173, height: 37 };
const MESSAGE_RECT: SourceRect = { x: 563, y: 304, width: 173, height: 78 };
const BACK_BUTTON_RECT: SourceRect = { x: 563, y: 393, width: 173, height: 37 };
const MAIN_MENU_RULER_IMAGE = 'MainMenuRuler';

function formatSourcePercent(value: number, total: number): string {
  return `${((value / total) * 100).toFixed(6)}%`;
}

function formatSourceRectStyle(rect: SourceRect): string {
  return [
    `left:${formatSourcePercent(rect.x, SOURCE_RESOLUTION.width)}`,
    `top:${formatSourcePercent(rect.y, SOURCE_RESOLUTION.height)}`,
    `width:${formatSourcePercent(rect.width, SOURCE_RESOLUTION.width)}`,
    `height:${formatSourcePercent(rect.height, SOURCE_RESOLUTION.height)}`,
  ].join(';');
}

function formatSourceRectData(rect: SourceRect): string {
  return `${rect.x},${rect.y},${rect.width},${rect.height}`;
}

function buildReplayMapLabel(mapPath: string): string {
  const normalized = mapPath.replace(/\\/g, '/');
  const basename = normalized.split('/').pop() ?? normalized;
  return basename.replace(/\.json$/i, '').trim();
}

function formatReplayVersion(metadata: ReplayMetadata): string {
  return `v${metadata.version}`;
}

function formatReplayTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export class ReplayMenuScreen {
  private readonly root: HTMLElement;
  private readonly callbacks: ReplayMenuScreenCallbacks;
  private overlayEl: HTMLElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private selectedReplayId: string | null = null;
  private replays: ReplayMetadata[] = [];
  private mappedImageResolver: ReplayMenuMappedImageResolver | null = null;
  private localizedStrings: ReadonlyMap<string, string> = new Map();
  private escHandler: ((event: KeyboardEvent) => void) | null = null;
  private messageEl: HTMLElement | null = null;

  constructor(root: HTMLElement, callbacks: ReplayMenuScreenCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
  }

  setMappedImageResolver(resolver: ReplayMenuMappedImageResolver | null): void {
    this.mappedImageResolver = resolver;
    this.refreshArtwork();
  }

  setLocalizedStrings(localizedStrings: ReadonlyMap<string, string>): void {
    this.localizedStrings = localizedStrings;
    this.refreshStaticText();
  }

  get isVisible(): boolean {
    return this.overlayEl !== null;
  }

  show(): void {
    if (this.overlayEl) {
      void this.refreshList();
      return;
    }

    if (!this.styleEl) {
      this.styleEl = document.createElement('style');
      this.styleEl.textContent = STYLES;
      document.head.appendChild(this.styleEl);
    }

    const overlay = document.createElement('div');
    overlay.className = 'replay-menu-overlay';
    overlay.innerHTML = `
      <div
        class="replay-menu-ruler replay-menu-source-rect"
        data-ref="replay-menu-ruler"
        style="${formatSourceRectStyle(PARENT_RECT)}"
      ></div>
      <div
        class="replay-menu-gadget-parent replay-menu-source-rect"
        data-ref="replay-menu-gadget-parent"
        data-source-rect="${formatSourceRectData(GADGET_PARENT_RECT)}"
        style="${formatSourceRectStyle(GADGET_PARENT_RECT)}"
      ></div>
      <div
        class="replay-menu-panel replay-menu-source-rect"
        data-ref="replay-menu-panel"
        data-source-rect="${formatSourceRectData(PANEL_RECT)}"
        style="${formatSourceRectStyle(PANEL_RECT)}"
      ></div>
      <div
        class="replay-menu-title replay-menu-source-rect"
        data-ref="replay-menu-title"
        data-source-rect="${formatSourceRectData(TITLE_RECT)}"
        style="${formatSourceRectStyle(TITLE_RECT)}"
      ></div>
      <div
        class="replay-menu-divider replay-menu-source-rect"
        data-ref="replay-menu-divider"
        data-source-rect="${formatSourceRectData(DIVIDER_RECT)}"
        style="${formatSourceRectStyle(DIVIDER_RECT)}"
      ></div>
      <div
        class="replay-menu-listbox replay-menu-source-rect"
        data-ref="replay-menu-listbox"
        data-source-rect="${formatSourceRectData(LISTBOX_RECT)}"
        style="${formatSourceRectStyle(LISTBOX_RECT)}"
      >
        <div class="replay-menu-list-header">
          <span class="replay-menu-row-cell" data-ref="replay-menu-header-name"></span>
          <span class="replay-menu-row-cell" data-ref="replay-menu-header-date"></span>
          <span class="replay-menu-row-cell" data-ref="replay-menu-header-version"></span>
          <span class="replay-menu-row-cell" data-ref="replay-menu-header-map"></span>
        </div>
        <div class="replay-menu-list-scroll" data-ref="replay-menu-list-scroll"></div>
      </div>
      <button
        class="replay-menu-button replay-menu-source-rect"
        data-action="load"
        data-source-rect="${formatSourceRectData(LOAD_BUTTON_RECT)}"
        style="${formatSourceRectStyle(LOAD_BUTTON_RECT)}"
      ></button>
      <button
        class="replay-menu-button replay-menu-source-rect"
        data-action="delete"
        data-source-rect="${formatSourceRectData(DELETE_BUTTON_RECT)}"
        style="${formatSourceRectStyle(DELETE_BUTTON_RECT)}"
      ></button>
      <button
        class="replay-menu-button replay-menu-source-rect"
        data-action="copy"
        data-source-rect="${formatSourceRectData(COPY_BUTTON_RECT)}"
        style="${formatSourceRectStyle(COPY_BUTTON_RECT)}"
      ></button>
      <div
        class="replay-menu-message replay-menu-source-rect"
        data-ref="replay-menu-message"
        data-source-rect="${formatSourceRectData(MESSAGE_RECT)}"
        style="${formatSourceRectStyle(MESSAGE_RECT)}"
      ></div>
      <button
        class="replay-menu-button replay-menu-source-rect"
        data-action="back"
        data-source-rect="${formatSourceRectData(BACK_BUTTON_RECT)}"
        style="${formatSourceRectStyle(BACK_BUTTON_RECT)}"
      ></button>
    `;

    overlay.addEventListener('click', (event) => {
      const actionTarget = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!actionTarget) {
        return;
      }
      const action = actionTarget.dataset.action;
      if (action === 'load') {
        void this.handleLoad();
      } else if (action === 'delete') {
        void this.handleDelete();
      } else if (action === 'copy') {
        void this.handleCopy();
      } else if (action === 'back') {
        this.hide();
      }
    });

    this.escHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', this.escHandler, true);

    this.root.appendChild(overlay);
    this.overlayEl = overlay;
    this.messageEl = overlay.querySelector<HTMLElement>('[data-ref="replay-menu-message"]');
    this.refreshStaticText();
    this.refreshArtwork();
    this.updateSelectionState();
    void this.refreshList();
  }

  hide(): void {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler, true);
      this.escHandler = null;
    }
    this.messageEl = null;
    this.selectedReplayId = null;
    this.callbacks.onClose();
  }

  private refreshStaticText(): void {
    if (!this.overlayEl) {
      return;
    }
    const setText = (selector: string, value: string): void => {
      const element = this.overlayEl?.querySelector<HTMLElement>(selector);
      if (element) {
        element.textContent = value;
      }
    };

    setText('[data-ref="replay-menu-title"]', this.resolveText('GUI:LoadReplay', 'Load Replay'));
    setText('[data-ref="replay-menu-header-name"]', this.resolveText('GUI:Name', 'Name'));
    setText('[data-ref="replay-menu-header-date"]', this.resolveText('GUI:Date', 'Date'));
    setText('[data-ref="replay-menu-header-version"]', this.resolveText('GUI:Version', 'Version'));
    setText('[data-ref="replay-menu-header-map"]', this.resolveText('GUI:Map', 'Map'));
    setText('[data-action="load"]', this.resolveText('GUI:LoadReplay', 'Load Replay'));
    setText('[data-action="delete"]', this.resolveText('GUI:DeleteReplay', 'Delete Replay'));
    setText('[data-action="copy"]', this.resolveText('GUI:CopyReplay', 'Copy Replay'));
    setText('[data-action="back"]', this.resolveText('GUI:BACK', 'Back'));
  }

  private resolveText(token: string, fallback: string): string {
    const resolved = resolveLocalizedText(token, this.localizedStrings);
    return resolved === token ? fallback : resolved;
  }

  private refreshArtwork(): void {
    if (!this.overlayEl) {
      return;
    }

    this.applyMappedImageBackground(
      this.overlayEl.querySelector<HTMLElement>('[data-ref="replay-menu-ruler"]'),
      MAIN_MENU_RULER_IMAGE,
    );
  }

  private applyMappedImageBackground(
    element: HTMLElement | null,
    imageName: string,
  ): void {
    if (!element || !this.mappedImageResolver) {
      return;
    }

    void this.mappedImageResolver.resolve(imageName).then((url) => {
      if (!url || !this.overlayEl?.contains(element)) {
        return;
      }
      element.style.backgroundImage = `url("${url}")`;
    }).catch(() => {
      element.style.backgroundImage = '';
    });
  }

  private async refreshList(): Promise<void> {
    if (!this.overlayEl) {
      return;
    }

    try {
      this.replays = await this.callbacks.listReplays();
    } catch (error) {
      this.replays = [];
      this.setMessage(error instanceof Error ? error.message : String(error), true);
    }

    const listScroll = this.overlayEl.querySelector<HTMLElement>('[data-ref="replay-menu-list-scroll"]');
    if (!listScroll) {
      return;
    }

    if (!this.replays.some((replay) => replay.replayId === this.selectedReplayId)) {
      this.selectedReplayId = this.replays[0]?.replayId ?? null;
    }

    if (this.replays.length === 0) {
      listScroll.innerHTML = `<div class="replay-menu-empty">${this.resolveText('GUI:NoFileSelected', 'No Replay Files')}</div>`;
    } else {
      listScroll.innerHTML = this.replays.map((replay) => `
        <div class="replay-menu-row${replay.replayId === this.selectedReplayId ? ' selected' : ''}" data-replay-id="${this.escapeHtml(replay.replayId)}">
          <span class="replay-menu-row-cell">${this.escapeHtml(replay.description)}</span>
          <span class="replay-menu-row-cell">${this.escapeHtml(formatReplayTimestamp(replay.timestamp))}</span>
          <span class="replay-menu-row-cell">${this.escapeHtml(formatReplayVersion(replay))}</span>
          <span class="replay-menu-row-cell">${this.escapeHtml(buildReplayMapLabel(replay.mapPath))}</span>
        </div>
      `).join('');

      for (const row of listScroll.querySelectorAll<HTMLElement>('[data-replay-id]')) {
        row.addEventListener('click', () => {
          this.selectedReplayId = row.dataset.replayId ?? null;
          this.updateSelectionState();
        });
        row.addEventListener('dblclick', () => {
          this.selectedReplayId = row.dataset.replayId ?? null;
          this.updateSelectionState();
          void this.handleLoad();
        });
      }
    }

    this.updateSelectionState();
  }

  private updateSelectionState(): void {
    if (!this.overlayEl) {
      return;
    }

    const hasSelection = this.selectedReplayId !== null && this.replays.some((replay) => replay.replayId === this.selectedReplayId);
    for (const row of this.overlayEl.querySelectorAll<HTMLElement>('[data-replay-id]')) {
      row.classList.toggle('selected', row.dataset.replayId === this.selectedReplayId);
    }
    for (const action of ['load', 'delete', 'copy'] as const) {
      const button = this.overlayEl.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
      if (button) {
        button.disabled = !hasSelection;
      }
    }
  }

  private async handleLoad(): Promise<void> {
    if (!this.selectedReplayId) {
      this.setMessage(this.resolveText('GUI:PleaseSelectAFile', 'Please select a replay file.'), true);
      return;
    }

    try {
      await this.callbacks.onLoadReplay(this.selectedReplayId);
    } catch (error) {
      this.setMessage(error instanceof Error ? error.message : String(error), true);
    }
  }

  private async handleDelete(): Promise<void> {
    if (!this.selectedReplayId) {
      this.setMessage(this.resolveText('GUI:PleaseSelectAFile', 'Please select a replay file.'), true);
      return;
    }

    try {
      await this.callbacks.onDeleteReplay(this.selectedReplayId);
      this.setMessage('');
      await this.refreshList();
    } catch (error) {
      this.setMessage(error instanceof Error ? error.message : String(error), true);
    }
  }

  private async handleCopy(): Promise<void> {
    if (!this.selectedReplayId) {
      this.setMessage(this.resolveText('GUI:PleaseSelectAFile', 'Please select a replay file.'), true);
      return;
    }

    try {
      await this.callbacks.onCopyReplay(this.selectedReplayId);
      this.setMessage(this.resolveText('GUI:CopyReplay', 'Replay copied.'));
    } catch (error) {
      this.setMessage(error instanceof Error ? error.message : String(error), true);
    }
  }

  private setMessage(message: string, isError = false): void {
    if (!this.messageEl) {
      return;
    }
    this.messageEl.textContent = message;
    this.messageEl.classList.toggle('error', isError);
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
