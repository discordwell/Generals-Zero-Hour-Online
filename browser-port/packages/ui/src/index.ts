/**
 * @generals/ui
 *
 * Browser-side UI runtime with source-aligned ControlBar command primitives.
 * The current rendering remains a lightweight overlay while command flow is
 * ported from `ControlBar` / `InGameUI` interfaces.
 */
import type { Subsystem } from '@generals/engine';

import {
  ControlBarModel,
  type ControlBarActivationResult,
  type ControlBarButton,
  type ControlBarHudSlot,
  type ControlBarCommandTarget,
  type ControlBarSelectionState,
  type IssuedControlBarCommand,
  type PendingControlBarCommand,
  type ControlBarObjectTargetValidator,
} from './control-bar.js';

const MESSAGE_VISIBLE_MS = 4000;

function describeTargetRequirement(
  requirement: ControlBarHudSlot['targetRequirement'],
): string {
  return requirement;
}

export class UiRuntime implements Subsystem {
  readonly name = '@generals/ui';

  private root: HTMLElement | null = null;
  private overlay: HTMLDivElement | null = null;
  private messageNode: HTMLDivElement | null = null;
  private selectedNode: HTMLDivElement | null = null;
  private commandNode: HTMLDivElement | null = null;
  private debugNode: HTMLDivElement | null = null;
  private messageTimeout: ReturnType<typeof setTimeout> | null = null;
  private selectedText = '';
  private selectedObjectIds: number[] = [];
  private debugEnabled = false;
  private containerWidth = 0;
  private containerHeight = 0;
  private readonly flashingControlBarButtonIds = new Set<string>();
  private readonly controlBarModel = new ControlBarModel();

  constructor(options: UiRuntimeOptions = {}) {
    this.debugEnabled = options.enableDebugOverlay ?? false;
    if (options.initialControlBarButtons?.length) {
      this.controlBarModel.setButtons(options.initialControlBarButtons);
    }
  }

  init(_root?: HTMLElement | null): void {
    if (typeof document === 'undefined') {
      return;
    }

    const root = _root ?? document.body;
    if (!root) {
      return;
    }

    this.root = root;
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'right: 0',
      'bottom: 0',
      'z-index: 10',
      'pointer-events: none',
      'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      'font-size: 13px',
      'color: #e8ecff',
      'text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75)',
    ].join(';');

    this.selectedNode = document.createElement('div');
    this.selectedNode.style.cssText = [
      'position: absolute',
      'left: 12px',
      'bottom: 112px',
      'background: rgba(12, 20, 36, 0.58)',
      'border: 1px solid rgba(168, 178, 198, 0.35)',
      'padding: 6px 9px',
      'max-width: 55ch',
    ].join(';');
    this.selectedNode.textContent = 'Selected: <none>';

    this.commandNode = document.createElement('div');
    this.commandNode.style.cssText = [
      'position: absolute',
      'left: 50%',
      'transform: translateX(-50%)',
      'bottom: 18px',
      'background: rgba(7, 10, 18, 0.82)',
      'border: 1px solid rgba(168, 178, 198, 0.35)',
      'padding: 8px 12px',
      'min-width: 280px',
      'max-width: 92vw',
      'line-height: 1.35',
      'white-space: pre-wrap',
    ].join(';');
    this.commandNode.textContent = 'ControlBar: no commands loaded';
    if (!this.debugEnabled) {
      this.commandNode.style.display = 'none';
    }

    this.messageNode = document.createElement('div');
    this.messageNode.style.cssText = [
      'position: absolute',
      'left: 50%',
      'transform: translateX(-50%)',
      'top: 12px',
      'background: rgba(20, 20, 20, 0.74)',
      'border: 1px solid rgba(255, 255, 255, 0.22)',
      'padding: 6px 10px',
      'max-width: 80ch',
      'text-align: center',
      'display: none',
    ].join(';');

    this.debugNode = document.createElement('div');
    this.debugNode.style.cssText = [
      'position: absolute',
      'left: 12px',
      'top: 12px',
      'background: rgba(0, 0, 0, 0.42)',
      'border: 1px solid rgba(0, 0, 0, 0.5)',
      'padding: 6px 10px',
    ].join(';');
    this.debugNode.textContent = 'Debug overlay enabled';
    if (!this.debugEnabled) {
      this.debugNode.style.display = 'none';
    }

    this.overlay.append(this.selectedNode, this.commandNode, this.messageNode, this.debugNode);

    this.root.appendChild(this.overlay);
    this.containerWidth = this.root.clientWidth;
    this.containerHeight = this.root.clientHeight;
    this.resize(this.containerWidth, this.containerHeight);
    this.renderControlBar();
  }

  update(_deltaMs = 16): void {
    void _deltaMs;
    if (!this.overlay || !this.messageNode || !this.selectedNode) {
      return;
    }

    const selection = this.controlBarModel.getSelectionState();
    const selectedName = selection.selectedObjectName || this.selectedText || '<none>';
    const selectedCount = selection.selectedObjectIds.length;
    this.selectedNode.textContent =
      selectedCount > 0
        ? `Selected (${selectedCount}): ${selectedName}`
        : `Selected: ${selectedName}`;

    this.renderControlBar();

    if (this.debugNode && this.debugEnabled) {
      const pending = this.controlBarModel.getPendingCommand();
      const pendingInfo = pending
        ? `${pending.sourceButtonId} (${pending.targetKind})`
        : 'none';
      this.debugNode.textContent = `UI runtime active | pending: ${pendingInfo}`;
    }
  }

  reset(): void {
    this.selectedText = '';
    this.selectedObjectIds = [];
    this.flashingControlBarButtonIds.clear();
    this.controlBarModel.setSelectionState({
      selectedObjectIds: [],
      selectedObjectName: '',
    });
    this.controlBarModel.cancelPendingCommand();
    this.showMessage('');
  }

  dispose(): void {
    if (this.messageTimeout !== null) {
      clearTimeout(this.messageTimeout);
      this.messageTimeout = null;
    }
    if (this.overlay && this.root) {
      this.root.removeChild(this.overlay);
    }
    this.overlay = null;
    this.messageNode = null;
    this.selectedNode = null;
    this.commandNode = null;
    this.debugNode = null;
    this.root = null;
    this.selectedText = '';
    this.selectedObjectIds = [];
    this.flashingControlBarButtonIds.clear();
  }

  resize(_width = 0, _height = 0): void {
    if (!this.overlay || !this.messageNode || !this.selectedNode || !this.commandNode || !_width || !_height) {
      return;
    }

    this.containerWidth = _width;
    this.containerHeight = _height;
    const safeWidth = Math.max(1, _width);
    const safeHeight = Math.max(1, _height);
    const selectedWidth = Math.min(Math.floor(safeWidth * 0.55), 64 * 16);

    this.overlay.style.width = `${safeWidth}px`;
    this.overlay.style.height = `${safeHeight}px`;
    this.selectedNode.style.maxWidth = `${selectedWidth}px`;
    this.messageNode.style.maxWidth = `${Math.min(Math.floor(safeWidth * 0.85), 120 * 16)}px`;
    this.commandNode.style.maxWidth = `${Math.min(Math.floor(safeWidth * 0.92), 140 * 16)}px`;

    const wireframePadding = this.debugEnabled ? 24 : 12;
    if (this.debugNode) {
      this.debugNode.style.top = `${wireframePadding}px`;
      this.debugNode.style.maxWidth = `${Math.min(Math.floor(safeWidth * 0.45), 64 * 16)}px`;
      this.debugNode.style.wordBreak = 'break-word';
      this.debugNode.style.lineHeight = '1.2';
    }

    this.selectedNode.style.left = `${12}px`;
    this.selectedNode.style.bottom = `${Math.max(94, Math.floor(safeHeight * 0.11))}px`;
    this.commandNode.style.bottom = `${Math.max(16, Math.floor(safeHeight * 0.02))}px`;
  }

  showMessage(message: string, durationMs = MESSAGE_VISIBLE_MS): void {
    if (!this.messageNode) {
      return;
    }

    if (this.messageTimeout !== null) {
      clearTimeout(this.messageTimeout);
      this.messageTimeout = null;
    }

    if (!message) {
      this.messageNode.style.display = 'none';
      return;
    }

    this.messageNode.textContent = message;
    this.messageNode.style.display = 'block';
    if (durationMs > 0) {
      this.messageTimeout = setTimeout(() => {
        if (this.messageNode) {
          this.messageNode.style.display = 'none';
        }
        this.messageTimeout = null;
      }, durationMs);
    }
  }

  clearMessage(): void {
    if (!this.messageNode) {
      return;
    }
    if (this.messageTimeout !== null) {
      clearTimeout(this.messageTimeout);
      this.messageTimeout = null;
    }
    this.messageNode.style.display = 'none';
    this.messageNode.textContent = '';
  }

  toggleDebugOverlay(): void {
    this.debugEnabled = !this.debugEnabled;
    if (this.commandNode) {
      this.commandNode.style.display = this.debugEnabled ? '' : 'none';
    }
    if (this.debugNode) {
      this.debugNode.style.display = this.debugEnabled ? '' : 'none';
    }
  }

  getState(): string {
    return this.selectedText;
  }

  setSelectedObjectName(name: string | null): void {
    this.selectedText = name ?? '';
    this.refreshSelectionState();
  }

  setSelectedObjectIds(ids: readonly number[]): void {
    this.selectedObjectIds = [...ids];
    this.refreshSelectionState();
  }

  setSelectionState(selection: ControlBarSelectionState): void {
    this.selectedObjectIds = [...selection.selectedObjectIds];
    this.selectedText = selection.selectedObjectName;
    this.controlBarModel.setSelectionState(selection);
  }

  getSelectionState(): ControlBarSelectionState {
    return this.controlBarModel.getSelectionState();
  }

  setControlBarButtons(buttons: readonly ControlBarButton[]): void {
    this.controlBarModel.setButtons(buttons);
    this.renderControlBar();
  }

  setFlashingControlBarButtons(buttonIds: readonly string[]): void {
    this.flashingControlBarButtonIds.clear();
    for (const buttonId of buttonIds) {
      const normalized = buttonId.trim();
      if (!normalized) {
        continue;
      }
      this.flashingControlBarButtonIds.add(normalized);
    }
    this.renderControlBar();
  }

  getControlBarButtons(): readonly ControlBarButton[] {
    return this.controlBarModel.getButtons();
  }

  getControlBarHudSlots(): ReadonlyArray<ControlBarHudSlot> {
    return this.controlBarModel.getHudSlots();
  }

  getControlBarModel(): ControlBarModel {
    return this.controlBarModel;
  }

  activateControlBarButton(buttonId: string): ControlBarActivationResult {
    const result = this.controlBarModel.activateButton(buttonId);
    this.renderControlBar();
    return result;
  }

  activateControlBarSlot(slot: number): ControlBarActivationResult {
    const result = this.controlBarModel.activateSlot(slot);
    this.renderControlBar();
    return result;
  }

  commitPendingControlBarTarget(target: ControlBarCommandTarget): IssuedControlBarCommand | null {
    const command = this.controlBarModel.commitPendingCommandTarget(target);
    this.renderControlBar();
    return command;
  }

  cancelPendingControlBarCommand(): void {
    this.controlBarModel.cancelPendingCommand();
    this.renderControlBar();
  }

  getPendingControlBarCommand(): PendingControlBarCommand | null {
    return this.controlBarModel.getPendingCommand();
  }

  setControlBarObjectTargetValidator(
    validator: ControlBarObjectTargetValidator | null,
  ): void {
    this.controlBarModel.setObjectTargetValidator(validator);
  }

  consumeIssuedCommands(): IssuedControlBarCommand[] {
    return this.controlBarModel.consumeIssuedCommands();
  }

  private refreshSelectionState(): void {
    this.controlBarModel.setSelectionState({
      selectedObjectIds: this.selectedObjectIds,
      selectedObjectName: this.selectedText,
    });
  }

  private renderControlBar(): void {
    if (!this.commandNode) {
      return;
    }

    const hudSlots = this.controlBarModel.getHudSlots();
    if (hudSlots.every((slot) => slot.state === 'empty')) {
      this.commandNode.textContent = 'ControlBar: no commands loaded';
      return;
    }

    const formatSlot = (slot: ControlBarHudSlot): string => {
      const hotkey = slot.hotkey ? `[${slot.hotkey}] ` : '';
      if (slot.state === 'empty') {
        return `${slot.slot}. ${hotkey}<empty>`;
      }
      const isFlashing = slot.sourceButtonId !== undefined
        && this.flashingControlBarButtonIds.has(slot.sourceButtonId);
      const flashPrefix = isFlashing ? '* ' : '';
      const iconPrefix = slot.iconName ? `[${slot.iconName}] ` : '';
      const disabledSuffix = slot.state === 'disabled' && slot.disabledReason
        ? `, reason=${slot.disabledReason}`
        : '';
      return `${slot.slot}. ${hotkey}${flashPrefix}${iconPrefix}${slot.label} ` +
        `(${slot.state}, ${describeTargetRequirement(slot.targetRequirement)}${disabledSuffix})`;
    };

    const rowLength = 6;
    const lines: string[] = [];
    for (let rowStart = 0; rowStart < hudSlots.length; rowStart += rowLength) {
      const row = hudSlots.slice(rowStart, rowStart + rowLength);
      lines.push(row.map(formatSlot).join(' | '));
    }

    this.commandNode.textContent = `ControlBar\n${lines.join('\n')}`;
  }
}

export function initializeUiOverlay(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.body) {
    document.body.dataset.generalsUiOverlay = 'ready';
  }
}

export interface UiRuntimeOptions {
  enableDebugOverlay?: boolean;
  initialControlBarButtons?: readonly ControlBarButton[];
}

export {
  COMMAND_OPTION_NEED_OBJECT_TARGET,
  COMMAND_OPTION_NEED_TARGET,
  commandOptionMaskFromSourceNames,
  CommandOption,
  ControlBarModel,
  guiCommandTypeFromSourceName,
  GUICommandType,
} from './control-bar.js';

export type {
  ControlBarActivationResult,
  ControlBarButton,
  ControlBarHudSlot,
  ControlBarCommandTarget,
  ControlBarObjectTargetValidator,
  ControlBarSelectionState,
  IssuedControlBarCommand,
  PendingControlBarCommand,
} from './control-bar.js';

export { SaveLoadMenu, installSaveLoadShortcuts } from './save-load-menu.js';
export type { SaveLoadMenuCallbacks } from './save-load-menu.js';

export { CommandCardRenderer } from './command-card-renderer.js';
export type { CommandCardOverlayData } from './command-card-renderer.js';

export { MappedImageResolver } from './mapped-image-resolver.js';
export type { MappedImageEntry } from './mapped-image-resolver.js';

export { MinimapRenderer } from './minimap-renderer.js';
export type {
  MinimapHeightmap,
  MinimapEntity,
  MinimapFogData,
  MinimapCameraBounds,
  MinimapCanvasContext,
  MinimapCanvas,
  MinimapCanvasFactory,
} from './minimap-renderer.js';
