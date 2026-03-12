/**
 * Game Shell — Main menu, skirmish setup, and campaign screens.
 *
 * Source parity:
 *   Generals/Code/GameEngine/Source/GameClient/Shell/Shell.cpp
 *   Generals/Code/GameEngine/Source/GameClient/Shell/ShellMenuScheme.cpp
 *   Generals/Code/GameEngine/Source/GameClient/GUI/GUICallbacks/Menus/MainMenu.cpp
 *
 * The original engine uses a WND-based (Westwood Window) UI system for its
 * shell screens. We replicate the screen flow with DOM elements:
 *   MAIN_MENU → SINGLE_PLAYER → CAMPAIGN_FACTION → CAMPAIGN_DIFFICULTY → CAMPAIGN_BRIEFING → (game loads)
 *   MAIN_MENU → SKIRMISH_SETUP → (game loads)
 *   MAIN_MENU → SINGLE_PLAYER → CHALLENGE_SELECT → (game loads)
 */

import {
  classifyCampaignLifecycle,
  isLiveCampaignLifecycle,
  resolveCampaignMapAssetPath,
} from '@generals/game-logic';
import {
  DEFAULT_PERSONAS,
  type GeneralPersona,
} from './challenge-generals.js';
import { resolveLocalizedText } from './localization.js';
import {
  DEFAULT_STARTING_CREDITS_OPTIONS,
  getDefaultStartingCreditsValue,
  type StartingCreditsOption,
} from './shell-runtime-data.js';

// ──── Types ─────────────────────────────────────────────────────────────────

export type GameDifficulty = 'EASY' | 'NORMAL' | 'HARD';

export interface ShellMission {
  name: string;
  mapName: string;
  nextMission: string;
  movieLabel: string;
  objectiveLines: string[];
  briefingVoice: string;
  locationNameLabel: string;
  unitNames: string[];
  voiceLength: number;
  generalName: string;
}

export interface ShellCampaign {
  name: string;
  firstMission: string;
  campaignNameLabel: string;
  finalMovieName: string;
  isChallengeCampaign: boolean;
  playerFactionName: string;
  missions: ShellMission[];
}

export type ShellScreen =
  | 'main-menu'
  | 'single-player'
  | 'skirmish-setup'
  | 'campaign-faction'
  | 'campaign-difficulty'
  | 'campaign-briefing'
  | 'challenge-select'
  | 'options';

export type GameMode = 'SKIRMISH' | 'CAMPAIGN' | 'CHALLENGE';

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

export interface CampaignStartSettings {
  gameMode: GameMode;
  campaignName: string;
  difficulty: GameDifficulty;
  /** Resolved map asset path for the first mission. */
  mapPath: string;
  /** The mission object (for briefing info). */
  mission: ShellMission;
  /** The campaign object. */
  campaign: ShellCampaign;
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
  /** Called when user starts a campaign mission. */
  onStartCampaign?(settings: CampaignStartSettings): void;
  /** Called when user opens the Options screen from the main menu. */
  onOpenOptions?(): void;
}

// ──── Faction / difficulty data ─────────────────────────────────────────────

const FACTIONS = [
  { side: 'America', label: 'USA', description: 'United States of America', campaignName: 'usa' },
  { side: 'China', label: 'China', description: "People's Republic of China", campaignName: 'china' },
  { side: 'GLA', label: 'GLA', description: 'Global Liberation Army', campaignName: 'gla' },
] as const;
const FACTION_BY_CAMPAIGN = new Map<string, (typeof FACTIONS)[number]>(
  FACTIONS.map((faction) => [faction.campaignName, faction] as const),
);

const DIFFICULTIES: { value: GameDifficulty; label: string; description: string }[] = [
  { value: 'EASY', label: 'Easy', description: 'For beginners' },
  { value: 'NORMAL', label: 'Normal', description: 'Standard challenge' },
  { value: 'HARD', label: 'Hard', description: 'For veterans' },
];

/** Escape HTML to prevent XSS from INI-sourced data. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ──── Challenge general data ────────────────────────────────────────────────

// Display colors per general (indexed by GeneralPersona.index)
const CHALLENGE_GENERAL_COLORS = [
  '#4488cc', '#66aa44', '#cc6622', '#8866cc', '#aa4444',
  '#cc8844', '#668866', '#886644', '#ccaa44',
];

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

  /* ── Shared panel (skirmish, campaign, etc.) ── */
  .shell-panel {
    background: rgba(12, 16, 28, 0.85);
    border: 1px solid rgba(201, 168, 76, 0.25);
    padding: 32px 40px;
    min-width: 520px;
    max-width: 600px;
  }
  .shell-panel-title {
    font-size: 1.6rem;
    color: #c9a84c;
    text-transform: uppercase;
    letter-spacing: 0.25em;
    margin-bottom: 28px;
    text-align: center;
  }
  .shell-section {
    margin-bottom: 20px;
  }
  .shell-label {
    display: block;
    font-size: 0.8rem;
    color: #8a8070;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    margin-bottom: 6px;
  }
  .shell-select {
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
  .shell-select:focus {
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
  .shell-actions {
    display: flex;
    gap: 12px;
    margin-top: 28px;
    justify-content: flex-end;
  }
  .shell-btn {
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
  .shell-btn:hover {
    background: rgba(201, 168, 76, 0.18);
    border-color: rgba(201, 168, 76, 0.7);
  }
  .shell-btn.primary {
    background: rgba(201, 168, 76, 0.2);
    border-color: #c9a84c;
  }
  .shell-btn.primary:hover {
    background: rgba(201, 168, 76, 0.35);
  }

  /* ── Difficulty buttons ── */
  .difficulty-row {
    display: flex;
    gap: 8px;
  }
  .difficulty-option {
    flex: 1;
    padding: 14px 8px;
    text-align: center;
    border: 1px solid rgba(201, 168, 76, 0.2);
    background: rgba(201, 168, 76, 0.04);
    color: #8a8070;
    font-size: 0.9rem;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .difficulty-option:hover {
    background: rgba(201, 168, 76, 0.1);
    color: #c9a84c;
  }
  .difficulty-option.selected {
    border-color: #c9a84c;
    background: rgba(201, 168, 76, 0.15);
    color: #e8d48b;
  }
  .difficulty-option .diff-name {
    font-weight: 600;
    font-size: 1rem;
  }
  .difficulty-option .diff-desc {
    font-size: 0.7rem;
    margin-top: 2px;
    opacity: 0.7;
  }

  /* ── Briefing screen ── */
  .briefing-info {
    color: #b0a890;
    font-size: 0.9rem;
    line-height: 1.6;
    margin-bottom: 8px;
  }
  .briefing-info strong {
    color: #c9a84c;
  }
  .briefing-objectives {
    margin-top: 12px;
    padding-left: 16px;
  }
  .briefing-objectives li {
    margin-bottom: 4px;
    color: #d0c8b0;
  }

  /* ── Challenge grid ── */
  .challenge-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-bottom: 20px;
  }
  .challenge-card {
    padding: 16px 12px;
    text-align: center;
    border: 1px solid rgba(201, 168, 76, 0.2);
    background: rgba(201, 168, 76, 0.04);
    color: #8a8070;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .challenge-card:hover {
    background: rgba(201, 168, 76, 0.1);
    color: #c9a84c;
  }
  .challenge-card.selected {
    border-color: #c9a84c;
    background: rgba(201, 168, 76, 0.15);
    color: #e8d48b;
  }
  .challenge-card .general-name {
    font-weight: 600;
    font-size: 0.95rem;
  }
  .challenge-card .general-faction {
    font-size: 0.7rem;
    margin-top: 3px;
    opacity: 0.7;
  }
  .challenge-card .general-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    margin-right: 6px;
    vertical-align: middle;
  }
`;

// ──── Shell class ───────────────────────────────────────────────────────────

export class GameShell {
  private root: HTMLElement;
  private callbacks: GameShellCallbacks;
  // DOM elements
  private styleEl: HTMLStyleElement | null = null;
  private screenEls = new Map<ShellScreen, HTMLElement>();

  // Skirmish state
  private availableMaps: MapInfo[] = [];
  private selectedMapIndex = -1; // -1 = procedural demo
  private playerSide = 'America';
  private aiEnabled = true;
  private aiSide = 'China';
  private startingCredits = getDefaultStartingCreditsValue(DEFAULT_STARTING_CREDITS_OPTIONS);
  private startingCreditsOptions: StartingCreditsOption[] = [...DEFAULT_STARTING_CREDITS_OPTIONS];

  // Campaign state
  private campaigns: ShellCampaign[] = [];
  private challengePersonas: GeneralPersona[] = [...DEFAULT_PERSONAS];
  private localizedStrings = new Map<string, string>();
  private selectedCampaignFaction = 'usa';
  private selectedDifficulty: GameDifficulty = 'NORMAL';
  private selectedChallengeIndex = 0;

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
  }

  /** Set parsed campaign data from CampaignManager. */
  setCampaigns(campaigns: readonly ShellCampaign[]): void {
    this.campaigns = campaigns.filter((campaign) =>
      isLiveCampaignLifecycle(classifyCampaignLifecycle(campaign.name).lifecycle),
    );
    if (!this.getStoryCampaignChoices().some((choice) => choice.campaignName === this.selectedCampaignFaction)) {
      this.selectedCampaignFaction = this.getStoryCampaignChoices()[0]?.campaignName ?? 'usa';
    }
  }

  setChallengePersonas(personas: readonly GeneralPersona[]): void {
    this.challengePersonas = personas.length > 0 ? [...personas] : [...DEFAULT_PERSONAS];
    if (!this.challengePersonas.some((persona) => persona.index === this.selectedChallengeIndex)) {
      this.selectedChallengeIndex = this.challengePersonas[0]?.index ?? 0;
    }
  }

  setStartingCreditsOptions(options: readonly StartingCreditsOption[]): void {
    this.startingCreditsOptions = options.length > 0 ? [...options] : [...DEFAULT_STARTING_CREDITS_OPTIONS];
    this.startingCredits = getDefaultStartingCreditsValue(this.startingCreditsOptions);
  }

  setLocalizedStrings(localizedStrings: ReadonlyMap<string, string>): void {
    this.localizedStrings = new Map(localizedStrings);
  }

  /** Show the shell and render the current screen. */
  show(): void {
    this.injectStyles();
    this.renderMainMenu();
    this.renderSkirmishSetup();
    this.renderSinglePlayerMenu();
    this.renderCampaignFactionSelect();
    this.renderCampaignDifficultySelect();
    this.renderCampaignBriefing();
    this.renderChallengeSelect();
    this.showScreen('main-menu');
  }

  /** Remove all shell DOM elements. */
  hide(): void {
    for (const el of this.screenEls.values()) {
      el.remove();
    }
    this.screenEls.clear();
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
  }

  /** Check if the shell is currently visible. */
  get isVisible(): boolean {
    return this.screenEls.size > 0;
  }

  // ──── Private: screen management ────────────────────────────────────────

  private showScreen(screen: ShellScreen): void {
    for (const [name, el] of this.screenEls) {
      el.classList.toggle('hidden', name !== screen);
    }
    // Refresh dynamic content on screen show
    if (screen === 'campaign-briefing') {
      this.updateBriefingContent();
    }
  }

  private addScreen(name: ShellScreen, el: HTMLElement): void {
    this.screenEls.set(name, el);
    this.root.appendChild(el);
  }

  private injectStyles(): void {
    if (this.styleEl) return;
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = SHELL_STYLES;
    document.head.appendChild(this.styleEl);
  }

  private resolveText(value: string): string {
    return resolveLocalizedText(value, this.localizedStrings);
  }

  private resolveChallengeName(persona: GeneralPersona): string {
    if (persona.bioNameLabel) {
      return this.resolveText(persona.bioNameLabel);
    }
    return persona.name;
  }

  private getStoryCampaignChoices(): Array<(typeof FACTIONS)[number]> {
    const storyCampaigns = this.campaigns.filter((campaign) => !campaign.isChallengeCampaign);
    if (storyCampaigns.length === 0) {
      return [...FACTIONS];
    }

    const storyNames = new Set(storyCampaigns.map((campaign) => campaign.name));
    return FACTIONS.filter((faction) => storyNames.has(faction.campaignName));
  }

  // ──── Private: Main Menu ────────────────────────────────────────────────

  private renderMainMenu(): void {
    if (this.screenEls.has('main-menu')) return;

    const el = document.createElement('div');
    el.className = 'shell-screen';
    el.id = 'main-menu-screen';

    el.innerHTML = `
      <div class="main-menu-title">Generals</div>
      <div class="main-menu-subtitle">Zero Hour &mdash; Browser Edition</div>
      <button class="menu-button" data-action="single-player">Single Player</button>
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
      if (action === 'single-player') {
        this.showScreen('single-player');
      } else if (action === 'skirmish') {
        this.showScreen('skirmish-setup');
      } else if (action === 'options') {
        this.callbacks.onOpenOptions?.();
      }
    });

    this.addScreen('main-menu', el);
  }

  // ──── Private: Single Player Menu ───────────────────────────────────────

  private renderSinglePlayerMenu(): void {
    if (this.screenEls.has('single-player')) return;

    const el = document.createElement('div');
    el.className = 'shell-screen hidden';
    el.id = 'single-player-screen';

    el.innerHTML = `
      <div class="main-menu-title" style="font-size:2.2rem;">Single Player</div>
      <div class="main-menu-subtitle">Choose your path</div>
      <button class="menu-button" data-action="campaign">Campaign</button>
      <button class="menu-button" data-action="challenge">Generals Challenge</button>
      <button class="menu-button" data-action="back">Back</button>
    `;

    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'campaign') {
        this.showScreen('campaign-faction');
      } else if (action === 'challenge') {
        this.showScreen('challenge-select');
      } else if (action === 'back') {
        this.showScreen('main-menu');
      }
    });

    this.addScreen('single-player', el);
  }

  // ──── Private: Campaign Faction Select ──────────────────────────────────

  private renderCampaignFactionSelect(): void {
    if (this.screenEls.has('campaign-faction')) return;

    const el = document.createElement('div');
    el.className = 'shell-screen hidden';
    el.id = 'campaign-faction-screen';
    const campaignChoices = this.getStoryCampaignChoices();

    el.innerHTML = `
      <div class="shell-panel">
        <div class="shell-panel-title">Select Faction</div>
        <div class="shell-section">
          <div class="faction-row" data-ref="campaign-factions">
            ${campaignChoices.map((choice) => {
              const campaign = this.campaigns.find((entry) => entry.name === choice.campaignName);
              const label = campaign?.campaignNameLabel
                ? this.resolveText(campaign.campaignNameLabel)
                : choice.label;
              return `
              <button class="faction-option${choice.campaignName === this.selectedCampaignFaction ? ' selected' : ''}"
                      data-campaign="${choice.campaignName}">
                <div class="faction-name">${esc(label)}</div>
                <div class="faction-desc">${esc(choice.description)}</div>
              </button>
            `;
            }).join('')}
          </div>
        </div>
        <div class="shell-actions">
          <button class="shell-btn" data-action="back">Back</button>
          <button class="shell-btn primary" data-action="next">Next</button>
        </div>
      </div>
    `;

    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action], [data-campaign]') as HTMLElement | null;
      if (!target) return;

      if (target.dataset.campaign) {
        this.selectedCampaignFaction = target.dataset.campaign;
        const btns = el.querySelectorAll<HTMLButtonElement>('.faction-option');
        btns.forEach(b => b.classList.toggle('selected', b.dataset.campaign === this.selectedCampaignFaction));
        return;
      }

      if (target.dataset.action === 'back') {
        this.showScreen('single-player');
      } else if (target.dataset.action === 'next') {
        this.showScreen('campaign-difficulty');
      }
    });

    this.addScreen('campaign-faction', el);
  }

  // ──── Private: Campaign Difficulty Select ───────────────────────────────

  private renderCampaignDifficultySelect(): void {
    if (this.screenEls.has('campaign-difficulty')) return;

    const el = document.createElement('div');
    el.className = 'shell-screen hidden';
    el.id = 'campaign-difficulty-screen';

    el.innerHTML = `
      <div class="shell-panel">
        <div class="shell-panel-title">Select Difficulty</div>
        <div class="shell-section">
          <div class="difficulty-row" data-ref="difficulty-options">
            ${DIFFICULTIES.map(d => `
              <button class="difficulty-option${d.value === this.selectedDifficulty ? ' selected' : ''}"
                      data-difficulty="${d.value}">
                <div class="diff-name">${d.label}</div>
                <div class="diff-desc">${d.description}</div>
              </button>
            `).join('')}
          </div>
        </div>
        <div class="shell-actions">
          <button class="shell-btn" data-action="back">Back</button>
          <button class="shell-btn primary" data-action="start">Start Campaign</button>
        </div>
      </div>
    `;

    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action], [data-difficulty]') as HTMLElement | null;
      if (!target) return;

      if (target.dataset.difficulty) {
        this.selectedDifficulty = target.dataset.difficulty as GameDifficulty;
        const btns = el.querySelectorAll<HTMLButtonElement>('.difficulty-option');
        btns.forEach(b => b.classList.toggle('selected', b.dataset.difficulty === this.selectedDifficulty));
        return;
      }

      if (target.dataset.action === 'back') {
        this.showScreen('campaign-faction');
      } else if (target.dataset.action === 'start') {
        this.showScreen('campaign-briefing');
      }
    });

    this.addScreen('campaign-difficulty', el);
  }

  // ──── Private: Campaign Briefing ────────────────────────────────────────

  private renderCampaignBriefing(): void {
    if (this.screenEls.has('campaign-briefing')) return;

    const el = document.createElement('div');
    el.className = 'shell-screen hidden';
    el.id = 'campaign-briefing-screen';

    el.innerHTML = `
      <div class="shell-panel" style="min-width:560px;">
        <div class="shell-panel-title">Mission Briefing</div>
        <div data-ref="briefing-content"></div>
        <div class="shell-actions">
          <button class="shell-btn" data-action="back">Back</button>
          <button class="shell-btn primary" data-action="start">Start Mission</button>
        </div>
      </div>
    `;

    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!target) return;

      if (target.dataset.action === 'back') {
        this.showScreen('campaign-difficulty');
      } else if (target.dataset.action === 'start') {
        this.handleStartCampaign(this.selectedCampaignFaction, this.selectedDifficulty, 'CAMPAIGN');
      }
    });

    this.addScreen('campaign-briefing', el);
  }

  private updateBriefingContent(): void {
    const briefingEl = this.screenEls.get('campaign-briefing');
    if (!briefingEl) return;
    const contentEl = briefingEl.querySelector('[data-ref="briefing-content"]');
    if (!contentEl) return;

    const campaign = this.campaigns.find(c => c.name === this.selectedCampaignFaction);
    if (!campaign || campaign.missions.length === 0) {
      contentEl.innerHTML = '<div class="briefing-info">No mission data available.</div>';
      return;
    }

    const mission = campaign.missions[0]!;
    const factionLabel = campaign.campaignNameLabel
      ? this.resolveText(campaign.campaignNameLabel)
      : (FACTION_BY_CAMPAIGN.get(this.selectedCampaignFaction)?.label ?? campaign.name);
    const locationLabel = mission.locationNameLabel ? this.resolveText(mission.locationNameLabel) : '';
    const generalName = mission.generalName ? this.resolveText(mission.generalName) : '';
    const objectiveLines = mission.objectiveLines
      .map((objective) => this.resolveText(objective))
      .filter((objective) => objective.trim().length > 0);
    const unitNames = mission.unitNames
      .map((unitName) => this.resolveText(unitName))
      .filter((unitName) => unitName.trim().length > 0);

    let html = `
      <div class="briefing-info">
        <strong>Campaign:</strong> ${esc(factionLabel)}
    `;
    if (locationLabel) {
      html += `<br><strong>Location:</strong> ${esc(locationLabel)}`;
    }
    if (generalName) {
      html += `<br><strong>Opponent:</strong> ${esc(generalName)}`;
    }
    html += '</div>';

    if (objectiveLines.length > 0) {
      html += '<ul class="briefing-objectives">';
      for (const obj of objectiveLines) {
        html += `<li>${esc(obj)}</li>`;
      }
      html += '</ul>';
    }

    if (unitNames.length > 0) {
      html += `<div class="briefing-info"><strong>Key Units:</strong> ${unitNames.map(esc).join(', ')}</div>`;
    }

    contentEl.innerHTML = html;
  }

  // ──── Private: Challenge Select ─────────────────────────────────────────

  private renderChallengeSelect(): void {
    if (this.screenEls.has('challenge-select')) return;

    const el = document.createElement('div');
    el.className = 'shell-screen hidden';
    el.id = 'challenge-select-screen';

    el.innerHTML = `
      <div class="shell-panel" style="min-width:480px; max-width:520px;">
        <div class="shell-panel-title">Generals Challenge</div>
        <div class="shell-section">
          <div class="shell-label">Select Your General</div>
          <div class="challenge-grid" data-ref="challenge-grid">
            ${this.challengePersonas.map(g => `
              <button class="challenge-card${g.index === this.selectedChallengeIndex ? ' selected' : ''}"
                      data-challenge="${g.index}">
                <span class="general-indicator" style="background:${CHALLENGE_GENERAL_COLORS[g.index] ?? '#888'};"></span>
                <span class="general-name">${esc(this.resolveChallengeName(g))}</span>
                <div class="general-faction">${esc(g.faction)}</div>
              </button>
            `).join('')}
          </div>
        </div>
        <div class="shell-section">
          <div class="shell-label">Difficulty</div>
          <div class="difficulty-row" data-ref="challenge-difficulty">
            ${DIFFICULTIES.map(d => `
              <button class="difficulty-option${d.value === this.selectedDifficulty ? ' selected' : ''}"
                      data-difficulty="${d.value}">
                <div class="diff-name">${d.label}</div>
              </button>
            `).join('')}
          </div>
        </div>
        <div class="shell-actions">
          <button class="shell-btn" data-action="back">Back</button>
          <button class="shell-btn primary" data-action="start">Start Challenge</button>
        </div>
      </div>
    `;

    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action], [data-challenge], [data-difficulty]') as HTMLElement | null;
      if (!target) return;

      if (target.dataset.challenge !== undefined) {
        this.selectedChallengeIndex = Number(target.dataset.challenge);
        const cards = el.querySelectorAll<HTMLButtonElement>('.challenge-card');
        cards.forEach(c => c.classList.toggle('selected', c.dataset.challenge === String(this.selectedChallengeIndex)));
        return;
      }

      if (target.dataset.difficulty) {
        this.selectedDifficulty = target.dataset.difficulty as GameDifficulty;
        const btns = el.querySelectorAll<HTMLButtonElement>('.difficulty-option');
        btns.forEach(b => b.classList.toggle('selected', b.dataset.difficulty === this.selectedDifficulty));
        return;
      }

      if (target.dataset.action === 'back') {
        this.showScreen('single-player');
      } else if (target.dataset.action === 'start') {
        const general = this.challengePersonas.find((persona) => persona.index === this.selectedChallengeIndex);
        if (general) {
          this.handleStartCampaign(general.campaignName, this.selectedDifficulty, 'CHALLENGE');
        }
      }
    });

    this.addScreen('challenge-select', el);
  }

  // ──── Private: Skirmish Setup ───────────────────────────────────────────

  private renderSkirmishSetup(): void {
    if (this.screenEls.has('skirmish-setup')) return;

    const el = document.createElement('div');
    el.className = 'shell-screen hidden';
    el.id = 'skirmish-setup-screen';

    // Build map options
    const mapOptionsHtml = this.buildMapOptionsHtml();
    const creditsOptionsHtml = this.startingCreditsOptions.map(opt =>
      `<option value="${opt.value}"${opt.value === this.startingCredits ? ' selected' : ''}>${opt.label}</option>`,
    ).join('');

    el.innerHTML = `
      <div class="shell-panel">
        <div class="shell-panel-title">Skirmish Setup</div>

        <div class="shell-section">
          <label class="shell-label">Map</label>
          <select class="shell-select" data-ref="map-select">
            ${mapOptionsHtml}
          </select>
        </div>

        <div class="shell-section">
          <label class="shell-label">Your Faction</label>
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

        <div class="shell-section">
          <label class="shell-label">AI Opponent</label>
          <div class="ai-toggle-row">
            <button class="ai-toggle-btn${this.aiEnabled ? ' active' : ''}"
                    data-ref="ai-toggle">
              ${this.aiEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>

        <div class="shell-section" data-ref="ai-side-section"
             style="${this.aiEnabled ? '' : 'display:none'}">
          <label class="shell-label">AI Faction</label>
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

        <div class="shell-section">
          <label class="shell-label">Starting Credits</label>
          <select class="shell-select" data-ref="credits-select">
            ${creditsOptionsHtml}
          </select>
        </div>

        <div class="shell-actions">
          <button class="shell-btn" data-action="back">Back</button>
          <button class="shell-btn primary" data-action="start">Start Game</button>
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

    this.addScreen('skirmish-setup', el);
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

  private handleStartCampaign(campaignName: string, difficulty: GameDifficulty, mode: GameMode): void {
    const campaign = this.campaigns.find(c => c.name === campaignName);
    if (!campaign || campaign.missions.length === 0) {
      console.warn(`[GameShell] Campaign "${campaignName}" not found or has no missions`);
      return;
    }

    const firstMissionName = campaign.firstMission;
    const mission = campaign.missions.find((m: ShellMission) => m.name === firstMissionName) ?? campaign.missions[0]!;

    // Resolve map path
    const mapPath = resolveCampaignMapAssetPath(mission.mapName);
    if (!mapPath) {
      console.warn(`[GameShell] Mission "${mission.name}" has no valid map path`);
      return;
    }

    const settings: CampaignStartSettings = {
      gameMode: mode,
      campaignName,
      difficulty,
      mapPath,
      mission,
      campaign,
    };

    this.callbacks.onStartCampaign?.(settings);
  }
}
