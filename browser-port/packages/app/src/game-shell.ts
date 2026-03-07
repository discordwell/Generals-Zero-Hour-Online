/**
 * Game Shell — Main menu and skirmish setup screens.
 *
 * Source parity:
 *   Generals/Code/GameEngine/Source/GameClient/Shell/Shell.cpp
 *   Generals/Code/GameEngine/Source/GameClient/Shell/ShellMenuScheme.cpp
 *
 * The original engine uses a WND-based (Westwood Window) UI system for its
 * shell screens. We replicate the screen flow with DOM elements:
 *   MAIN_MENU → SKIRMISH_SETUP → (game loads) → IN_GAME
 */

// ──── Types ─────────────────────────────────────────────────────────────────

export type ShellScreen = 'main-menu' | 'skirmish-setup' | 'options';

export interface SkirmishSettings {
  /** Map asset path (null = procedural demo terrain). */
  mapPath: string | null;
  /** Player faction side (America, China, GLA). */
  playerSide: string;
  /** Whether AI opponent is enabled. */
  aiEnabled: boolean;
  /** AI faction side. */
  aiSide: string;
  /** Starting credits for all players. */
  startingCredits: number;
}

export interface MapInfo {
  /** Display name (derived from path). */
  name: string;
  /** Asset path for loading (e.g., "maps/Alpine Assault.json"). */
  path: string;
}

export interface GameShellCallbacks {
  /** Called when user clicks "Start Game" from skirmish setup. */
  onStartGame(settings: SkirmishSettings): void;
  /** Called when user opens the Options screen from the main menu. */
  onOpenOptions?(): void;
}

// ──── Faction data ──────────────────────────────────────────────────────────

const FACTIONS = [
  { side: 'America', label: 'USA', description: 'United States of America' },
  { side: 'China', label: 'China', description: "People's Republic of China" },
  { side: 'GLA', label: 'GLA', description: 'Global Liberation Army' },
] as const;

const STARTING_CREDITS_OPTIONS = [
  { value: 5000, label: '$5,000' },
  { value: 10000, label: '$10,000 (Default)' },
  { value: 20000, label: '$20,000' },
  { value: 40000, label: '$40,000' },
] as const;

// ──── Styles ────────────────────────────────────────────────────────────────

const SHELL_STYLES = `
  .shell-screen {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #1a1a2e;
    z-index: 900;
    transition: opacity 0.4s;
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #e0d8c0;
  }
  .shell-screen.hidden {
    display: none;
  }

  /* ── Main Menu ── */
  .main-menu-title {
    font-size: 3.2rem;
    color: #c9a84c;
    text-transform: uppercase;
    letter-spacing: 0.35em;
    margin-bottom: 0.4rem;
    text-shadow: 0 2px 8px rgba(0,0,0,0.6);
  }
  .main-menu-subtitle {
    font-size: 1.15rem;
    color: #8a8070;
    margin-bottom: 3.5rem;
    letter-spacing: 0.15em;
  }
  .menu-button {
    display: block;
    width: 280px;
    padding: 14px 0;
    margin-bottom: 12px;
    border: 1px solid rgba(201, 168, 76, 0.4);
    background: rgba(201, 168, 76, 0.08);
    color: #c9a84c;
    font-size: 1.05rem;
    font-family: inherit;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s, color 0.2s;
  }
  .menu-button:hover {
    background: rgba(201, 168, 76, 0.18);
    border-color: rgba(201, 168, 76, 0.7);
    color: #e8d48b;
  }
  .menu-button:active {
    background: rgba(201, 168, 76, 0.25);
  }
  .menu-button.disabled {
    opacity: 0.35;
    cursor: default;
    pointer-events: none;
  }
  .menu-version {
    position: absolute;
    bottom: 16px;
    right: 20px;
    font-size: 0.75rem;
    color: #4a4540;
  }

  /* ── Skirmish Setup ── */
  .skirmish-panel {
    background: rgba(12, 16, 28, 0.85);
    border: 1px solid rgba(201, 168, 76, 0.25);
    padding: 32px 40px;
    min-width: 520px;
    max-width: 600px;
  }
  .skirmish-title {
    font-size: 1.6rem;
    color: #c9a84c;
    text-transform: uppercase;
    letter-spacing: 0.25em;
    margin-bottom: 28px;
    text-align: center;
  }
  .skirmish-section {
    margin-bottom: 20px;
  }
  .skirmish-label {
    display: block;
    font-size: 0.8rem;
    color: #8a8070;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    margin-bottom: 6px;
  }
  .skirmish-select {
    width: 100%;
    padding: 8px 12px;
    background: #0c101c;
    border: 1px solid rgba(201, 168, 76, 0.3);
    color: #e0d8c0;
    font-size: 0.95rem;
    font-family: inherit;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }
  .skirmish-select:focus {
    outline: none;
    border-color: rgba(201, 168, 76, 0.6);
  }

  /* Faction radio buttons */
  .faction-row {
    display: flex;
    gap: 8px;
  }
  .faction-option {
    flex: 1;
    padding: 10px 8px;
    text-align: center;
    border: 1px solid rgba(201, 168, 76, 0.2);
    background: rgba(201, 168, 76, 0.04);
    color: #8a8070;
    font-size: 0.9rem;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .faction-option:hover {
    background: rgba(201, 168, 76, 0.1);
    color: #c9a84c;
  }
  .faction-option.selected {
    border-color: #c9a84c;
    background: rgba(201, 168, 76, 0.15);
    color: #e8d48b;
  }
  .faction-option .faction-name {
    font-weight: 600;
    font-size: 1rem;
  }
  .faction-option .faction-desc {
    font-size: 0.7rem;
    margin-top: 2px;
    opacity: 0.7;
  }

  /* AI toggle */
  .ai-toggle-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .ai-toggle-btn {
    padding: 6px 16px;
    border: 1px solid rgba(201, 168, 76, 0.3);
    background: rgba(201, 168, 76, 0.04);
    color: #8a8070;
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .ai-toggle-btn.active {
    border-color: #6a9c6a;
    background: rgba(106, 156, 106, 0.15);
    color: #8ccc8c;
  }
  .ai-toggle-btn:hover {
    background: rgba(201, 168, 76, 0.1);
  }

  /* Bottom buttons */
  .skirmish-actions {
    display: flex;
    gap: 12px;
    margin-top: 28px;
    justify-content: flex-end;
  }
  .skirmish-btn {
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
  .skirmish-btn:hover {
    background: rgba(201, 168, 76, 0.18);
    border-color: rgba(201, 168, 76, 0.7);
  }
  .skirmish-btn.primary {
    background: rgba(201, 168, 76, 0.2);
    border-color: #c9a84c;
  }
  .skirmish-btn.primary:hover {
    background: rgba(201, 168, 76, 0.35);
  }
`;

// ──── Shell class ───────────────────────────────────────────────────────────

export class GameShell {
  private root: HTMLElement;
  private callbacks: GameShellCallbacks;
  // DOM elements
  private styleEl: HTMLStyleElement | null = null;
  private mainMenuEl: HTMLElement | null = null;
  private skirmishEl: HTMLElement | null = null;

  // Skirmish state
  private availableMaps: MapInfo[] = [];
  private selectedMapIndex = -1; // -1 = procedural demo
  private playerSide = 'America';
  private aiEnabled = true;
  private aiSide = 'China';
  private startingCredits = 10000;

  // Element refs for updates
  private mapSelect: HTMLSelectElement | null = null;
  private playerFactionBtns: HTMLButtonElement[] = [];
  private aiFactionBtns: HTMLButtonElement[] = [];
  private aiToggleBtn: HTMLButtonElement | null = null;
  private aiSideSection: HTMLElement | null = null;
  private creditsSelect: HTMLSelectElement | null = null;

  constructor(root: HTMLElement, callbacks: GameShellCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
  }

  /**
   * Populate available maps from an asset manifest.
   * Filters output paths starting with "maps/" and ending with ".json".
   */
  setAvailableMaps(outputPaths: string[]): void {
    this.availableMaps = outputPaths
      .filter(p => /^maps\//i.test(p) && p.endsWith('.json'))
      .map(p => ({
        path: p,
        name: p
          .replace(/^maps\//i, '')
          .replace(/\.json$/i, '')
          .replace(/_/g, ' '),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Populate available factions from INI data.
   * Falls back to hardcoded USA/China/GLA if no factions are provided.
   */
  setAvailableFactions(_factionNames: string[]): void {
    // Currently uses hardcoded FACTIONS array which matches the original game.
    // When INI faction data expands (e.g., Zero Hour generals), this can filter.
  }

  /** Show the shell and render the current screen. */
  show(): void {
    this.injectStyles();
    this.renderMainMenu();
    this.renderSkirmishSetup();
    this.showScreen('main-menu');
  }

  /** Remove all shell DOM elements. */
  hide(): void {
    if (this.mainMenuEl) {
      this.mainMenuEl.remove();
      this.mainMenuEl = null;
    }
    if (this.skirmishEl) {
      this.skirmishEl.remove();
      this.skirmishEl = null;
    }
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
  }

  /** Check if the shell is currently visible. */
  get isVisible(): boolean {
    return this.mainMenuEl !== null || this.skirmishEl !== null;
  }

  // ──── Private: screen management ────────────────────────────────────────

  private showScreen(screen: ShellScreen): void {
    // Track screen transitions via DOM visibility.
    if (this.mainMenuEl) {
      this.mainMenuEl.classList.toggle('hidden', screen !== 'main-menu');
    }
    if (this.skirmishEl) {
      this.skirmishEl.classList.toggle('hidden', screen !== 'skirmish-setup');
    }
  }

  private injectStyles(): void {
    if (this.styleEl) return;
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = SHELL_STYLES;
    document.head.appendChild(this.styleEl);
  }

  // ──── Private: Main Menu ────────────────────────────────────────────────

  private renderMainMenu(): void {
    if (this.mainMenuEl) return;

    const el = document.createElement('div');
    el.className = 'shell-screen';
    el.id = 'main-menu-screen';

    el.innerHTML = `
      <div class="main-menu-title">Generals</div>
      <div class="main-menu-subtitle">Zero Hour &mdash; Browser Edition</div>
      <button class="menu-button" data-action="skirmish">Skirmish</button>
      <button class="menu-button disabled" data-action="multiplayer">Multiplayer</button>
      <button class="menu-button disabled" data-action="replay">Replay</button>
      <button class="menu-button" data-action="options">Options</button>
      <div class="menu-version">Browser Port v0.1</div>
    `;

    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'skirmish') {
        this.showScreen('skirmish-setup');
      } else if (action === 'options') {
        this.callbacks.onOpenOptions?.();
      }
    });

    this.root.appendChild(el);
    this.mainMenuEl = el;
  }

  // ──── Private: Skirmish Setup ───────────────────────────────────────────

  private renderSkirmishSetup(): void {
    if (this.skirmishEl) return;

    const el = document.createElement('div');
    el.className = 'shell-screen hidden';
    el.id = 'skirmish-setup-screen';

    // Build map options
    const mapOptionsHtml = this.buildMapOptionsHtml();
    const creditsOptionsHtml = STARTING_CREDITS_OPTIONS.map(opt =>
      `<option value="${opt.value}"${opt.value === this.startingCredits ? ' selected' : ''}>${opt.label}</option>`,
    ).join('');

    el.innerHTML = `
      <div class="skirmish-panel">
        <div class="skirmish-title">Skirmish Setup</div>

        <div class="skirmish-section">
          <label class="skirmish-label">Map</label>
          <select class="skirmish-select" data-ref="map-select">
            ${mapOptionsHtml}
          </select>
        </div>

        <div class="skirmish-section">
          <label class="skirmish-label">Your Faction</label>
          <div class="faction-row" data-ref="player-factions">
            ${FACTIONS.map(f => `
              <button class="faction-option${f.side === this.playerSide ? ' selected' : ''}"
                      data-side="${f.side}">
                <div class="faction-name">${f.label}</div>
                <div class="faction-desc">${f.description}</div>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="skirmish-section">
          <label class="skirmish-label">AI Opponent</label>
          <div class="ai-toggle-row">
            <button class="ai-toggle-btn${this.aiEnabled ? ' active' : ''}"
                    data-ref="ai-toggle">
              ${this.aiEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>

        <div class="skirmish-section" data-ref="ai-side-section"
             style="${this.aiEnabled ? '' : 'display:none'}">
          <label class="skirmish-label">AI Faction</label>
          <div class="faction-row" data-ref="ai-factions">
            ${FACTIONS.map(f => `
              <button class="faction-option${f.side === this.aiSide ? ' selected' : ''}"
                      data-side="${f.side}">
                <div class="faction-name">${f.label}</div>
                <div class="faction-desc">${f.description}</div>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="skirmish-section">
          <label class="skirmish-label">Starting Credits</label>
          <select class="skirmish-select" data-ref="credits-select">
            ${creditsOptionsHtml}
          </select>
        </div>

        <div class="skirmish-actions">
          <button class="skirmish-btn" data-action="back">Back</button>
          <button class="skirmish-btn primary" data-action="start">Start Game</button>
        </div>
      </div>
    `;

    // Cache refs
    this.mapSelect = el.querySelector('[data-ref="map-select"]');
    this.creditsSelect = el.querySelector('[data-ref="credits-select"]');
    this.aiToggleBtn = el.querySelector('[data-ref="ai-toggle"]');
    this.aiSideSection = el.querySelector('[data-ref="ai-side-section"]');

    const playerFactionRow = el.querySelector('[data-ref="player-factions"]');
    this.playerFactionBtns = playerFactionRow
      ? [...playerFactionRow.querySelectorAll<HTMLButtonElement>('.faction-option')]
      : [];

    const aiFactionRow = el.querySelector('[data-ref="ai-factions"]');
    this.aiFactionBtns = aiFactionRow
      ? [...aiFactionRow.querySelectorAll<HTMLButtonElement>('.faction-option')]
      : [];

    // Event delegation
    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action], [data-side], [data-ref]') as HTMLElement | null;
      if (!target) return;

      // Action buttons
      if (target.dataset.action === 'back') {
        this.showScreen('main-menu');
        return;
      }
      if (target.dataset.action === 'start') {
        this.handleStartGame();
        return;
      }

      // Player faction selection
      if (target.dataset.side && target.closest('[data-ref="player-factions"]')) {
        this.playerSide = target.dataset.side;
        this.updateFactionSelection(this.playerFactionBtns, this.playerSide);
        return;
      }

      // AI faction selection
      if (target.dataset.side && target.closest('[data-ref="ai-factions"]')) {
        this.aiSide = target.dataset.side;
        this.updateFactionSelection(this.aiFactionBtns, this.aiSide);
        return;
      }

      // AI toggle
      if (target.dataset.ref === 'ai-toggle' || target.closest('[data-ref="ai-toggle"]')) {
        this.aiEnabled = !this.aiEnabled;
        if (this.aiToggleBtn) {
          this.aiToggleBtn.textContent = this.aiEnabled ? 'Enabled' : 'Disabled';
          this.aiToggleBtn.classList.toggle('active', this.aiEnabled);
        }
        if (this.aiSideSection) {
          this.aiSideSection.style.display = this.aiEnabled ? '' : 'none';
        }
      }
    });

    // Select change handlers
    if (this.mapSelect) {
      this.mapSelect.addEventListener('change', () => {
        this.selectedMapIndex = Number(this.mapSelect!.value);
      });
    }
    if (this.creditsSelect) {
      this.creditsSelect.addEventListener('change', () => {
        this.startingCredits = Number(this.creditsSelect!.value);
      });
    }

    this.root.appendChild(el);
    this.skirmishEl = el;
  }

  private buildMapOptionsHtml(): string {
    let html = '<option value="-1">Procedural Demo Terrain</option>';
    for (let i = 0; i < this.availableMaps.length; i++) {
      const mapInfo = this.availableMaps[i]!;
      html += `<option value="${i}">${mapInfo.name}</option>`;
    }
    return html;
  }

  private updateFactionSelection(buttons: HTMLButtonElement[], selectedSide: string): void {
    for (const btn of buttons) {
      btn.classList.toggle('selected', btn.dataset.side === selectedSide);
    }
  }

  private handleStartGame(): void {
    const selectedMap = this.selectedMapIndex >= 0
      ? this.availableMaps[this.selectedMapIndex]
      : undefined;
    const mapPath = selectedMap?.path ?? null;

    const settings: SkirmishSettings = {
      mapPath,
      playerSide: this.playerSide,
      aiEnabled: this.aiEnabled,
      aiSide: this.aiSide,
      startingCredits: this.startingCredits,
    };

    this.callbacks.onStartGame(settings);
  }
}
