/**
 * Command card button UI renderer.
 *
 * Creates a 4-column x 3-row grid of DOM button elements that mirror the
 * C++ ControlBar HUD panel rendered on the right side of the in-game screen.
 * Each button displays an icon placeholder, a label, and a hotkey indicator.
 * The renderer synchronises visual state from `ControlBarModel.getHudSlots()`
 * each frame via `sync()`.
 */

import {
  ControlBarModel,
  type ControlBarHudSlot,
} from './control-bar.js';

/** Number of command card slots (source: SOURCE_CONTROL_BAR_SLOT_COUNT). */
const SLOT_COUNT = 12;
/** Grid column count matching C++ 4-column layout. */
const COLUMNS = 4;
/** Individual button dimension in pixels. */
const BUTTON_SIZE = 48;

// -- Colours (source-aligned palette) ----------------------------------------
const COLOR_BG = '#1a1a1a';
const COLOR_BORDER_ENABLED = '#3c8c3c';
const COLOR_BORDER_DISABLED = '#555555';
const COLOR_BORDER_PENDING = '#d4a017';
const COLOR_BORDER_EMPTY = '#333333';
const COLOR_TEXT = '#e8ecff';
const COLOR_TEXT_DISABLED = '#777777';
const COLOR_HOTKEY_BG = 'rgba(0,0,0,0.65)';
const COLOR_OVERLAY_PRODUCTION = 'rgba(60,140,60,0.45)';
const COLOR_OVERLAY_COOLDOWN = 'rgba(40,80,180,0.45)';

function borderColorForState(state: ControlBarHudSlot['state']): string {
  switch (state) {
    case 'ready':
      return COLOR_BORDER_ENABLED;
    case 'disabled':
      return COLOR_BORDER_DISABLED;
    case 'pending':
      return COLOR_BORDER_PENDING;
    case 'empty':
    default:
      return COLOR_BORDER_EMPTY;
  }
}

// ---------------------------------------------------------------------------
// Internal per-slot DOM structure
// ---------------------------------------------------------------------------

interface SlotElements {
  /** Outer button element. */
  button: HTMLButtonElement;
  /** Icon <img> (hidden when no texture name). */
  icon: HTMLImageElement;
  /** Label text element. */
  label: HTMLSpanElement;
  /** Hotkey badge (top-right corner). */
  hotkey: HTMLSpanElement;
  /** Progress overlay bar (production queue). */
  progressOverlay: HTMLDivElement;
  /** Cooldown overlay bar (special powers). */
  cooldownOverlay: HTMLDivElement;
}

function createSlotElements(slotIndex: number): SlotElements {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.slot = String(slotIndex);
  button.style.cssText = [
    'position: relative',
    `width: ${BUTTON_SIZE}px`,
    `height: ${BUTTON_SIZE}px`,
    `background: ${COLOR_BG}`,
    `border: 1px solid ${COLOR_BORDER_EMPTY}`,
    'padding: 0',
    'margin: 0',
    'cursor: pointer',
    'overflow: hidden',
    'display: flex',
    'flex-direction: column',
    'align-items: center',
    'justify-content: center',
    `color: ${COLOR_TEXT}`,
    'font-family: inherit',
    'font-size: 9px',
    'line-height: 1.1',
    'box-sizing: border-box',
  ].join(';');

  const icon = document.createElement('img');
  icon.style.cssText = [
    'width: 28px',
    'height: 28px',
    'object-fit: contain',
    'display: none',
    'pointer-events: none',
  ].join(';');
  icon.alt = '';

  const label = document.createElement('span');
  label.style.cssText = [
    'display: block',
    'max-width: 100%',
    'overflow: hidden',
    'text-overflow: ellipsis',
    'white-space: nowrap',
    'font-size: 8px',
    'padding: 0 2px',
    'pointer-events: none',
  ].join(';');

  const hotkey = document.createElement('span');
  hotkey.style.cssText = [
    'position: absolute',
    'top: 1px',
    'right: 1px',
    'font-size: 8px',
    'font-weight: bold',
    `background: ${COLOR_HOTKEY_BG}`,
    'padding: 0 2px',
    'pointer-events: none',
    'display: none',
  ].join(';');

  const progressOverlay = document.createElement('div');
  progressOverlay.className = 'ccr-progress';
  progressOverlay.style.cssText = [
    'position: absolute',
    'bottom: 0',
    'left: 0',
    'width: 100%',
    'height: 0%',
    `background: ${COLOR_OVERLAY_PRODUCTION}`,
    'pointer-events: none',
    'display: none',
  ].join(';');

  const cooldownOverlay = document.createElement('div');
  cooldownOverlay.className = 'ccr-cooldown';
  cooldownOverlay.style.cssText = [
    'position: absolute',
    'top: 0',
    'left: 0',
    'width: 100%',
    'height: 0%',
    `background: ${COLOR_OVERLAY_COOLDOWN}`,
    'pointer-events: none',
    'display: none',
  ].join(';');

  button.append(icon, label, hotkey, progressOverlay, cooldownOverlay);
  return { button, icon, label, hotkey, progressOverlay, cooldownOverlay };
}

// ---------------------------------------------------------------------------
// Extended HUD slot data for overlays
// ---------------------------------------------------------------------------

/**
 * Optional per-slot overlay data that may be attached externally.
 * The core `ControlBarHudSlot` does not carry production/cooldown
 * fields, so callers can supply them through `setOverlayData`.
 */
export interface CommandCardOverlayData {
  /** 0..1 production build progress (0 = empty, 1 = complete). */
  productionProgress?: number;
  /** 0..1 cooldown remaining (0 = ready, 1 = fully on cooldown). */
  cooldownPercent?: number;
}

// ---------------------------------------------------------------------------
// CommandCardRenderer
// ---------------------------------------------------------------------------

export interface CommandCardRendererOptions {
  /** Called when a slot button is clicked (1-based slot index). */
  onSlotActivated?: (slot: number) => void;
}

export class CommandCardRenderer {
  private readonly container: HTMLElement;
  private readonly controlBar: ControlBarModel;
  private readonly grid: HTMLDivElement;
  private readonly slots: SlotElements[] = [];
  private readonly overlayData: (CommandCardOverlayData | null)[] = new Array(
    SLOT_COUNT,
  ).fill(null);
  private readonly onSlotActivated?: (slot: number) => void;
  private disposed = false;

  constructor(container: HTMLElement, controlBar: ControlBarModel, options?: CommandCardRendererOptions) {
    this.container = container;
    this.controlBar = controlBar;
    this.onSlotActivated = options?.onSlotActivated;

    // Create grid wrapper
    this.grid = document.createElement('div');
    this.grid.className = 'command-card-grid';
    this.grid.style.cssText = [
      'display: grid',
      `grid-template-columns: repeat(${COLUMNS}, 1fr)`,
      'gap: 2px',
      `width: ${COLUMNS * BUTTON_SIZE + (COLUMNS - 1) * 2}px`,
      `background: ${COLOR_BG}`,
      'padding: 2px',
      'box-sizing: content-box',
    ].join(';');

    // Create 12 slot buttons (1-indexed to match source)
    for (let i = 1; i <= SLOT_COUNT; i++) {
      const slotEl = createSlotElements(i);
      this.slots.push(slotEl);

      // Capture slot index for click handler
      const slotIndex = i;
      slotEl.button.addEventListener('click', () => {
        if (this.disposed) {
          return;
        }
        // Only activate if the slot is in a clickable state
        const hudSlots = this.controlBar.getHudSlots();
        const hudSlot = hudSlots[slotIndex - 1];
        if (hudSlot && (hudSlot.state === 'ready' || hudSlot.state === 'pending')) {
          if (this.onSlotActivated) {
            this.onSlotActivated(slotIndex);
          } else {
            this.controlBar.activateSlot(slotIndex);
          }
        }
      });

      this.grid.appendChild(slotEl.button);
    }

    this.container.appendChild(this.grid);

    // Initial sync
    this.sync();
  }

  /**
   * Set overlay data (production progress / cooldown) for a slot.
   * @param slot 1-based slot index
   */
  setOverlayData(slot: number, data: CommandCardOverlayData | null): void {
    if (slot >= 1 && slot <= SLOT_COUNT) {
      this.overlayData[slot - 1] = data;
    }
  }

  /**
   * Synchronise button visuals from current ControlBar HUD slot state.
   * Call once per frame (or when the command card changes).
   */
  sync(): void {
    if (this.disposed) {
      return;
    }

    const hudSlots = this.controlBar.getHudSlots();

    for (let i = 0; i < SLOT_COUNT; i++) {
      const hud = hudSlots[i];
      const el = this.slots[i];
      if (!hud || !el) {
        continue;
      }

      // -- State / border --
      el.button.style.borderColor = borderColorForState(hud.state);
      el.button.disabled = hud.state === 'empty' || hud.state === 'disabled';
      el.button.style.cursor =
        hud.state === 'ready' || hud.state === 'pending' ? 'pointer' : 'default';
      el.button.style.opacity = hud.state === 'disabled' ? '0.55' : '1';

      // -- Label --
      const displayLabel = hud.label.replace(/&/g, '');
      el.label.textContent = displayLabel;
      el.label.style.color =
        hud.state === 'disabled' ? COLOR_TEXT_DISABLED : COLOR_TEXT;

      // -- Icon --
      if (hud.iconName) {
        el.icon.src = hud.iconName;
        el.icon.style.display = 'block';
      } else {
        el.icon.style.display = 'none';
        el.icon.removeAttribute('src');
      }

      // -- Hotkey --
      if (hud.hotkey) {
        el.hotkey.textContent = hud.hotkey.toUpperCase();
        el.hotkey.style.display = 'block';
      } else {
        el.hotkey.style.display = 'none';
      }

      // -- Tooltip (title) --
      if (hud.state !== 'empty') {
        const parts = [displayLabel];
        if (hud.hotkey) {
          parts.push(`[${hud.hotkey.toUpperCase()}]`);
        }
        if (hud.disabledReason) {
          parts.push(`(${hud.disabledReason})`);
        }
        el.button.title = parts.join(' ');
      } else {
        el.button.title = '';
      }

      // -- Production progress overlay --
      const overlay = this.overlayData[i];
      const progress = overlay?.productionProgress;
      if (progress !== undefined && progress > 0 && progress <= 1) {
        el.progressOverlay.style.display = 'block';
        el.progressOverlay.style.height = `${Math.round(progress * 100)}%`;
      } else {
        el.progressOverlay.style.display = 'none';
        el.progressOverlay.style.height = '0%';
      }

      // -- Cooldown overlay --
      const cooldown = overlay?.cooldownPercent;
      if (cooldown !== undefined && cooldown > 0 && cooldown <= 1) {
        el.cooldownOverlay.style.display = 'block';
        el.cooldownOverlay.style.height = `${Math.round(cooldown * 100)}%`;
      } else {
        el.cooldownOverlay.style.display = 'none';
        el.cooldownOverlay.style.height = '0%';
      }
    }
  }

  /**
   * Remove all DOM elements created by this renderer.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    for (const slot of this.slots) {
      slot.button.remove();
    }
    this.grid.remove();
    this.slots.length = 0;
  }

  /** Return the grid wrapper element (for positioning / styling). */
  getElement(): HTMLDivElement {
    return this.grid;
  }
}
