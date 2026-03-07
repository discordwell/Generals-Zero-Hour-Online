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
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    z-index: 950;
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #e0d8c0;
  }
  .options-panel {
    background: rgba(12, 16, 28, 0.95);
    border: 1px solid rgba(201, 168, 76, 0.35);
    padding: 32px 40px;
    min-width: 440px;
    max-width: 520px;
  }
  .options-title {
    font-size: 1.5rem;
    color: #c9a84c;
    text-transform: uppercase;
    letter-spacing: 0.25em;
    margin-bottom: 28px;
    text-align: center;
  }
  .options-section-label {
    font-size: 0.75rem;
    color: #8a8070;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    margin-bottom: 12px;
    margin-top: 20px;
    border-bottom: 1px solid rgba(201, 168, 76, 0.15);
    padding-bottom: 4px;
  }
  .options-section-label:first-of-type {
    margin-top: 0;
  }
  .options-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .options-row-label {
    font-size: 0.9rem;
    color: #c0b8a0;
    flex-shrink: 0;
    width: 140px;
  }
  .options-slider-group {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
  }
  .options-slider {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    background: rgba(201, 168, 76, 0.2);
    outline: none;
    border-radius: 2px;
    cursor: pointer;
  }
  .options-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    background: #c9a84c;
    border-radius: 50%;
    cursor: pointer;
  }
  .options-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    background: #c9a84c;
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }
  .options-slider-value {
    font-size: 0.8rem;
    color: #8a8070;
    width: 36px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .options-actions {
    display: flex;
    gap: 12px;
    margin-top: 28px;
    justify-content: flex-end;
  }
  .options-btn {
    padding: 10px 28px;
    border: 1px solid rgba(201, 168, 76, 0.4);
    background: rgba(201, 168, 76, 0.08);
    color: #c9a84c;
    font-size: 0.95rem;
    font-family: inherit;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
  }
  .options-btn:hover {
    background: rgba(201, 168, 76, 0.18);
    border-color: rgba(201, 168, 76, 0.7);
  }
  .options-btn.primary {
    background: rgba(201, 168, 76, 0.2);
    border-color: #c9a84c;
  }
  .options-btn.primary:hover {
    background: rgba(201, 168, 76, 0.35);
  }
`;

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
      <div class="options-panel">
        <div class="options-title">Options</div>

        <div class="options-section-label">Audio</div>

        <div class="options-row">
          <span class="options-row-label">Music Volume</span>
          <div class="options-slider-group">
            <input type="range" class="options-slider" data-ref="music" min="0" max="100" value="${this.state.musicVolume}">
            <span class="options-slider-value" data-ref="music-val">${this.state.musicVolume}%</span>
          </div>
        </div>

        <div class="options-row">
          <span class="options-row-label">SFX Volume</span>
          <div class="options-slider-group">
            <input type="range" class="options-slider" data-ref="sfx" min="0" max="100" value="${this.state.sfxVolume}">
            <span class="options-slider-value" data-ref="sfx-val">${this.state.sfxVolume}%</span>
          </div>
        </div>

        <div class="options-row">
          <span class="options-row-label">Voice Volume</span>
          <div class="options-slider-group">
            <input type="range" class="options-slider" data-ref="voice" min="0" max="100" value="${this.state.voiceVolume}">
            <span class="options-slider-value" data-ref="voice-val">${this.state.voiceVolume}%</span>
          </div>
        </div>

        <div class="options-section-label">Game</div>

        <div class="options-row">
          <span class="options-row-label">Scroll Speed</span>
          <div class="options-slider-group">
            <input type="range" class="options-slider" data-ref="scroll" min="0" max="100" value="${this.state.scrollSpeed}">
            <span class="options-slider-value" data-ref="scroll-val">${this.state.scrollSpeed}%</span>
          </div>
        </div>

        <div class="options-actions">
          <button class="options-btn" data-action="cancel">Cancel</button>
          <button class="options-btn primary" data-action="apply">Apply</button>
        </div>
      </div>
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
