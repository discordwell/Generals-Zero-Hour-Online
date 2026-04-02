/**
 * Command card button UI renderer.
 *
 * Creates the retail 7-column x 2-row command grid from `ControlBar.wnd`.
 * C++ ControlBar HUD panel rendered on the right side of the in-game screen.
 * Each button displays an icon placeholder, a label, and a hotkey indicator.
 * The renderer synchronises visual state from `ControlBarModel.getHudSlots()`
 * each frame via `sync()`.
 */

import {
  ControlBarModel,
  type ControlBarHudSlot,
} from './control-bar.js';
import type { MappedImageResolver } from './mapped-image-resolver.js';

/** Number of visible command card slots. Source parity: ZH has 14 visible (of 18 internal). */
const SLOT_COUNT = 14;
/** Source parity: retail `ControlBar.wnd` exposes 7 command columns. */
const COLUMNS = 7;
/** Source parity: retail `ControlBar.wnd` command slots occupy 2 rows. */
const ROWS = 2;
/** Source parity: command buttons are 50x44 at 800x600 creation resolution. */
const BUTTON_WIDTH = 50;
const BUTTON_HEIGHT = 44;
/** Source parity: adjacent command buttons are spaced by 5 px horizontally and 7 px vertically. */
const COLUMN_GAP = 5;
const ROW_GAP = 7;

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

export function resolveRetailCommandGridPosition(slotIndex: number): { column: number; row: number } {
  const clampedSlot = Math.max(1, Math.min(SLOT_COUNT, Math.trunc(slotIndex)));
  return {
    column: Math.floor((clampedSlot - 1) / 2) + 1,
    row: clampedSlot % 2 === 1 ? 1 : 2,
  };
}

function createSlotElements(slotIndex: number): SlotElements {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.slot = String(slotIndex);
  const sourceGridPosition = resolveRetailCommandGridPosition(slotIndex);
  button.style.cssText = [
    'position: relative',
    `width: ${BUTTON_WIDTH}px`,
    `height: ${BUTTON_HEIGHT}px`,
    `grid-column: ${sourceGridPosition.column}`,
    `grid-row: ${sourceGridPosition.row}`,
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
    'font-size: 8px',
    'line-height: 1.1',
    'box-sizing: border-box',
  ].join(';');

  const icon = document.createElement('img');
  icon.style.cssText = [
    'width: 26px',
    'height: 26px',
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
    'font-size: 7px',
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
  /** Number of items queued for this slot (shown as badge when > 1). */
  queueCount?: number;
}

// ---------------------------------------------------------------------------
// CommandCardRenderer
// ---------------------------------------------------------------------------

export interface CommandCardRendererOptions {
  /** Called when a slot button is clicked (1-based slot index, count=5 when Ctrl/Cmd held). */
  onSlotActivated?: (slot: number, count: number) => void;
  /** Called when a slot button is right-clicked (1-based slot index). */
  onSlotRightClicked?: (slot: number) => void;
  /** Optional MappedImage resolver for rendering button icons from atlas textures. */
  mappedImageResolver?: MappedImageResolver;
}

export class CommandCardRenderer {
  private readonly container: HTMLElement;
  private readonly controlBar: ControlBarModel;
  private readonly grid: HTMLDivElement;
  private readonly slots: SlotElements[] = [];
  private readonly overlayData: (CommandCardOverlayData | null)[] = new Array(
    SLOT_COUNT,
  ).fill(null);
  private readonly onSlotActivated?: (slot: number, count: number) => void;
  private readonly onSlotRightClicked?: (slot: number) => void;
  private readonly mappedImageResolver?: MappedImageResolver;
  /** Tracks the last iconName set per slot to avoid redundant resolve calls. */
  private readonly slotIconNames: (string | undefined)[] = new Array(SLOT_COUNT).fill(undefined);
  private disposed = false;

  constructor(container: HTMLElement, controlBar: ControlBarModel, options?: CommandCardRendererOptions) {
    this.container = container;
    this.controlBar = controlBar;
    this.onSlotActivated = options?.onSlotActivated;
    this.onSlotRightClicked = options?.onSlotRightClicked;
    this.mappedImageResolver = options?.mappedImageResolver;

    // Create grid wrapper
    this.grid = document.createElement('div');
    this.grid.className = 'command-card-grid';
    this.grid.style.cssText = [
      'display: grid',
      `grid-template-columns: repeat(${COLUMNS}, ${BUTTON_WIDTH}px)`,
      `grid-template-rows: repeat(${ROWS}, ${BUTTON_HEIGHT}px)`,
      `column-gap: ${COLUMN_GAP}px`,
      `row-gap: ${ROW_GAP}px`,
      `width: ${COLUMNS * BUTTON_WIDTH + (COLUMNS - 1) * COLUMN_GAP}px`,
      `height: ${ROWS * BUTTON_HEIGHT + (ROWS - 1) * ROW_GAP}px`,
      `background: ${COLOR_BG}`,
      'padding: 0',
      'box-sizing: content-box',
    ].join(';');

    // Create 14 visible slots (1-indexed to match source)
    for (let i = 1; i <= SLOT_COUNT; i++) {
      const slotEl = createSlotElements(i);
      this.slots.push(slotEl);

      // Capture slot index for click handler
      const slotIndex = i;
      slotEl.button.addEventListener('click', (e: MouseEvent) => {
        if (this.disposed) {
          return;
        }
        // Only activate if the slot is in a clickable state
        const hudSlots = this.controlBar.getHudSlots();
        const hudSlot = hudSlots[slotIndex - 1];
        if (hudSlot && (hudSlot.state === 'ready' || hudSlot.state === 'pending')) {
          // Source parity: Ctrl+click queues 5 units at once (C++ ControlBar batch production)
          const count = (e.ctrlKey || e.metaKey) ? 5 : 1;
          if (this.onSlotActivated) {
            this.onSlotActivated(slotIndex, count);
          } else {
            for (let i = 0; i < count; i++) this.controlBar.activateSlot(slotIndex);
          }
        }
      });

      // Source behavior from ControlBar: right-clicking a production button
      // cancels the most recent queued instance of that item.
      slotEl.button.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.disposed) {
          return;
        }
        const hudSlots = this.controlBar.getHudSlots();
        const hudSlot = hudSlots[slotIndex - 1];
        if (hudSlot && hudSlot.state !== 'empty' && this.onSlotRightClicked) {
          this.onSlotRightClicked(slotIndex);
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
        // Only re-resolve if the icon name changed for this slot
        if (this.slotIconNames[i] !== hud.iconName) {
          this.slotIconNames[i] = hud.iconName;
          if (this.mappedImageResolver) {
            // Async resolve — hide icon until resolved
            el.icon.style.display = 'none';
            el.label.style.display = 'block';
            const resolver = this.mappedImageResolver;
            const iconName = hud.iconName;
            const slotIcon = el.icon;
            const slotLabel = el.label;
            const slotIdx = i;
            void resolver.resolve(iconName).then((url) => {
              // Guard: slot may have changed by the time the promise resolves
              if (this.disposed || this.slotIconNames[slotIdx] !== iconName) return;
              if (url) {
                slotIcon.src = url;
                slotIcon.style.display = 'block';
                slotLabel.style.display = 'none';
              } else {
                // No MappedImage found — show the text label as fallback
                slotIcon.style.display = 'none';
                slotLabel.style.display = 'block';
              }
            }).catch(() => {
              // Atlas texture fetch failed — show text label as fallback
              if (!this.disposed && this.slotIconNames[slotIdx] === iconName) {
                slotIcon.style.display = 'none';
                slotLabel.style.display = 'block';
              }
            });
          } else {
            // No resolver — treat iconName as a direct URL (legacy behavior)
            el.icon.src = hud.iconName;
            el.icon.style.display = 'block';
          }
        }
      } else {
        this.slotIconNames[i] = undefined;
        el.icon.style.display = 'none';
        el.icon.removeAttribute('src');
        el.label.style.display = 'block';
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

      // -- Queue count badge (source parity: queued unit count on production buttons) --
      const queueCount = overlay?.queueCount ?? 0;
      let badge = el.button.querySelector('.queue-badge') as HTMLSpanElement | null;
      if (queueCount > 1) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'queue-badge';
          badge.style.cssText = 'position:absolute;bottom:1px;right:1px;background:#d4af37;color:#000;font-size:9px;font-weight:bold;padding:0 3px;border-radius:2px;line-height:14px;pointer-events:none;z-index:5';
          el.button.appendChild(badge);
        }
        badge.textContent = `×${queueCount}`;
        badge.style.display = 'block';
      } else if (badge) {
        badge.style.display = 'none';
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
