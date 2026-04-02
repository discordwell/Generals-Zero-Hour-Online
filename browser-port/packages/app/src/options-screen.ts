/**
 * Options Screen — Audio and game settings overlay.
 *
 * Source parity:
 *   Generals/Code/GameEngine/Source/GameClient/GUI/GUICallbacks/Menus/OptionsMenu.cpp
 *
 * Persists settings to localStorage as "Options.ini" key=value format,
 * matching the original game's OptionPreferences system.
 */

const OPTIONS_STYLES = `
  .options-overlay {
    position: absolute;
    inset: 0;
    z-index: 950;
    background: rgba(0, 0, 0, 0.58);
    font-family: Arial, Helvetica, sans-serif;
    color: #f1f4ff;
  }
  .options-source-rect {
    position: absolute;
    box-sizing: border-box;
  }
  .options-parent {
    border: 1px solid rgba(62, 76, 118, 0.66);
    background: rgba(0, 0, 0, 0.08);
  }
  .options-panel {
    border: 1px solid rgba(86, 102, 148, 0.9);
    background:
      linear-gradient(180deg, rgba(7, 12, 25, 0.98) 0%, rgba(2, 5, 11, 0.99) 100%);
    box-shadow:
      inset 0 0 0 1px rgba(3, 6, 12, 0.88),
      0 0 18px rgba(0, 0, 0, 0.26);
  }
  .options-group {
    border: 1px solid rgba(69, 88, 136, 0.88);
    background:
      linear-gradient(180deg, rgba(11, 18, 40, 0.94) 0%, rgba(4, 7, 15, 0.98) 100%);
    box-shadow: inset 0 0 0 1px rgba(3, 6, 12, 0.82);
    padding: 0.8rem 0.9rem 0.65rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .options-group-title {
    color: #f5f8ff;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(0.86rem, 1vw, 0.96rem);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .options-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 1.4fr auto;
    align-items: center;
    gap: 0.55rem;
  }
  .options-row-label {
    color: #d5ddf0;
    font-size: clamp(0.72rem, 0.85vw, 0.8rem);
  }
  .options-slider {
    width: 100%;
    appearance: none;
    -webkit-appearance: none;
    height: 6px;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(64, 96, 182, 0.92) 0%, rgba(22, 30, 64, 0.96) 100%);
    outline: none;
  }
  .options-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid rgba(247, 251, 255, 0.72);
    background: #dbe5ff;
    box-shadow: 0 0 8px rgba(165, 193, 255, 0.4);
    cursor: pointer;
  }
  .options-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid rgba(247, 251, 255, 0.72);
    background: #dbe5ff;
    box-shadow: 0 0 8px rgba(165, 193, 255, 0.4);
    cursor: pointer;
  }
  .options-slider-value {
    min-width: 2.5rem;
    text-align: right;
    color: #b8c6e5;
    font-size: clamp(0.68rem, 0.8vw, 0.76rem);
    font-variant-numeric: tabular-nums;
  }
  .options-detail-row {
    display: flex;
    gap: 0.4rem;
  }
  .options-detail {
    flex: 1 1 0;
    border: 1px solid rgba(84, 102, 151, 0.82);
    background:
      linear-gradient(180deg, rgba(22, 33, 75, 0.94) 0%, rgba(8, 12, 28, 0.98) 100%);
    color: #f1f4ff;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(0.72rem, 0.84vw, 0.8rem);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .options-detail[aria-pressed="true"] {
    color: #cbff63;
    border-color: rgba(118, 148, 62, 0.92);
    background:
      linear-gradient(180deg, rgba(46, 65, 29, 0.94) 0%, rgba(13, 21, 11, 0.98) 100%);
  }
  .options-detail:disabled {
    opacity: 0.58;
  }
  .options-note {
    color: #9aa8c7;
    font-size: clamp(0.64rem, 0.74vw, 0.7rem);
    line-height: 1.35;
  }
  .options-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(88, 111, 171, 0.9);
    background:
      linear-gradient(180deg, rgba(34, 50, 108, 0.96) 0%, rgba(12, 18, 44, 0.99) 100%);
    box-shadow: inset 0 0 0 1px rgba(5, 9, 17, 0.8);
    color: #f4f7ff;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(0.78rem, 0.9vw, 0.86rem);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .options-btn:hover {
    color: #cbff63;
  }
  .options-version {
    display: flex;
    align-items: center;
    color: #9ca7c0;
    font-size: clamp(0.64rem, 0.76vw, 0.7rem);
  }
`;

const SOURCE_RESOLUTION = { width: 800, height: 600 } as const;
const OPTIONS_PARENT_RECT = { x: 120, y: 12, width: 541, height: 585 } as const;
const OPTIONS_PANEL_RECT = { x: 135, y: 19, width: 515, height: 567 } as const;
const OPTIONS_VIDEO_RECT = { x: 151, y: 69, width: 236, height: 202 } as const;
const OPTIONS_AUDIO_RECT = { x: 391, y: 69, width: 244, height: 202 } as const;
const OPTIONS_SCROLL_RECT = { x: 151, y: 272, width: 484, height: 128 } as const;
const OPTIONS_DEFAULTS_RECT = { x: 152, y: 528, width: 156, height: 32 } as const;
const OPTIONS_ACCEPT_RECT = { x: 312, y: 528, width: 159, height: 32 } as const;
const OPTIONS_BACK_RECT = { x: 476, y: 528, width: 159, height: 32 } as const;
const OPTIONS_VERSION_RECT = { x: 152, y: 560, width: 480, height: 18 } as const;

function formatSourcePercent(value: number, total: number): string {
  return `${((value / total) * 100).toFixed(6)}%`;
}

function formatSourceRectStyle(rect: { x: number; y: number; width: number; height: number }): string {
  return [
    `left:${formatSourcePercent(rect.x, SOURCE_RESOLUTION.width)}`,
    `top:${formatSourcePercent(rect.y, SOURCE_RESOLUTION.height)}`,
    `width:${formatSourcePercent(rect.width, SOURCE_RESOLUTION.width)}`,
    `height:${formatSourcePercent(rect.height, SOURCE_RESOLUTION.height)}`,
  ].join(';');
}

function formatSourceRectData(rect: { x: number; y: number; width: number; height: number }): string {
  return `${rect.x},${rect.y},${rect.width},${rect.height}`;
}

const DEFAULT_OPTIONS_STATE: OptionsState = {
  musicVolume: 70,
  sfxVolume: 70,
  voiceVolume: 70,
  scrollSpeed: 50,
};

export interface OptionsState {
  musicVolume: number;   // 0..100
  sfxVolume: number;     // 0..100
  voiceVolume: number;   // 0..100
  scrollSpeed: number;   // 0..100
}

export interface OptionsScreenCallbacks {
  onApply(state: OptionsState): void;
  onClose(): void;
}

export class OptionsScreen {
  private root: HTMLElement;
  private callbacks: OptionsScreenCallbacks;
  private overlayEl: HTMLElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private state: OptionsState;

  // Value display refs for live slider updates
  private musicValue: HTMLElement | null = null;
  private sfxValue: HTMLElement | null = null;
  private voiceValue: HTMLElement | null = null;
  private scrollValue: HTMLElement | null = null;

  constructor(root: HTMLElement, callbacks: OptionsScreenCallbacks, initialState: OptionsState) {
    this.root = root;
    this.callbacks = callbacks;
    this.state = { ...initialState };
  }

  show(): void {
    if (this.overlayEl) return;

    if (!this.styleEl) {
      this.styleEl = document.createElement('style');
      this.styleEl.textContent = OPTIONS_STYLES;
      document.head.appendChild(this.styleEl);
    }

    const el = document.createElement('div');
    el.className = 'options-overlay';
    el.innerHTML = `
      <div
        class="options-parent options-source-rect"
        data-ref="options-parent"
        data-source-rect="${formatSourceRectData(OPTIONS_PARENT_RECT)}"
        style="${formatSourceRectStyle(OPTIONS_PARENT_RECT)}"
      ></div>
      <div
        class="options-panel options-source-rect"
        data-ref="options-panel"
        data-source-rect="${formatSourceRectData(OPTIONS_PANEL_RECT)}"
        style="${formatSourceRectStyle(OPTIONS_PANEL_RECT)}"
      ></div>
      <section
        class="options-group options-source-rect"
        data-ref="options-video-parent"
        data-source-rect="${formatSourceRectData(OPTIONS_VIDEO_RECT)}"
        style="${formatSourceRectStyle(OPTIONS_VIDEO_RECT)}"
      >
        <div class="options-group-title">Video</div>
        <div class="options-detail-row">
          <button type="button" class="options-detail" aria-pressed="false" disabled>Low</button>
          <button type="button" class="options-detail" aria-pressed="true" disabled>Medium</button>
          <button type="button" class="options-detail" aria-pressed="false" disabled>High</button>
        </div>
        <div class="options-note">Retail layout parity. Display-detail controls are visible here, but renderer detail is not runtime-configurable yet.</div>
      </section>
      <section
        class="options-group options-source-rect"
        data-ref="options-audio-parent"
        data-source-rect="${formatSourceRectData(OPTIONS_AUDIO_RECT)}"
        style="${formatSourceRectStyle(OPTIONS_AUDIO_RECT)}"
      >
        <div class="options-group-title">Audio</div>
        <label class="options-row">
          <span class="options-row-label">Music Volume</span>
          <input type="range" class="options-slider" data-ref="music" min="0" max="100" value="${this.state.musicVolume}">
          <span class="options-slider-value" data-ref="music-val">${this.state.musicVolume}%</span>
        </label>
        <label class="options-row">
          <span class="options-row-label">SFX Volume</span>
          <input type="range" class="options-slider" data-ref="sfx" min="0" max="100" value="${this.state.sfxVolume}">
          <span class="options-slider-value" data-ref="sfx-val">${this.state.sfxVolume}%</span>
        </label>
        <label class="options-row">
          <span class="options-row-label">Voice Volume</span>
          <input type="range" class="options-slider" data-ref="voice" min="0" max="100" value="${this.state.voiceVolume}">
          <span class="options-slider-value" data-ref="voice-val">${this.state.voiceVolume}%</span>
        </label>
      </section>
      <section
        class="options-group options-source-rect"
        data-ref="options-scroll-parent"
        data-source-rect="${formatSourceRectData(OPTIONS_SCROLL_RECT)}"
        style="${formatSourceRectStyle(OPTIONS_SCROLL_RECT)}"
      >
        <div class="options-group-title">Scroll</div>
        <label class="options-row">
          <span class="options-row-label">Scroll Speed</span>
          <input type="range" class="options-slider" data-ref="scroll" min="0" max="100" value="${this.state.scrollSpeed}">
          <span class="options-slider-value" data-ref="scroll-val">${this.state.scrollSpeed}%</span>
        </label>
        <div class="options-note">Applies the retail OptionsMenu.cpp scroll-speed preference immediately.</div>
      </section>
      <button
        class="options-btn options-source-rect"
        data-action="defaults"
        data-ref="options-defaults"
        data-source-rect="${formatSourceRectData(OPTIONS_DEFAULTS_RECT)}"
        style="${formatSourceRectStyle(OPTIONS_DEFAULTS_RECT)}"
      >Defaults</button>
      <button
        class="options-btn options-source-rect"
        data-action="apply"
        data-ref="options-accept"
        data-source-rect="${formatSourceRectData(OPTIONS_ACCEPT_RECT)}"
        style="${formatSourceRectStyle(OPTIONS_ACCEPT_RECT)}"
      >Accept</button>
      <button
        class="options-btn options-source-rect"
        data-action="cancel"
        data-ref="options-back"
        data-source-rect="${formatSourceRectData(OPTIONS_BACK_RECT)}"
        style="${formatSourceRectStyle(OPTIONS_BACK_RECT)}"
      >Cancel</button>
      <div
        class="options-version options-source-rect"
        data-ref="options-version"
        data-source-rect="${formatSourceRectData(OPTIONS_VERSION_RECT)}"
        style="${formatSourceRectStyle(OPTIONS_VERSION_RECT)}"
      >Browser Port Development Build</div>
    `;

    // Cache value display refs
    this.musicValue = el.querySelector('[data-ref="music-val"]');
    this.sfxValue = el.querySelector('[data-ref="sfx-val"]');
    this.voiceValue = el.querySelector('[data-ref="voice-val"]');
    this.scrollValue = el.querySelector('[data-ref="scroll-val"]');

    // Slider input handlers
    el.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const ref = target.dataset.ref;
      if (!ref) return;
      const val = Number(target.value);
      switch (ref) {
        case 'music':
          this.state.musicVolume = val;
          if (this.musicValue) this.musicValue.textContent = `${val}%`;
          break;
        case 'sfx':
          this.state.sfxVolume = val;
          if (this.sfxValue) this.sfxValue.textContent = `${val}%`;
          break;
        case 'voice':
          this.state.voiceVolume = val;
          if (this.voiceValue) this.voiceValue.textContent = `${val}%`;
          break;
        case 'scroll':
          this.state.scrollSpeed = val;
          if (this.scrollValue) this.scrollValue.textContent = `${val}%`;
          break;
      }
    });

    // Button handlers
    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!target) return;
      if (target.dataset.action === 'apply') {
        this.callbacks.onApply({ ...this.state });
        this.hide();
      } else if (target.dataset.action === 'defaults') {
        this.setState(DEFAULT_OPTIONS_STATE);
        this.syncDisplayedState(el);
      } else if (target.dataset.action === 'cancel') {
        this.callbacks.onClose();
        this.hide();
      }
    });

    // ESC to close
    this._escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onClose();
        this.hide();
      }
    };
    document.addEventListener('keydown', this._escHandler, true);

    this.root.appendChild(el);
    this.overlayEl = el;
    this.syncDisplayedState(el);
  }

  hide(): void {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler, true);
      this._escHandler = null;
    }
  }

  get isVisible(): boolean {
    return this.overlayEl !== null;
  }

  /** Update the state shown in the UI (e.g., after loading preferences). */
  setState(state: OptionsState): void {
    this.state = { ...state };
  }

  private syncDisplayedState(scope: ParentNode): void {
    const assign = (ref: string, value: number, display: HTMLElement | null): void => {
      const input = scope.querySelector(`[data-ref="${ref}"]`) as HTMLInputElement | null;
      if (input) {
        input.value = String(value);
      }
      if (display) {
        display.textContent = `${value}%`;
      }
    };

    assign('music', this.state.musicVolume, this.musicValue);
    assign('sfx', this.state.sfxVolume, this.sfxValue);
    assign('voice', this.state.voiceVolume, this.voiceValue);
    assign('scroll', this.state.scrollSpeed, this.scrollValue);
  }

  private _escHandler: ((e: KeyboardEvent) => void) | null = null;
}

/**
 * Save option preferences to localStorage in Options.ini format.
 * Source parity: OptionPreferences serialization writes key=value pairs.
 */
export function saveOptionsToStorage(
  state: OptionsState,
  storage: Pick<Storage, 'setItem'> | null | undefined,
  storageKey = 'Options.ini',
): void {
  if (!storage) return;
  const lines = [
    `MusicVolume = ${state.musicVolume}`,
    `SFXVolume = ${state.sfxVolume}`,
    `VoiceVolume = ${state.voiceVolume}`,
    `ScrollSpeed = ${state.scrollSpeed}`,
  ];
  try {
    storage.setItem(storageKey, lines.join('\n'));
  } catch {
    // localStorage quota exceeded — ignore.
  }
}

/**
 * Load option state from localStorage preferences map.
 */
export function loadOptionsState(
  preferences: ReadonlyMap<string, string>,
): OptionsState {
  const parse = (key: string, fallback: number): number => {
    const val = preferences.get(key);
    if (val === undefined) return fallback;
    const parsed = Number.parseFloat(val);
    return Number.isFinite(parsed) ? Math.round(Math.max(0, Math.min(100, parsed))) : fallback;
  };
  return {
    musicVolume: parse('MusicVolume', 70),
    sfxVolume: parse('SFXVolume', 70),
    voiceVolume: parse('VoiceVolume', 70),
    scrollSpeed: parse('ScrollSpeed', 50),
  };
}
