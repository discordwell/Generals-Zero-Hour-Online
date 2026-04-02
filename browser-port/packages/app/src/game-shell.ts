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

interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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

/**
 * Filter out non-skirmish maps by naming convention.
 *
 * Source parity: the original engine filters by an isMultiplayer flag
 * embedded in each .map file header.  We approximate this with name
 * heuristics since the browser port's map converter doesn't yet extract
 * that flag.
 */
const NON_SKIRMISH_PREFIXES = ['MD ', 'GC ', 'ShellMap', 'USA05 ', 'USA07'];
const NON_SKIRMISH_SUFFIXES = ['CINE', 'INTRO', 'END', 'END1', 'Sound'];
const NON_SKIRMISH_EXACT = new Set([
  'AllBuildingsAllSidesUnitTest Save',
  'BUG SavedGameandEnabledFolders',
  'Art Review New Units',
  'ScenarioSkirmish',
  'SmokeTest',
  'Hovercraft',
]);

export function isSkirmishMapName(name: string): boolean {
  if (!name) return false;
  if (NON_SKIRMISH_EXACT.has(name)) return false;
  for (const prefix of NON_SKIRMISH_PREFIXES) {
    if (name.startsWith(prefix)) return false;
  }
  const lastWord = name.split(' ').pop() ?? '';
  for (const suffix of NON_SKIRMISH_SUFFIXES) {
    if (lastWord === suffix) return false;
  }
  return true;
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

const SHELL_SOURCE_RESOLUTION = { width: 800, height: 600 } as const;
const MAIN_MENU_PREVIEW_RECT: SourceRect = { x: 88, y: 108, width: 388, height: 388 };
const MAIN_MENU_ACTION_PANEL_RECT: SourceRect = { x: 532, y: 108, width: 224, height: 212 };
const MAIN_MENU_LOGO_RECT: SourceRect = { x: 504, y: 16, width: 287, height: 94 };
const SINGLE_PLAYER_ACTION_PANEL_RECT: SourceRect = { x: 532, y: 108, width: 224, height: 252 };
const MAIN_MENU_BUTTON_LAYOUT = [
  { action: 'single-player', label: 'Single Player', rect: { x: 540, y: 116, width: 208, height: 36 }, disabled: false },
  { action: 'multiplayer', label: 'Multiplayer', rect: { x: 540, y: 156, width: 208, height: 36 }, disabled: true },
  { action: 'replay', label: 'Replay', rect: { x: 540, y: 196, width: 208, height: 35 }, disabled: true },
  { action: 'options', label: 'Options', rect: { x: 540, y: 236, width: 208, height: 36 }, disabled: false },
  { action: 'exit', label: 'Exit', rect: { x: 540, y: 316, width: 208, height: 36 }, disabled: false },
] as const satisfies ReadonlyArray<{
  action: 'single-player' | 'multiplayer' | 'replay' | 'options' | 'exit';
  label: string;
  rect: SourceRect;
  disabled: boolean;
}>;
const SINGLE_PLAYER_BUTTON_LAYOUT = [
  { action: 'campaign-usa', label: 'USA', rect: { x: 540, y: 116, width: 208, height: 36 } },
  { action: 'campaign-gla', label: 'GLA', rect: { x: 540, y: 156, width: 208, height: 36 } },
  { action: 'campaign-china', label: 'CHINA', rect: { x: 540, y: 196, width: 208, height: 35 } },
  { action: 'challenge', label: 'Generals Challenge', rect: { x: 540, y: 236, width: 208, height: 36 } },
  { action: 'skirmish', label: 'Skirmish', rect: { x: 540, y: 276, width: 208, height: 36 } },
  { action: 'back', label: 'Back', rect: { x: 540, y: 316, width: 208, height: 35 } },
] as const satisfies ReadonlyArray<{
  action: 'campaign-usa' | 'campaign-gla' | 'campaign-china' | 'challenge' | 'skirmish' | 'back';
  label: string;
  rect: SourceRect;
}>;
const DIFFICULTY_DIALOG_PARENT_RECT: SourceRect = { x: 156, y: 120, width: 436, height: 296 };
const DIFFICULTY_DIALOG_PANEL_RECT: SourceRect = { x: 224, y: 180, width: 288, height: 188 };
const DIFFICULTY_DIALOG_TITLE_RECT: SourceRect = { x: 232, y: 188, width: 268, height: 28 };
const DIFFICULTY_OPTION_LAYOUT = [
  { value: 'EASY', label: 'Easy', rect: { x: 288, y: 220, width: 152, height: 32 } },
  { value: 'NORMAL', label: 'Medium', rect: { x: 288, y: 256, width: 152, height: 32 } },
  { value: 'HARD', label: 'Hard', rect: { x: 288, y: 292, width: 152, height: 32 } },
] as const satisfies ReadonlyArray<{
  value: GameDifficulty;
  label: string;
  rect: SourceRect;
}>;
const DIFFICULTY_OK_RECT: SourceRect = { x: 236, y: 328, width: 128, height: 28 };
const DIFFICULTY_CANCEL_RECT: SourceRect = { x: 372, y: 328, width: 128, height: 28 };

/** Escape HTML to prevent XSS from INI-sourced data. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatSourcePercent(value: number, total: number): string {
  return `${((value / total) * 100).toFixed(6)}%`;
}

function formatSourceRectStyle(rect: SourceRect): string {
  return [
    `left:${formatSourcePercent(rect.x, SHELL_SOURCE_RESOLUTION.width)}`,
    `top:${formatSourcePercent(rect.y, SHELL_SOURCE_RESOLUTION.height)}`,
    `width:${formatSourcePercent(rect.width, SHELL_SOURCE_RESOLUTION.width)}`,
    `height:${formatSourcePercent(rect.height, SHELL_SOURCE_RESOLUTION.height)}`,
  ].join(';');
}

function formatSourceRectData(rect: SourceRect): string {
  return `${rect.x},${rect.y},${rect.width},${rect.height}`;
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

  .retail-main-menu-screen {
    display: block;
    overflow: hidden;
    background:
      radial-gradient(circle at 20% 36%, rgba(34, 88, 166, 0.28) 0%, rgba(18, 35, 72, 0.18) 26%, rgba(0, 0, 0, 0) 56%),
      linear-gradient(180deg, #07101d 0%, #090d16 58%, #05070d 100%);
  }
  .retail-main-menu-screen::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, rgba(6, 8, 14, 0.88) 0%, rgba(6, 8, 14, 0.2) 18%, rgba(6, 8, 14, 0.12) 82%, rgba(6, 8, 14, 0.9) 100%),
      linear-gradient(90deg, transparent 55%, rgba(111, 149, 224, 0.16) 55.12%, transparent 55.24%);
    pointer-events: none;
  }
  .retail-source-rect {
    position: absolute;
    box-sizing: border-box;
  }
  .main-menu-preview-panel {
    z-index: 1;
    border: 1px solid rgba(68, 95, 153, 0.72);
    background:
      radial-gradient(circle at 34% 32%, rgba(101, 154, 226, 0.26) 0%, rgba(44, 84, 138, 0.16) 18%, rgba(0, 0, 0, 0) 44%),
      linear-gradient(180deg, rgba(9, 17, 31, 0.92) 0%, rgba(4, 7, 13, 0.98) 100%);
    box-shadow:
      inset 0 0 0 1px rgba(5, 9, 17, 0.92),
      0 0 26px rgba(0, 0, 0, 0.28);
  }
  .main-menu-preview-panel::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(rgba(142, 178, 239, 0.08) 1px, transparent 1px),
      linear-gradient(90deg, rgba(142, 178, 239, 0.08) 1px, transparent 1px);
    background-size: 11% 11%, 11% 11%;
    opacity: 0.45;
  }
  .main-menu-preview-panel::after {
    content: '';
    position: absolute;
    inset: 8% 11%;
    border-radius: 50%;
    background:
      radial-gradient(circle at 40% 34%, rgba(157, 205, 255, 0.44) 0%, rgba(76, 131, 205, 0.22) 22%, rgba(10, 18, 34, 0.14) 52%, rgba(0, 0, 0, 0) 70%);
    filter: blur(2px);
    opacity: 0.9;
  }
  .main-menu-action-panel {
    z-index: 1;
    border: 1px solid rgba(68, 95, 153, 0.88);
    background:
      linear-gradient(180deg, rgba(7, 11, 21, 0.78) 0%, rgba(3, 4, 9, 0.92) 100%);
    box-shadow:
      inset 0 0 0 1px rgba(4, 8, 14, 0.92),
      0 0 22px rgba(0, 0, 0, 0.24);
  }
  .main-menu-logo {
    z-index: 2;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: flex-end;
    padding: 0 0.75rem 0.5rem 0;
    color: #d0ab4d;
    font-family: Georgia, 'Times New Roman', serif;
    text-align: right;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.56);
  }
  .main-menu-logo-mark {
    font-size: clamp(2.25rem, 5.1vw, 4.4rem);
    line-height: 0.9;
    letter-spacing: 0.22em;
    font-weight: 700;
  }
  .main-menu-logo-submark {
    margin-top: 0.35rem;
    font-size: clamp(0.8rem, 1.3vw, 1rem);
    line-height: 1;
    letter-spacing: 0.42em;
    color: #9a8757;
  }
  .retail-main-menu-screen .menu-button {
    margin: 0;
    padding: 0;
  }
  .retail-main-menu-button {
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(132, 157, 216, 0.84);
    background:
      linear-gradient(180deg, rgba(44, 64, 132, 0.96) 0%, rgba(20, 30, 74, 0.98) 58%, rgba(9, 14, 37, 0.99) 100%);
    box-shadow: inset 0 0 0 1px rgba(7, 11, 19, 0.76);
    color: #f6f8ff;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(0.95rem, 1.35vw, 1.35rem);
    text-transform: none;
    letter-spacing: 0.12em;
  }
  .retail-main-menu-button:hover {
    background:
      linear-gradient(180deg, rgba(72, 94, 168, 0.98) 0%, rgba(29, 45, 96, 0.99) 58%, rgba(11, 17, 43, 1) 100%);
    color: #c7ff5b;
  }
  .retail-main-menu-button:active {
    background:
      linear-gradient(180deg, rgba(30, 44, 90, 0.98) 0%, rgba(17, 25, 58, 1) 100%);
  }
  .retail-main-menu-button.disabled {
    opacity: 1;
    border-color: rgba(74, 83, 112, 0.88);
    background:
      linear-gradient(180deg, rgba(22, 27, 46, 0.92) 0%, rgba(11, 15, 27, 0.98) 100%);
    color: #5d698a;
  }
  .retail-dialog-screen {
    display: block;
    overflow: hidden;
    background: rgba(4, 6, 11, 0.52);
  }
  .retail-dialog-parent {
    z-index: 1;
    border: 1px solid rgba(34, 44, 72, 0.72);
    background: rgba(0, 0, 0, 0.22);
  }
  .retail-dialog-panel {
    z-index: 2;
    border: 1px solid rgba(73, 96, 148, 0.9);
    background:
      linear-gradient(180deg, rgba(9, 15, 31, 0.96) 0%, rgba(4, 7, 15, 0.98) 100%);
    box-shadow:
      inset 0 0 0 1px rgba(3, 6, 12, 0.86),
      0 0 22px rgba(0, 0, 0, 0.2);
  }
  .retail-dialog-title {
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #f1f4ff;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(0.95rem, 1.2vw, 1.2rem);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .retail-difficulty-option {
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.75rem;
    padding: 0 0.9rem;
    border: 1px solid rgba(88, 111, 171, 0.8);
    background:
      linear-gradient(180deg, rgba(18, 28, 67, 0.95) 0%, rgba(8, 14, 34, 0.98) 100%);
    box-shadow: inset 0 0 0 1px rgba(4, 7, 14, 0.78);
    color: #f3f6ff;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(0.85rem, 1.05vw, 1rem);
    letter-spacing: 0.08em;
    text-transform: none;
  }
  .retail-difficulty-option::before {
    content: '';
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    border: 1px solid rgba(155, 176, 229, 0.9);
    background: rgba(7, 12, 28, 0.92);
    box-shadow: inset 0 0 0 1px rgba(5, 8, 14, 0.82);
    flex: 0 0 auto;
  }
  .retail-difficulty-option.selected {
    color: #cbff63;
    border-color: rgba(139, 166, 82, 0.88);
    background:
      linear-gradient(180deg, rgba(42, 60, 28, 0.95) 0%, rgba(12, 20, 10, 0.98) 100%);
  }
  .retail-difficulty-option.selected::before {
    background: #cbff63;
    border-color: #cbff63;
    box-shadow: 0 0 10px rgba(203, 255, 99, 0.5);
  }
  .retail-dialog-button {
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(88, 111, 171, 0.88);
    background:
      linear-gradient(180deg, rgba(34, 50, 108, 0.96) 0%, rgba(12, 18, 44, 0.99) 100%);
    box-shadow: inset 0 0 0 1px rgba(5, 9, 17, 0.8);
    color: #f4f7ff;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(0.85rem, 1.05vw, 1rem);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .retail-dialog-button:hover {
    color: #cbff63;
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
   * Filters output paths starting with "maps/" and ending with ".json",
   * then strips internal extraction prefixes so only the map's display
   * name is shown.  Non-skirmish maps (campaign, cinematics, shell maps,
   * challenge and test maps) are excluded.
   *
   * Source parity: SkirmishGameOptionsMenu.cpp populates the map list
   * from the Maps/ directory, filtering by isMultiplayer flag.  We
   * approximate this with naming-convention heuristics.
   */
  setAvailableMaps(outputPaths: string[]): void {
    this.availableMaps = outputPaths
      .filter(p => /^maps\//i.test(p) && p.endsWith('.json'))
      .map(p => {
        // Extract the basename (final path segment without extension).
        const segments = p.replace(/\.json$/i, '').split('/');
        const basename = segments[segments.length - 1] ?? '';
        return {
          path: p,
          name: basename.replace(/_/g, ' ').trim(),
        };
      })
      .filter(m => isSkirmishMapName(m.name))
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
    el.className = 'shell-screen retail-main-menu-screen';
    el.id = 'main-menu-screen';

    const buttonsHtml = MAIN_MENU_BUTTON_LAYOUT.map((button) => `
      <button
        class="menu-button retail-main-menu-button retail-source-rect${button.disabled ? ' disabled' : ''}"
        data-action="${button.action}"
        data-source-rect="${formatSourceRectData(button.rect)}"
        style="${formatSourceRectStyle(button.rect)}"
      >${button.label}</button>
    `).join('');

    el.innerHTML = `
      <div
        class="main-menu-preview-panel retail-source-rect"
        data-ref="main-menu-preview"
        data-source-rect="${formatSourceRectData(MAIN_MENU_PREVIEW_RECT)}"
        style="${formatSourceRectStyle(MAIN_MENU_PREVIEW_RECT)}"
      ></div>
      <div
        class="main-menu-action-panel retail-source-rect"
        data-ref="main-menu-action-panel"
        data-source-rect="${formatSourceRectData(MAIN_MENU_ACTION_PANEL_RECT)}"
        style="${formatSourceRectStyle(MAIN_MENU_ACTION_PANEL_RECT)}"
      ></div>
      <div
        class="main-menu-logo retail-source-rect"
        data-ref="main-menu-logo"
        data-source-rect="${formatSourceRectData(MAIN_MENU_LOGO_RECT)}"
        style="${formatSourceRectStyle(MAIN_MENU_LOGO_RECT)}"
      >
        <div class="main-menu-logo-mark">GENERALS</div>
        <div class="main-menu-logo-submark">ZERO HOUR</div>
      </div>
      ${buttonsHtml}
    `;

    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'single-player') {
        this.showScreen('single-player');
      } else if (action === 'options') {
        this.callbacks.onOpenOptions?.();
      } else if (action === 'exit') {
        window.close();
      }
    });

    this.addScreen('main-menu', el);
  }

  // ──── Private: Single Player Menu ───────────────────────────────────────

  private renderSinglePlayerMenu(): void {
    if (this.screenEls.has('single-player')) return;

    const el = document.createElement('div');
    el.className = 'shell-screen hidden retail-main-menu-screen';
    el.id = 'single-player-screen';

    const buttonsHtml = SINGLE_PLAYER_BUTTON_LAYOUT.map((button) => `
      <button
        class="menu-button retail-main-menu-button retail-source-rect"
        data-action="${button.action}"
        data-source-rect="${formatSourceRectData(button.rect)}"
        style="${formatSourceRectStyle(button.rect)}"
      >${button.label}</button>
    `).join('');

    el.innerHTML = `
      <div
        class="main-menu-preview-panel retail-source-rect"
        data-ref="single-player-preview"
        data-source-rect="${formatSourceRectData(MAIN_MENU_PREVIEW_RECT)}"
        style="${formatSourceRectStyle(MAIN_MENU_PREVIEW_RECT)}"
      ></div>
      <div
        class="main-menu-action-panel retail-source-rect"
        data-ref="single-player-action-panel"
        data-source-rect="${formatSourceRectData(SINGLE_PLAYER_ACTION_PANEL_RECT)}"
        style="${formatSourceRectStyle(SINGLE_PLAYER_ACTION_PANEL_RECT)}"
      ></div>
      <div
        class="main-menu-logo retail-source-rect"
        data-ref="single-player-logo"
        data-source-rect="${formatSourceRectData(MAIN_MENU_LOGO_RECT)}"
        style="${formatSourceRectStyle(MAIN_MENU_LOGO_RECT)}"
      >
        <div class="main-menu-logo-mark">GENERALS</div>
        <div class="main-menu-logo-submark">ZERO HOUR</div>
      </div>
      ${buttonsHtml}
    `;

    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'campaign-usa') {
        this.selectedCampaignFaction = 'usa';
        this.showScreen('campaign-difficulty');
      } else if (action === 'campaign-gla') {
        this.selectedCampaignFaction = 'gla';
        this.showScreen('campaign-difficulty');
      } else if (action === 'campaign-china') {
        this.selectedCampaignFaction = 'china';
        this.showScreen('campaign-difficulty');
      } else if (action === 'skirmish') {
        this.showScreen('skirmish-setup');
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
    el.className = 'shell-screen hidden retail-dialog-screen';
    el.id = 'campaign-difficulty-screen';

    const difficultyButtonsHtml = DIFFICULTY_OPTION_LAYOUT.map((difficulty) => `
      <button
        class="difficulty-option retail-difficulty-option retail-source-rect${difficulty.value === this.selectedDifficulty ? ' selected' : ''}"
        data-difficulty="${difficulty.value}"
        data-source-rect="${formatSourceRectData(difficulty.rect)}"
        style="${formatSourceRectStyle(difficulty.rect)}"
      >${difficulty.label}</button>
    `).join('');

    el.innerHTML = `
      <div
        class="retail-dialog-parent retail-source-rect"
        data-ref="campaign-difficulty-parent"
        data-source-rect="${formatSourceRectData(DIFFICULTY_DIALOG_PARENT_RECT)}"
        style="${formatSourceRectStyle(DIFFICULTY_DIALOG_PARENT_RECT)}"
      ></div>
      <div
        class="retail-dialog-panel retail-source-rect"
        data-ref="campaign-difficulty-panel"
        data-source-rect="${formatSourceRectData(DIFFICULTY_DIALOG_PANEL_RECT)}"
        style="${formatSourceRectStyle(DIFFICULTY_DIALOG_PANEL_RECT)}"
      ></div>
      <div
        class="retail-dialog-title retail-source-rect"
        data-ref="campaign-difficulty-title"
        data-source-rect="${formatSourceRectData(DIFFICULTY_DIALOG_TITLE_RECT)}"
        style="${formatSourceRectStyle(DIFFICULTY_DIALOG_TITLE_RECT)}"
      >Select Difficulty</div>
      <div data-ref="difficulty-options">${difficultyButtonsHtml}</div>
      <button
        class="shell-btn retail-dialog-button retail-source-rect"
        data-action="start"
        data-ref="campaign-difficulty-ok"
        data-source-rect="${formatSourceRectData(DIFFICULTY_OK_RECT)}"
        style="${formatSourceRectStyle(DIFFICULTY_OK_RECT)}"
      >OK</button>
      <button
        class="shell-btn retail-dialog-button retail-source-rect"
        data-action="back"
        data-ref="campaign-difficulty-cancel"
        data-source-rect="${formatSourceRectData(DIFFICULTY_CANCEL_RECT)}"
        style="${formatSourceRectStyle(DIFFICULTY_CANCEL_RECT)}"
      >Cancel</button>
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
        this.showScreen('single-player');
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
