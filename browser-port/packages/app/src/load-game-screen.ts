import { SaveFileType, type SaveMetadata } from '@generals/engine';

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

export interface LoadGameMappedImageResolver {
  resolve(name: string): Promise<string | null>;
  getEntry?(name: string): MappedImageBounds | undefined;
}

export interface LoadGameScreenCallbacks {
  listSaves(): Promise<SaveMetadata[]>;
  onImportSave(file: File): Promise<string | void>;
  onExportSave(slotId: string): Promise<void>;
  onLoadSave(slotId: string): Promise<void>;
  onDeleteSave(slotId: string): Promise<void>;
  onClose(): void;
}

const STYLES = `
  .load-game-overlay {
    position: absolute;
    inset: 0;
    z-index: 975;
    overflow: hidden;
    font-family: Arial, Helvetica, sans-serif;
    color: #f4f7ff;
    background:
      radial-gradient(circle at 18% 12%, rgba(27, 41, 94, 0.36), transparent 34%),
      linear-gradient(180deg, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 0.84) 100%);
  }
  .load-game-source-rect {
    position: absolute;
    box-sizing: border-box;
  }
  .load-game-ruler {
    background-repeat: no-repeat;
    background-size: 100% 100%;
    pointer-events: none;
  }
  .load-game-panel {
    border: 1px solid rgba(47, 55, 168, 0.94);
    background:
      linear-gradient(180deg, rgba(4, 7, 18, 0.9) 0%, rgba(0, 0, 8, 0.86) 100%);
    box-shadow:
      inset 0 0 0 1px rgba(6, 10, 30, 0.95),
      0 0 24px rgba(0, 0, 0, 0.24);
  }
  .load-game-title {
    display: flex;
    align-items: center;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(1rem, 1.5vw, 1.22rem);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #f4f7ff;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.68);
  }
  .load-game-listbox {
    border: 1px solid rgba(49, 55, 168, 1);
    background: rgba(0, 0, 0, 0.5);
    overflow-y: auto;
  }
  .load-game-row {
    min-height: 3.75rem;
    border-bottom: 1px solid rgba(27, 33, 78, 0.82);
    padding: 0.55rem 0.7rem;
    cursor: pointer;
  }
  .load-game-row:hover {
    background: rgba(34, 44, 108, 0.32);
  }
  .load-game-row.selected {
    background:
      linear-gradient(180deg, rgba(48, 72, 154, 0.62) 0%, rgba(16, 24, 78, 0.86) 100%);
    box-shadow: inset 0 0 0 1px rgba(122, 155, 255, 0.46);
  }
  .load-game-row.normal-even {
    color: rgb(170, 170, 235);
  }
  .load-game-row.normal-odd {
    color: rgb(255, 255, 255);
  }
  .load-game-row.mission {
    color: rgb(200, 255, 200);
  }
  .load-game-row-title {
    color: inherit;
    font-size: clamp(0.8rem, 0.96vw, 0.88rem);
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .load-game-row-meta {
    margin-top: 0.2rem;
    color: inherit;
    opacity: 0.78;
    font-size: clamp(0.68rem, 0.84vw, 0.76rem);
    line-height: 1.35;
  }
  .load-game-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: rgba(195, 204, 233, 0.7);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .load-game-button {
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
  .load-game-button:hover:not(:disabled) {
    color: #d4ff63;
  }
  .load-game-button:disabled {
    color: rgba(98, 108, 146, 0.96);
    background:
      linear-gradient(180deg, rgba(26, 32, 56, 0.96) 0%, rgba(8, 11, 24, 0.98) 100%);
    cursor: default;
  }
  .load-game-transfer-button {
    font-size: clamp(0.66rem, 0.76vw, 0.72rem);
    letter-spacing: 0.06em;
  }
  .load-game-transfer-status {
    color: rgba(212, 219, 244, 0.82);
    font-size: clamp(0.58rem, 0.72vw, 0.68rem);
    letter-spacing: 0.03em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }
  .load-game-file-input {
    display: none;
  }
  .load-game-dialog {
    border: 1px solid rgba(47, 55, 168, 0.94);
    background:
      linear-gradient(180deg, rgba(6, 10, 24, 0.96) 0%, rgba(1, 3, 10, 0.98) 100%);
    box-shadow:
      inset 0 0 0 1px rgba(6, 10, 30, 0.95),
      0 0 24px rgba(0, 0, 0, 0.3);
  }
  .load-game-dialog[hidden] {
    display: none;
  }
  .load-game-dialog-copy {
    position: absolute;
    left: 12%;
    top: 24%;
    width: 76%;
    color: #d8e1ff;
    text-align: center;
    line-height: 1.4;
    letter-spacing: 0.04em;
  }
`;

const SOURCE_RESOLUTION = { width: 800, height: 600 } as const;
const PARENT_RECT: SourceRect = { x: 0, y: 0, width: 798, height: 599 };
const PANEL_RECT: SourceRect = { x: 40, y: 40, width: 718, height: 518 };
const TITLE_RECT: SourceRect = { x: 54, y: 41, width: 352, height: 44 };
const IMPORT_BUTTON_RECT: SourceRect = { x: 444, y: 52, width: 132, height: 26 };
const EXPORT_BUTTON_RECT: SourceRect = { x: 590, y: 52, width: 132, height: 26 };
const TRANSFER_STATUS_RECT: SourceRect = { x: 444, y: 80, width: 288, height: 14 };
const LISTBOX_RECT: SourceRect = { x: 60, y: 100, width: 672, height: 392 };
const SAVE_BUTTON_RECT: SourceRect = { x: 60, y: 508, width: 156, height: 32 };
const LOAD_BUTTON_RECT: SourceRect = { x: 232, y: 508, width: 156, height: 32 };
const DELETE_BUTTON_RECT: SourceRect = { x: 404, y: 508, width: 157, height: 32 };
const BACK_BUTTON_RECT: SourceRect = { x: 576, y: 508, width: 156, height: 32 };
const LOAD_CONFIRM_RECT: SourceRect = { x: 204, y: 220, width: 388, height: 172 };
const LOAD_CONFIRM_BUTTON_RECT: SourceRect = { x: 268, y: 324, width: 124, height: 32 };
const LOAD_CANCEL_BUTTON_RECT: SourceRect = { x: 412, y: 324, width: 124, height: 32 };
const DELETE_CONFIRM_RECT: SourceRect = { x: 204, y: 220, width: 388, height: 172 };
const DELETE_CONFIRM_BUTTON_RECT: SourceRect = { x: 268, y: 324, width: 124, height: 32 };
const DELETE_CANCEL_BUTTON_RECT: SourceRect = { x: 412, y: 324, width: 124, height: 32 };
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

function formatSaveDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString();
}

function formatSaveTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export class LoadGameScreen {
  private readonly root: HTMLElement;
  private readonly callbacks: LoadGameScreenCallbacks;
  private overlayEl: HTMLElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private selectedSlotId: string | null = null;
  private saves: SaveMetadata[] = [];
  private mappedImageResolver: LoadGameMappedImageResolver | null = null;
  private localizedStrings: ReadonlyMap<string, string> = new Map();
  private escHandler: ((event: KeyboardEvent) => void) | null = null;
  private pendingDialog: 'load' | 'delete' | null = null;

  constructor(root: HTMLElement, callbacks: LoadGameScreenCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
  }

  setMappedImageResolver(resolver: LoadGameMappedImageResolver | null): void {
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
    overlay.className = 'load-game-overlay';
    overlay.innerHTML = `
      <div
        class="load-game-ruler load-game-source-rect"
        data-ref="load-game-ruler"
        style="${formatSourceRectStyle(PARENT_RECT)}"
      ></div>
      <div
        class="load-game-panel load-game-source-rect"
        data-ref="load-game-panel"
        data-source-rect="${formatSourceRectData(PANEL_RECT)}"
        style="${formatSourceRectStyle(PANEL_RECT)}"
      ></div>
      <div
        class="load-game-title load-game-source-rect"
        data-ref="load-game-title"
        data-source-rect="${formatSourceRectData(TITLE_RECT)}"
        style="${formatSourceRectStyle(TITLE_RECT)}"
      ></div>
      <input
        class="load-game-file-input"
        data-ref="load-game-import-input"
        type="file"
        accept=".sav,.save,application/octet-stream"
      />
      <button
        class="load-game-button load-game-transfer-button load-game-source-rect"
        data-action="import"
        data-browser-rect="${formatSourceRectData(IMPORT_BUTTON_RECT)}"
        style="${formatSourceRectStyle(IMPORT_BUTTON_RECT)}"
      ></button>
      <button
        class="load-game-button load-game-transfer-button load-game-source-rect"
        data-action="export"
        data-browser-rect="${formatSourceRectData(EXPORT_BUTTON_RECT)}"
        style="${formatSourceRectStyle(EXPORT_BUTTON_RECT)}"
      ></button>
      <div
        class="load-game-transfer-status load-game-source-rect"
        data-ref="load-game-transfer-status"
        data-browser-rect="${formatSourceRectData(TRANSFER_STATUS_RECT)}"
        style="${formatSourceRectStyle(TRANSFER_STATUS_RECT)}"
      ></div>
      <div
        class="load-game-listbox load-game-source-rect"
        data-ref="load-game-listbox"
        data-source-rect="${formatSourceRectData(LISTBOX_RECT)}"
        style="${formatSourceRectStyle(LISTBOX_RECT)}"
      ></div>
      <button
        class="load-game-button load-game-source-rect"
        data-action="save"
        data-source-rect="${formatSourceRectData(SAVE_BUTTON_RECT)}"
        style="${formatSourceRectStyle(SAVE_BUTTON_RECT)}"
        disabled
      ></button>
      <button
        class="load-game-button load-game-source-rect"
        data-action="load"
        data-source-rect="${formatSourceRectData(LOAD_BUTTON_RECT)}"
        style="${formatSourceRectStyle(LOAD_BUTTON_RECT)}"
      ></button>
      <button
        class="load-game-button load-game-source-rect"
        data-action="delete"
        data-source-rect="${formatSourceRectData(DELETE_BUTTON_RECT)}"
        style="${formatSourceRectStyle(DELETE_BUTTON_RECT)}"
      ></button>
      <button
        class="load-game-button load-game-source-rect"
        data-action="back"
        data-source-rect="${formatSourceRectData(BACK_BUTTON_RECT)}"
        style="${formatSourceRectStyle(BACK_BUTTON_RECT)}"
      ></button>
      <div
        class="load-game-dialog load-game-source-rect"
        data-ref="load-game-load-confirm"
        data-source-rect="${formatSourceRectData(LOAD_CONFIRM_RECT)}"
        style="${formatSourceRectStyle(LOAD_CONFIRM_RECT)}"
        hidden
      >
        <div class="load-game-dialog-copy" data-ref="load-game-load-confirm-copy"></div>
        <button
          class="load-game-button load-game-source-rect"
          data-action="confirm-load"
          style="${formatSourceRectStyle(LOAD_CONFIRM_BUTTON_RECT)}"
        ></button>
        <button
          class="load-game-button load-game-source-rect"
          data-action="cancel-load"
          style="${formatSourceRectStyle(LOAD_CANCEL_BUTTON_RECT)}"
        ></button>
      </div>
      <div
        class="load-game-dialog load-game-source-rect"
        data-ref="load-game-delete-confirm"
        data-source-rect="${formatSourceRectData(DELETE_CONFIRM_RECT)}"
        style="${formatSourceRectStyle(DELETE_CONFIRM_RECT)}"
        hidden
      >
        <div class="load-game-dialog-copy" data-ref="load-game-delete-confirm-copy"></div>
        <button
          class="load-game-button load-game-source-rect"
          data-action="confirm-delete"
          style="${formatSourceRectStyle(DELETE_CONFIRM_BUTTON_RECT)}"
        ></button>
        <button
          class="load-game-button load-game-source-rect"
          data-action="cancel-delete"
          style="${formatSourceRectStyle(DELETE_CANCEL_BUTTON_RECT)}"
        ></button>
      </div>
    `;

    overlay.addEventListener('click', (event) => {
      const actionTarget = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!actionTarget) {
        return;
      }
      const action = actionTarget.dataset.action;
      if (action === 'back') {
        this.hide();
      } else if (action === 'import') {
        this.openImportFilePicker();
      } else if (action === 'export') {
        void this.exportSelectedSave();
      } else if (action === 'load') {
        this.openDialog('load');
      } else if (action === 'delete') {
        this.openDialog('delete');
      } else if (action === 'cancel-load' || action === 'cancel-delete') {
        this.closeDialog();
      } else if (action === 'confirm-load') {
        void this.confirmLoad();
      } else if (action === 'confirm-delete') {
        void this.confirmDelete();
      }
    });

    const importInput = overlay.querySelector<HTMLInputElement>('[data-ref="load-game-import-input"]');
    importInput?.addEventListener('change', () => {
      const file = importInput.files?.[0] ?? null;
      importInput.value = '';
      if (file) {
        void this.importSaveFile(file);
      }
    });

    this.escHandler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (this.pendingDialog) {
        this.closeDialog();
      } else {
        this.hide();
      }
    };
    document.addEventListener('keydown', this.escHandler, true);

    this.root.appendChild(overlay);
    this.overlayEl = overlay;
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
    this.pendingDialog = null;
    this.selectedSlotId = null;
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

    setText('[data-ref="load-game-title"]', this.resolveText('GUI:SelectAGame', 'Select a Game'));
    setText('[data-action="import"]', this.resolveText('GUI:Import', 'Import .sav'));
    setText('[data-action="export"]', this.resolveText('GUI:Export', 'Export .sav'));
    setText('[data-action="save"]', this.resolveText('GUI:SaveGame', 'Save Game'));
    setText('[data-action="load"]', this.resolveText('GUI:LoadGame', 'Load Game'));
    setText('[data-action="delete"]', this.resolveText('GUI:DeleteGame', 'Delete Game'));
    setText('[data-action="back"]', this.resolveText('GUI:Back', 'Back'));
    setText('[data-ref="load-game-load-confirm-copy"]', this.resolveText('GUI:LoadGame', 'Load Game'));
    setText('[data-ref="load-game-delete-confirm-copy"]', this.resolveText('GUI:DeleteGame', 'Delete Game'));
    setText('[data-action="confirm-load"]', this.resolveText('GUI:LoadGame', 'Load Game'));
    setText('[data-action="cancel-load"]', this.resolveText('GUI:Cancel', 'Cancel'));
    setText('[data-action="confirm-delete"]', this.resolveText('GUI:DeleteGame', 'Delete Game'));
    setText('[data-action="cancel-delete"]', this.resolveText('GUI:Cancel', 'Cancel'));
  }

  private resolveText(token: string, fallback: string): string {
    const resolved = resolveLocalizedText(token, this.localizedStrings);
    return resolved === token ? fallback : resolved;
  }

  private formatSaveDisplayLabel(save: SaveMetadata): string {
    if (save.description) {
      return save.description;
    }
    if (save.mapName) {
      return this.resolveText(save.mapName, save.mapName);
    }
    return save.slotId;
  }

  private formatSaveRowClass(save: SaveMetadata, index: number): string {
    if (save.saveFileType === SaveFileType.SAVE_FILE_TYPE_MISSION) {
      return 'mission';
    }
    return index % 2 === 0 ? 'normal-even' : 'normal-odd';
  }

  private refreshArtwork(): void {
    if (!this.overlayEl) {
      return;
    }
    this.applyMappedImageBackground(
      this.overlayEl.querySelector<HTMLElement>('[data-ref="load-game-ruler"]'),
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

    const listbox = this.overlayEl.querySelector<HTMLElement>('[data-ref="load-game-listbox"]');
    if (!listbox) {
      return;
    }

    this.saves = await this.callbacks.listSaves();
    if (!this.saves.some((save) => save.slotId === this.selectedSlotId)) {
      this.selectedSlotId = this.saves[0]?.slotId ?? null;
    }

    if (this.saves.length === 0) {
      listbox.innerHTML = `<div class="load-game-empty">${this.resolveText('GUI:NoFileSelected', 'No Saved Games')}</div>`;
      this.updateSelectionState();
      return;
    }

    listbox.innerHTML = this.saves.map((save, index) => {
      const label = this.formatSaveDisplayLabel(save);
      const time = formatSaveTime(save.timestamp);
      const date = formatSaveDate(save.timestamp);
      const rowClass = this.formatSaveRowClass(save, index);

      return `
        <div class="load-game-row ${rowClass}${save.slotId === this.selectedSlotId ? ' selected' : ''}" data-slot-id="${this.escapeHtml(save.slotId)}">
          <div class="load-game-row-title">${this.escapeHtml(label)}</div>
          <div class="load-game-row-meta">${this.escapeHtml(time)} | ${this.escapeHtml(date)}</div>
        </div>
      `;
    }).join('');

    for (const row of listbox.querySelectorAll<HTMLElement>('[data-slot-id]')) {
      row.addEventListener('click', () => {
        this.selectedSlotId = row.dataset.slotId ?? null;
        this.updateSelectionState();
      });
      row.addEventListener('dblclick', () => {
        this.selectedSlotId = row.dataset.slotId ?? null;
        this.updateSelectionState();
        this.openDialog('load');
      });
    }

    this.updateSelectionState();
  }

  private updateSelectionState(): void {
    if (!this.overlayEl) {
      return;
    }
    const hasSelection = this.selectedSlotId !== null && this.saves.some((save) => save.slotId === this.selectedSlotId);
    for (const row of this.overlayEl.querySelectorAll<HTMLElement>('[data-slot-id]')) {
      row.classList.toggle('selected', row.dataset.slotId === this.selectedSlotId);
    }
    const loadButton = this.overlayEl.querySelector<HTMLButtonElement>('[data-action="load"]');
    if (loadButton) {
      loadButton.disabled = !hasSelection;
    }
    const deleteButton = this.overlayEl.querySelector<HTMLButtonElement>('[data-action="delete"]');
    if (deleteButton) {
      deleteButton.disabled = !hasSelection;
    }
    const exportButton = this.overlayEl.querySelector<HTMLButtonElement>('[data-action="export"]');
    if (exportButton) {
      exportButton.disabled = !hasSelection;
    }
    const saveButton = this.overlayEl.querySelector<HTMLButtonElement>('[data-action="save"]');
    if (saveButton) {
      saveButton.disabled = true;
    }
  }

  private openImportFilePicker(): void {
    const importInput = this.overlayEl?.querySelector<HTMLInputElement>('[data-ref="load-game-import-input"]');
    importInput?.click();
  }

  private async importSaveFile(file: File): Promise<void> {
    try {
      const importedSlotId = await this.callbacks.onImportSave(file);
      if (typeof importedSlotId === 'string' && importedSlotId.length > 0) {
        this.selectedSlotId = importedSlotId;
      }
      await this.refreshList();
      this.setTransferStatus(`Imported ${file.name}`);
    } catch (error) {
      this.setTransferStatus(error instanceof Error ? error.message : String(error));
    }
  }

  private async exportSelectedSave(): Promise<void> {
    if (!this.selectedSlotId) {
      return;
    }
    try {
      await this.callbacks.onExportSave(this.selectedSlotId);
      this.setTransferStatus(`Exported ${this.selectedSlotId}.sav`);
    } catch (error) {
      this.setTransferStatus(error instanceof Error ? error.message : String(error));
    }
  }

  private openDialog(kind: 'load' | 'delete'): void {
    if (!this.selectedSlotId || !this.overlayEl) {
      return;
    }
    this.pendingDialog = kind;
    if (kind === 'load') {
      this.setDialogCopy('load', this.resolveText('GUI:LoadGame', 'Load Game'));
    } else {
      this.setDialogCopy('delete', this.resolveText('GUI:DeleteGame', 'Delete Game'));
    }
    const loadDialog = this.overlayEl.querySelector<HTMLElement>('[data-ref="load-game-load-confirm"]');
    const deleteDialog = this.overlayEl.querySelector<HTMLElement>('[data-ref="load-game-delete-confirm"]');
    if (loadDialog) {
      loadDialog.hidden = kind !== 'load';
    }
    if (deleteDialog) {
      deleteDialog.hidden = kind !== 'delete';
    }
  }

  private closeDialog(): void {
    if (!this.overlayEl) {
      return;
    }
    this.pendingDialog = null;
    const loadDialog = this.overlayEl.querySelector<HTMLElement>('[data-ref="load-game-load-confirm"]');
    const deleteDialog = this.overlayEl.querySelector<HTMLElement>('[data-ref="load-game-delete-confirm"]');
    if (loadDialog) {
      loadDialog.hidden = true;
    }
    if (deleteDialog) {
      deleteDialog.hidden = true;
    }
  }

  private async confirmLoad(): Promise<void> {
    if (!this.selectedSlotId) {
      return;
    }
    try {
      await this.callbacks.onLoadSave(this.selectedSlotId);
      this.closeDialog();
    } catch (error) {
      this.setDialogCopy('load', error instanceof Error ? error.message : String(error));
    }
  }

  private async confirmDelete(): Promise<void> {
    if (!this.selectedSlotId) {
      return;
    }
    try {
      await this.callbacks.onDeleteSave(this.selectedSlotId);
      this.closeDialog();
      await this.refreshList();
    } catch (error) {
      this.setDialogCopy('delete', error instanceof Error ? error.message : String(error));
    }
  }

  private setDialogCopy(kind: 'load' | 'delete', message: string): void {
    const element = this.overlayEl?.querySelector<HTMLElement>(
      kind === 'load' ? '[data-ref="load-game-load-confirm-copy"]' : '[data-ref="load-game-delete-confirm-copy"]',
    );
    if (element) {
      element.textContent = message;
    }
  }

  private setTransferStatus(message: string): void {
    const element = this.overlayEl?.querySelector<HTMLElement>('[data-ref="load-game-transfer-status"]');
    if (element) {
      element.textContent = message;
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
