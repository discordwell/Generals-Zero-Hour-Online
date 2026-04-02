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
 *   MAIN_MENU → SINGLE_PLAYER → CAMPAIGN_DIFFICULTY → CAMPAIGN_BRIEFING → (game loads)
 *   MAIN_MENU → SKIRMISH_SETUP → (game loads)
 *   MAIN_MENU → SINGLE_PLAYER → CAMPAIGN_DIFFICULTY → CHALLENGE_SELECT → (game loads)
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

export interface ShellMappedImageEntry {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ShellMappedImageResolver {
  resolve(name: string): Promise<string | null>;
  getEntry?(name: string): ShellMappedImageEntry | undefined;
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

const SHELL_SOURCE_RESOLUTION = { width: 800, height: 600 } as const;
const FULL_SCREEN_SOURCE_RECT: SourceRect = { x: 0, y: 0, width: 800, height: 600 };
const MAIN_MENU_PREVIEW_RECT: SourceRect = { x: 88, y: 108, width: 388, height: 388 };
const MAIN_MENU_ACTION_PANEL_RECT: SourceRect = { x: 532, y: 108, width: 224, height: 252 };
const MAIN_MENU_LOGO_RECT: SourceRect = { x: 504, y: 16, width: 287, height: 94 };
const SINGLE_PLAYER_ACTION_PANEL_RECT: SourceRect = { x: 532, y: 108, width: 224, height: 252 };
const RETAIL_MENU_ACTION_MAP_INSET_BOTTOM = 8;
const RETAIL_MENU_PULSE_SOURCE_SIZE = { width: 139, height: 21 } as const;
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
const MAIN_MENU_BACKDROP_IMAGE = 'MainMenuBackdrop';
const MAIN_MENU_LOGO_IMAGE = 'GeneralsLogo';
const MAIN_MENU_RULER_IMAGE = 'MainMenuRuler';
const MAIN_MENU_ACTION_MAP_IMAGE = 'EarthMap';
const MAIN_MENU_PULSE_IMAGE = 'MainMenuPulse';
const CHALLENGE_MENU_BACKGROUND_IMAGE = 'GCBackgroundMinSpec';
const RETAIL_MENU_BUTTON_SKINS = {
  enabled: { left: 'Buttons-Left', middle: 'Buttons-Middle', right: 'Buttons-Right' },
  hilite: { left: 'Buttons-HiLite-Left', middle: 'Buttons-HiLite-Middle', right: 'Buttons-HiLite-Right' },
  pushed: { left: 'Buttons-Pushed-Left', middle: 'Buttons-Pushed-Middle', right: 'Buttons-Pushed-Right' },
  disabled: { left: 'Buttons-Disabled-Left', middle: 'Buttons-Disabled-Middle', right: 'Buttons-Disabled-Right' },
} as const;
const RETAIL_MENU_FRAME_CORNERS = {
  ul: 'FrameCornerUL',
  ur: 'FrameCornerUR',
  ll: 'FrameCornerLL',
  lr: 'FrameCornerLR',
} as const;
const CAMPAIGN_LOAD_BACKGROUND_BY_CAMPAIGN: Record<string, string> = {
  usa: 'MissionLoad_USA',
  gla: 'MissionLoad_GLA',
  china: 'MissionLoad_China',
};
const CHALLENGE_MENU_BACKGROUND_RECT: SourceRect = { x: 0, y: 0, width: 799, height: 599 };
const CHALLENGE_MENU_FRAME_RECT: SourceRect = { x: 41, y: 40, width: 719, height: 521 };
const CHALLENGE_MENU_MAIN_BACKDROP_RECT: SourceRect = { x: 42, y: 78, width: 717, height: 481 };
const CHALLENGE_MENU_BACK_RECT: SourceRect = { x: 576, y: 505, width: 172, height: 36 };
const CHALLENGE_MENU_PLAY_RECT: SourceRect = { x: 382, y: 505, width: 172, height: 36 };
const CHALLENGE_MENU_BIO_PARENT_RECT: SourceRect = { x: 199, y: 379, width: 548, height: 114 };
const CHALLENGE_MENU_BIO_TITLE_RECT: SourceRect = { x: 203, y: 383, width: 131, height: 23 };
const CHALLENGE_MENU_BIO_PORTRAIT_RECT: SourceRect = { x: 641, y: 386, width: 97, height: 100 };
const CHALLENGE_MENU_BIO_LABEL_LAYOUT = [
  { text: 'Name', rect: { x: 204, y: 405, width: 101, height: 18 } },
  { text: 'Rank', rect: { x: 204, y: 421, width: 92, height: 19 } },
  { text: 'Branch', rect: { x: 204, y: 437, width: 95, height: 18 } },
  { text: 'Strategy', rect: { x: 203, y: 453, width: 123, height: 20 } },
] as const satisfies ReadonlyArray<{ text: string; rect: SourceRect }>;
const CHALLENGE_MENU_BIO_ENTRY_LAYOUT = [
  { key: 'name', rect: { x: 321, y: 404, width: 243, height: 18 } },
  { key: 'rank', rect: { x: 321, y: 421, width: 244, height: 18 } },
  { key: 'branch', rect: { x: 321, y: 438, width: 312, height: 18 } },
  { key: 'strategy', rect: { x: 321, y: 455, width: 314, height: 18 } },
] as const satisfies ReadonlyArray<{ key: 'name' | 'rank' | 'branch' | 'strategy'; rect: SourceRect }>;
const CHALLENGE_MENU_GENERAL_LAYOUT = [
  { index: 0, rect: { x: 152, y: 198, width: 41, height: 41 } },
  { index: 1, rect: { x: 500, y: 222, width: 41, height: 41 } },
  { index: 2, rect: { x: 624, y: 198, width: 41, height: 41 } },
  { index: 3, rect: { x: 220, y: 159, width: 41, height: 41 } },
  { index: 4, rect: { x: 663, y: 218, width: 41, height: 41 } },
  { index: 5, rect: { x: 102, y: 186, width: 41, height: 41 } },
  { index: 6, rect: { x: 438, y: 206, width: 41, height: 41 } },
  { index: 7, rect: { x: 691, y: 183, width: 41, height: 41 } },
  { index: 8, rect: { x: 535, y: 189, width: 41, height: 41 } },
  { index: 9, rect: { x: 641, y: 176, width: 41, height: 41 } },
  { index: 10, rect: { x: 292, y: 199, width: 41, height: 41 } },
  { index: 11, rect: { x: 293, y: 228, width: 41, height: 41 } },
] as const satisfies ReadonlyArray<{ index: number; rect: SourceRect }>;
const CAMPAIGN_LOAD_BACKGROUND_RECT: SourceRect = { x: 0, y: 0, width: 799, height: 599 };
const CAMPAIGN_LOAD_CAMEO_FRAME_RECT: SourceRect = { x: 396, y: 32, width: 112, height: 172 };
const CAMPAIGN_LOAD_CAMEO_WINDOW_LAYOUT = [
  { key: 'unit0', rect: { x: 400, y: 40, width: 104, height: 72 } },
  { key: 'unit1', rect: { x: 516, y: 40, width: 104, height: 72 } },
  { key: 'unit2', rect: { x: 632, y: 40, width: 104, height: 73 } },
] as const satisfies ReadonlyArray<{ key: 'unit0' | 'unit1' | 'unit2'; rect: SourceRect }>;
const CAMPAIGN_LOAD_CAMEO_TEXT_LAYOUT = [
  { key: 'unit0', rect: { x: 441, y: 146, width: 98, height: 46 } },
  { key: 'unit1', rect: { x: 544, y: 146, width: 98, height: 46 } },
  { key: 'unit2', rect: { x: 647, y: 146, width: 99, height: 46 } },
] as const satisfies ReadonlyArray<{ key: 'unit0' | 'unit1' | 'unit2'; rect: SourceRect }>;
const CAMPAIGN_LOAD_LOCATION_RECT: SourceRect = { x: 92, y: 312, width: 167, height: 42 };
const CAMPAIGN_LOAD_HEAD_RECT: SourceRect = { x: 426, y: 209, width: 200, height: 150 };
const CAMPAIGN_LOAD_OBJECTIVES_RECT: SourceRect = { x: 255, y: 369, width: 513, height: 144 };
const CAMPAIGN_LOAD_OBJECTIVE_LINE_LAYOUT = [
  { index: 0, rect: { x: 255, y: 369, width: 513, height: 25 } },
  { index: 1, rect: { x: 255, y: 393, width: 513, height: 27 } },
  { index: 2, rect: { x: 255, y: 417, width: 513, height: 25 } },
  { index: 3, rect: { x: 255, y: 441, width: 513, height: 25 } },
  { index: 4, rect: { x: 255, y: 465, width: 513, height: 28 } },
] as const satisfies ReadonlyArray<{ index: number; rect: SourceRect }>;
const CAMPAIGN_LOAD_PROGRESS_RECT: SourceRect = { x: 140, y: 564, width: 519, height: 20 };
const CAMPAIGN_LOAD_PERCENT_RECT: SourceRect = { x: 760, y: 520, width: 40, height: 32 };
const CAMPAIGN_LOAD_BACK_ACTION_RECT: SourceRect = { x: 620, y: 552, width: 84, height: 28 };
const CAMPAIGN_LOAD_START_ACTION_RECT: SourceRect = { x: 710, y: 552, width: 84, height: 28 };

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

function formatSourceSizeStyle(width: number, height: number): string {
  return [
    `width:${formatSourcePercent(width, SHELL_SOURCE_RESOLUTION.width)}`,
    `height:${formatSourcePercent(height, SHELL_SOURCE_RESOLUTION.height)}`,
  ].join(';');
}

function renderRetailMenuButton(config: {
  action: string;
  label: string;
  rect: SourceRect;
  disabled?: boolean;
}): string {
  return `
    <button
      class="menu-button retail-main-menu-button retail-source-rect${config.disabled ? ' disabled' : ''}"
      data-action="${config.action}"
      data-source-rect="${formatSourceRectData(config.rect)}"
      style="${formatSourceRectStyle(config.rect)}"
      ${config.disabled ? 'disabled aria-disabled="true"' : ''}
    >
      <span class="retail-main-menu-button-slice retail-main-menu-button-slice-left" aria-hidden="true"></span>
      <span class="retail-main-menu-button-slice retail-main-menu-button-slice-middle" aria-hidden="true"></span>
      <span class="retail-main-menu-button-slice retail-main-menu-button-slice-right" aria-hidden="true"></span>
      <span class="retail-main-menu-button-label">${config.label}</span>
    </button>
  `;
}

function renderRetailMenuPanel(actionPanelRef: string, rect: SourceRect): string {
  return `
    <div
      class="main-menu-action-panel retail-source-rect"
      data-ref="${actionPanelRef}"
      data-source-rect="${formatSourceRectData(rect)}"
      style="${formatSourceRectStyle(rect)}"
    >
      <div class="main-menu-action-panel-map" data-ref="retail-menu-action-panel-map"></div>
      <div class="main-menu-frame-corner is-top-left" data-ref="retail-menu-frame-corner-ul"></div>
      <div class="main-menu-frame-corner is-top-right" data-ref="retail-menu-frame-corner-ur"></div>
      <div class="main-menu-frame-corner is-bottom-left" data-ref="retail-menu-frame-corner-ll"></div>
      <div class="main-menu-frame-corner is-bottom-right" data-ref="retail-menu-frame-corner-lr"></div>
    </div>
  `;
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
    background: #02050b;
  }
  .retail-main-menu-screen::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, rgba(0, 0, 0, 0.62) 0%, rgba(0, 0, 0, 0.12) 14%, rgba(0, 0, 0, 0.08) 86%, rgba(0, 0, 0, 0.7) 100%),
      linear-gradient(#a7865e, #a7865e) 0 0 / 100% 2px no-repeat,
      linear-gradient(#261e15, #261e15) 0 1px / 100% 2px no-repeat,
      linear-gradient(#a7865e, #a7865e) 0 10% / 100% 1px no-repeat,
      linear-gradient(#261e15, #261e15) 0 12% / 100% 1px no-repeat,
      linear-gradient(#a7865e, #a7865e) 0 90% / 100% 1px no-repeat,
      linear-gradient(#261e15, #261e15) 0 92% / 100% 1px no-repeat,
      linear-gradient(#a7865e, #a7865e) 0 100% / 100% 2px no-repeat,
      linear-gradient(#261e15, #261e15) 0 calc(100% - 1px) / 100% 2px no-repeat,
      linear-gradient(#a7865e, #a7865e) 22.5% 0 / 3px 100% no-repeat,
      linear-gradient(#a7865e, #a7865e) 44.5% 0 / 3px 100% no-repeat,
      linear-gradient(#a7865e, #a7865e) 66.62% 0 / 3px 100% no-repeat,
      linear-gradient(#a7865e, #a7865e) 88.5% 0 / 3px 100% no-repeat;
    z-index: 1;
    pointer-events: none;
  }
  .retail-source-rect {
    position: absolute;
    box-sizing: border-box;
  }
  .main-menu-preview-panel {
    z-index: 0;
    opacity: 0;
    pointer-events: none;
  }
  .main-menu-action-panel {
    z-index: 2;
    overflow: visible;
    border: 1px solid rgba(147, 161, 200, 0.45);
    background: rgba(2, 4, 9, 0.18);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.56);
  }
  .main-menu-action-panel-map {
    position: absolute;
    inset: 0 0 ${((RETAIL_MENU_ACTION_MAP_INSET_BOTTOM / MAIN_MENU_ACTION_PANEL_RECT.height) * 100).toFixed(6)}% 0;
    background-position: center;
    background-repeat: no-repeat;
    background-size: 100% 100%;
    box-shadow: inset 0 0 0 1px rgba(16, 20, 30, 0.48);
  }
  .main-menu-action-panel-map::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.08) 0%, rgba(0, 0, 0, 0.34) 100%);
  }
  .main-menu-frame-corner {
    position: absolute;
    width: 8.928571%;
    height: 7.936508%;
    background-position: center;
    background-repeat: no-repeat;
    background-size: 100% 100%;
    pointer-events: none;
    z-index: 3;
  }
  .main-menu-frame-corner.is-top-left {
    left: -4.464286%;
    top: -3.968254%;
  }
  .main-menu-frame-corner.is-top-right {
    right: -4.464286%;
    top: -3.968254%;
  }
  .main-menu-frame-corner.is-bottom-left {
    left: -4.464286%;
    bottom: -3.968254%;
  }
  .main-menu-frame-corner.is-bottom-right {
    right: -4.464286%;
    bottom: -3.968254%;
  }
  .main-menu-ruler {
    z-index: 2;
    pointer-events: none;
    opacity: 0.98;
  }
  .main-menu-pulse {
    z-index: 2;
    left: 0;
    top: 0;
    pointer-events: none;
    opacity: 0.94;
    mix-blend-mode: screen;
    animation: retail-main-menu-pulse 10s linear infinite;
  }
  .main-menu-logo {
    z-index: 2;
    pointer-events: none;
  }
  .main-menu-logo-art {
    position: absolute;
    inset: 0;
    background-position: right center;
    background-repeat: no-repeat;
    background-size: contain;
  }
  .retail-main-menu-screen .menu-button {
    margin: 0;
    padding: 0;
  }
  .retail-main-menu-button {
    --retail-button-left-image: var(--retail-button-left-enabled-image);
    --retail-button-middle-image: var(--retail-button-middle-enabled-image);
    --retail-button-right-image: var(--retail-button-right-enabled-image);
    z-index: 4;
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: #f5f7ff;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(0.92rem, 1.28vw, 1.22rem);
    text-transform: none;
    letter-spacing: 0.14em;
    text-shadow:
      0 1px 0 rgba(0, 0, 0, 0.92),
      0 2px 6px rgba(0, 0, 0, 0.5);
    overflow: visible;
  }
  .retail-main-menu-button:hover:not(:disabled),
  .retail-main-menu-button:focus-visible:not(:disabled) {
    --retail-button-left-image: var(--retail-button-left-hilite-image);
    --retail-button-middle-image: var(--retail-button-middle-hilite-image);
    --retail-button-right-image: var(--retail-button-right-hilite-image);
    color: #baff0c;
  }
  .retail-main-menu-button:active:not(:disabled) {
    --retail-button-left-image: var(--retail-button-left-pushed-image);
    --retail-button-middle-image: var(--retail-button-middle-pushed-image);
    --retail-button-right-image: var(--retail-button-right-pushed-image);
  }
  .retail-main-menu-button:disabled,
  .retail-main-menu-button.disabled {
    --retail-button-left-image: var(--retail-button-left-disabled-image);
    --retail-button-middle-image: var(--retail-button-middle-disabled-image);
    --retail-button-right-image: var(--retail-button-right-disabled-image);
    color: #4b5371;
    text-shadow: 0 1px 0 rgba(7, 11, 19, 0.92);
  }
  .retail-main-menu-button-slice {
    position: absolute;
    top: 0;
    bottom: 0;
    background-position: center;
    background-size: 100% 100%;
    pointer-events: none;
  }
  .retail-main-menu-button-slice-left {
    left: 0;
    width: var(--retail-button-left-width, 22.115385%);
    background-image: var(--retail-button-left-image);
  }
  .retail-main-menu-button-slice-middle {
    left: var(--retail-button-left-width, 22.115385%);
    right: var(--retail-button-right-width, 22.115385%);
    background-image: var(--retail-button-middle-image);
    background-repeat: repeat-x;
    background-size: auto 100%;
  }
  .retail-main-menu-button-slice-right {
    right: 0;
    width: var(--retail-button-right-width, 22.115385%);
    background-image: var(--retail-button-right-image);
  }
  .retail-main-menu-button-label {
    position: relative;
    z-index: 1;
    pointer-events: none;
  }
  .retail-main-menu-button:active:not(:disabled) .retail-main-menu-button-label {
    transform: translate(1px, 1px);
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
  .retail-backdrop-layer {
    position: absolute;
    inset: 0;
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;
    opacity: 0.96;
    pointer-events: none;
  }
  .retail-backdrop-layer::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(3, 5, 11, 0.2) 0%, rgba(3, 5, 11, 0.48) 100%);
  }
  .retail-source-image {
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;
  }
  .retail-source-image.contain {
    background-size: contain;
  }
  .retail-source-image.stretch {
    background-size: 100% 100%;
  }

  @keyframes retail-main-menu-pulse {
    0% {
      left: calc(-1 * ${formatSourcePercent(RETAIL_MENU_PULSE_SOURCE_SIZE.width, SHELL_SOURCE_RESOLUTION.width)});
      top: calc(-0.5 * ${formatSourcePercent(RETAIL_MENU_PULSE_SOURCE_SIZE.height, SHELL_SOURCE_RESOLUTION.height)});
    }
    49.999% {
      left: 100%;
      top: calc(-0.5 * ${formatSourcePercent(RETAIL_MENU_PULSE_SOURCE_SIZE.height, SHELL_SOURCE_RESOLUTION.height)});
    }
    50% {
      left: 100%;
      top: calc(100% - (0.5 * ${formatSourcePercent(RETAIL_MENU_PULSE_SOURCE_SIZE.height, SHELL_SOURCE_RESOLUTION.height)}));
    }
    100% {
      left: calc(-1 * ${formatSourcePercent(RETAIL_MENU_PULSE_SOURCE_SIZE.width, SHELL_SOURCE_RESOLUTION.width)});
      top: calc(100% - (0.5 * ${formatSourcePercent(RETAIL_MENU_PULSE_SOURCE_SIZE.height, SHELL_SOURCE_RESOLUTION.height)}));
    }
  }

  .retail-challenge-screen {
    display: block;
    overflow: hidden;
    background:
      radial-gradient(circle at 40% 38%, rgba(52, 92, 158, 0.18) 0%, rgba(9, 20, 42, 0.08) 30%, rgba(0, 0, 0, 0) 70%),
      linear-gradient(180deg, #08111f 0%, #03060e 100%);
  }
  .retail-challenge-frame {
    z-index: 2;
    border: 1px solid rgba(214, 220, 235, 0.9);
    box-shadow: inset 0 0 0 1px rgba(5, 9, 15, 0.92);
  }
  .retail-challenge-main-backdrop {
    z-index: 1;
    border: 1px solid rgba(62, 78, 116, 0.88);
    background:
      linear-gradient(180deg, rgba(6, 11, 21, 0.7) 0%, rgba(3, 5, 10, 0.84) 100%);
  }
  .retail-challenge-general {
    z-index: 3;
    border: 0;
    background-color: transparent;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.45));
  }
  .retail-challenge-general::after {
    content: '';
    position: absolute;
    inset: 18%;
    border-radius: 50%;
    background: transparent;
    box-shadow: inset 0 0 0 1px rgba(235, 242, 255, 0.06);
  }
  .retail-challenge-general.is-fallback {
    border-radius: 50%;
    border: 1px solid rgba(222, 230, 255, 0.85);
    background:
      radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.05) 24%, rgba(0, 0, 0, 0) 30%),
      linear-gradient(180deg, rgba(59, 86, 145, 0.92) 0%, rgba(16, 26, 59, 0.98) 100%);
  }
  .retail-challenge-general.is-hilite {
    filter: drop-shadow(0 0 12px rgba(186, 255, 12, 0.4));
  }
  .retail-challenge-general.is-selected {
    filter: drop-shadow(0 0 12px rgba(255, 166, 56, 0.38));
  }
  .retail-challenge-button {
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(118, 142, 196, 0.88);
    background:
      linear-gradient(180deg, rgba(36, 53, 112, 0.95) 0%, rgba(11, 17, 40, 0.98) 100%);
    box-shadow: inset 0 0 0 1px rgba(4, 8, 14, 0.86);
    color: #f3f5ff;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(0.86rem, 1.06vw, 1rem);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .retail-challenge-button.hidden {
    display: none;
  }
  .retail-challenge-button:hover {
    color: #cbff63;
  }
  .retail-challenge-bio {
    z-index: 4;
    border: 1px solid rgba(217, 223, 238, 0.92);
    background: rgba(1, 8, 41, 0.68);
    box-shadow:
      inset 0 0 0 1px rgba(5, 10, 20, 0.9),
      0 0 18px rgba(0, 0, 0, 0.28);
  }
  .retail-challenge-bio.hidden {
    display: none;
  }
  .retail-challenge-bio-title,
  .retail-challenge-bio-label,
  .retail-challenge-bio-entry {
    z-index: 5;
    display: flex;
    align-items: center;
    color: #f4f6ff;
    font-family: Arial, Helvetica, sans-serif;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .retail-challenge-bio-title {
    font-size: clamp(0.9rem, 1.05vw, 1rem);
    font-weight: 700;
  }
  .retail-challenge-bio-label {
    font-size: clamp(0.74rem, 0.9vw, 0.85rem);
    font-weight: 700;
  }
  .retail-challenge-bio-entry {
    font-size: clamp(0.72rem, 0.88vw, 0.82rem);
    font-weight: 500;
  }
  .retail-challenge-portrait {
    z-index: 5;
    border: 1px solid rgba(224, 230, 243, 0.88);
    background:
      linear-gradient(180deg, rgba(0, 0, 0, 0.78) 0%, rgba(9, 18, 30, 0.92) 100%);
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;
    overflow: hidden;
  }

  .retail-load-screen {
    display: block;
    overflow: hidden;
    background:
      linear-gradient(180deg, #06101d 0%, #04070d 100%);
  }
  .retail-load-frame,
  .retail-load-head,
  .retail-load-cameo-frame,
  .retail-load-cameo,
  .retail-load-objectives,
  .retail-load-progress,
  .retail-load-percent,
  .retail-load-location,
  .retail-load-unit-text,
  .retail-load-objective-line,
  .retail-load-action {
    z-index: 3;
  }
  .retail-load-cameo-frame {
    border: 1px solid rgba(207, 213, 223, 0.95);
    background: rgba(0, 0, 0, 0.2);
  }
  .retail-load-cameo {
    border: 1px solid rgba(0, 0, 0, 0.9);
    background:
      linear-gradient(180deg, rgba(46, 7, 7, 0.8) 0%, rgba(17, 2, 2, 0.9) 100%);
  }
  .retail-load-head {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    border: 1px solid rgba(199, 208, 222, 0.88);
    background:
      linear-gradient(180deg, rgba(9, 16, 31, 0.78) 0%, rgba(3, 6, 12, 0.92) 100%);
    color: #f2f5ff;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(1.1rem, 1.7vw, 1.5rem);
    line-height: 1.2;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.56);
  }
  .retail-load-location,
  .retail-load-unit-text,
  .retail-load-objective-line,
  .retail-load-percent {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 0.45rem;
    color: #f2f4f9;
    font-family: Arial, Helvetica, sans-serif;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.56);
    text-align: center;
    overflow: hidden;
  }
  .retail-load-location {
    justify-content: flex-start;
    color: #dfe6ff;
    font-size: clamp(0.86rem, 1.02vw, 0.98rem);
    font-weight: 700;
    text-transform: uppercase;
  }
  .retail-load-unit-text {
    font-size: clamp(0.7rem, 0.86vw, 0.8rem);
    line-height: 1.2;
  }
  .retail-load-objectives {
    border: 1px solid rgba(0, 0, 0, 0);
    background: transparent;
  }
  .retail-load-objective-line {
    justify-content: flex-start;
    padding: 0 0.75rem;
    color: #e8edf9;
    font-size: clamp(0.82rem, 0.95vw, 0.94rem);
    line-height: 1.18;
    text-align: left;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .retail-load-progress {
    border: 1px solid rgba(141, 151, 176, 0.88);
    background:
      linear-gradient(180deg, rgba(16, 24, 47, 0.92) 0%, rgba(4, 6, 14, 0.98) 100%);
    overflow: hidden;
  }
  .retail-load-progress::before {
    content: '';
    position: absolute;
    inset: 2px;
    background:
      linear-gradient(90deg, rgba(60, 93, 201, 0.88) 0%, rgba(111, 162, 255, 0.96) 50%, rgba(60, 93, 201, 0.88) 100%);
    opacity: 0.76;
  }
  .retail-load-percent {
    justify-content: center;
    color: rgba(255, 255, 255, 0.86);
    font-size: clamp(0.7rem, 0.82vw, 0.76rem);
    font-weight: 700;
  }
  .retail-load-action {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(99, 122, 184, 0.92);
    background:
      linear-gradient(180deg, rgba(28, 42, 91, 0.94) 0%, rgba(11, 16, 37, 0.98) 100%);
    box-shadow: inset 0 0 0 1px rgba(4, 7, 14, 0.86);
    color: #f5f6fa;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(0.74rem, 0.88vw, 0.84rem);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .retail-load-action:hover {
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
  private pendingSinglePlayerMode: 'CAMPAIGN' | 'CHALLENGE' = 'CAMPAIGN';
  private currentScreen: ShellScreen | null = null;
  private challengeSelectionCommitted = false;
  private hoveredChallengeIndex: number | null = null;
  private mappedImageResolver: ShellMappedImageResolver | null = null;
  private imageRequestSerial = 0;

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

  setMappedImageResolver(resolver: ShellMappedImageResolver | null): void {
    this.mappedImageResolver = resolver;
    this.refreshRetailArtwork();
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
    this.currentScreen = null;
    this.hoveredChallengeIndex = null;
    this.challengeSelectionCommitted = false;
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
    const previousScreen = this.currentScreen;
    for (const [name, el] of this.screenEls) {
      el.classList.toggle('hidden', name !== screen);
    }
    // Refresh dynamic content on screen show
    if (screen === 'campaign-briefing') {
      this.updateBriefingContent();
    } else if (screen === 'challenge-select') {
      if (previousScreen !== 'challenge-select') {
        this.challengeSelectionCommitted = false;
        this.hoveredChallengeIndex = null;
      }
      this.updateChallengeSelectContent();
    }
    this.currentScreen = screen;
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

  private resolveChallengeBioLine(
    persona: GeneralPersona,
    line: 'name' | 'rank' | 'branch' | 'strategy',
  ): string {
    switch (line) {
      case 'name':
        return this.resolveChallengeName(persona);
      case 'rank':
        return persona.bioRankLabel ? this.resolveText(persona.bioRankLabel) : persona.faction;
      case 'branch':
        return persona.bioBranchLabel ? this.resolveText(persona.bioBranchLabel) : persona.playerTemplateName;
      case 'strategy':
        return persona.bioStrategyLabel ? this.resolveText(persona.bioStrategyLabel) : '';
      default:
        return '';
    }
  }

  private getChallengePersonaByIndex(index: number): GeneralPersona | null {
    return this.challengePersonas.find((persona) => persona.index === index) ?? null;
  }

  private getChallengePreviewPersona(): GeneralPersona | null {
    if (this.hoveredChallengeIndex !== null) {
      return this.getChallengePersonaByIndex(this.hoveredChallengeIndex);
    }
    if (this.challengeSelectionCommitted) {
      return this.getChallengePersonaByIndex(this.selectedChallengeIndex);
    }
    return null;
  }

  private getMappedImageDimensions(imageName: string | undefined): { width: number; height: number } | null {
    if (!imageName) {
      return null;
    }
    const entry = this.mappedImageResolver?.getEntry?.(imageName);
    if (!entry) {
      return null;
    }
    return {
      width: entry.right - entry.left + 1,
      height: entry.bottom - entry.top + 1,
    };
  }

  private applyMappedImageCssVariable(
    element: HTMLElement | null,
    propertyName: string,
    imageName: string | undefined,
  ): void {
    if (!element) {
      return;
    }

    if (!imageName || !this.mappedImageResolver) {
      if (!imageName) {
        element.style.removeProperty(propertyName);
      }
      return;
    }

    void this.mappedImageResolver.resolve(imageName).then((url) => {
      if (!url) {
        element.style.removeProperty(propertyName);
        return;
      }
      element.style.setProperty(propertyName, `url("${url}")`);
    }).catch(() => {
      element.style.removeProperty(propertyName);
    });
  }

  private applyRetailButtonSkin(button: HTMLElement | null): void {
    if (!button) {
      return;
    }

    const sourceWidth = Number(button.dataset.sourceRect?.split(',')[2] ?? '208') || 208;
    const leftWidth = this.getMappedImageDimensions(RETAIL_MENU_BUTTON_SKINS.enabled.left)?.width ?? 46;
    const rightWidth = this.getMappedImageDimensions(RETAIL_MENU_BUTTON_SKINS.enabled.right)?.width ?? 46;

    button.style.setProperty('--retail-button-left-width', `${((leftWidth / sourceWidth) * 100).toFixed(6)}%`);
    button.style.setProperty('--retail-button-right-width', `${((rightWidth / sourceWidth) * 100).toFixed(6)}%`);

    for (const [stateName, skin] of Object.entries(RETAIL_MENU_BUTTON_SKINS)) {
      this.applyMappedImageCssVariable(button, `--retail-button-left-${stateName}-image`, skin.left);
      this.applyMappedImageCssVariable(button, `--retail-button-middle-${stateName}-image`, skin.middle);
      this.applyMappedImageCssVariable(button, `--retail-button-right-${stateName}-image`, skin.right);
    }
  }

  private refreshRetailMenuScreenArt(
    screenName: 'main-menu' | 'single-player',
    backdropRef: 'main-menu-backdrop' | 'single-player-backdrop',
  ): void {
    const screen = this.screenEls.get(screenName);
    if (!screen) {
      return;
    }

    this.applyMappedImageBackground(
      screen.querySelector<HTMLElement>(`[data-ref="${backdropRef}"]`),
      MAIN_MENU_BACKDROP_IMAGE,
    );
    this.applyMappedImageBackground(
      screen.querySelector<HTMLElement>('[data-ref="retail-menu-ruler"]'),
      MAIN_MENU_RULER_IMAGE,
      'stretch',
    );
    this.applyMappedImageBackground(
      screen.querySelector<HTMLElement>('[data-ref="retail-menu-pulse"]'),
      MAIN_MENU_PULSE_IMAGE,
      'stretch',
    );
    this.applyMappedImageBackground(
      screen.querySelector<HTMLElement>('[data-ref="retail-menu-action-panel-map"]'),
      MAIN_MENU_ACTION_MAP_IMAGE,
      'stretch',
    );
    this.applyMappedImageBackground(
      screen.querySelector<HTMLElement>('[data-ref="retail-menu-logo-art"]'),
      MAIN_MENU_LOGO_IMAGE,
      'contain',
    );
    this.applyMappedImageBackground(
      screen.querySelector<HTMLElement>('[data-ref="retail-menu-frame-corner-ul"]'),
      RETAIL_MENU_FRAME_CORNERS.ul,
      'stretch',
    );
    this.applyMappedImageBackground(
      screen.querySelector<HTMLElement>('[data-ref="retail-menu-frame-corner-ur"]'),
      RETAIL_MENU_FRAME_CORNERS.ur,
      'stretch',
    );
    this.applyMappedImageBackground(
      screen.querySelector<HTMLElement>('[data-ref="retail-menu-frame-corner-ll"]'),
      RETAIL_MENU_FRAME_CORNERS.ll,
      'stretch',
    );
    this.applyMappedImageBackground(
      screen.querySelector<HTMLElement>('[data-ref="retail-menu-frame-corner-lr"]'),
      RETAIL_MENU_FRAME_CORNERS.lr,
      'stretch',
    );

    for (const button of screen.querySelectorAll<HTMLElement>('.retail-main-menu-button')) {
      this.applyRetailButtonSkin(button);
    }
  }

  private applyMappedImageBackground(
    element: HTMLElement | null,
    imageName: string | undefined,
    sizeMode: 'cover' | 'contain' | 'stretch' = 'cover',
  ): void {
    if (!element) {
      return;
    }

    element.classList.add('retail-source-image');
    element.classList.toggle('contain', sizeMode === 'contain');
    element.classList.toggle('stretch', sizeMode === 'stretch');

    if (!imageName || !this.mappedImageResolver) {
      if (!imageName) {
        element.style.backgroundImage = '';
      }
      return;
    }

    const requestId = String(++this.imageRequestSerial);
    element.dataset.imageRequestId = requestId;
    void this.mappedImageResolver.resolve(imageName).then((url) => {
      if (!url || element.dataset.imageRequestId !== requestId) {
        return;
      }
      element.style.backgroundImage = `url("${url}")`;
    }).catch(() => {
      if (element.dataset.imageRequestId === requestId) {
        element.style.backgroundImage = '';
      }
    });
  }

  private refreshRetailArtwork(): void {
    this.refreshRetailMenuScreenArt('main-menu', 'main-menu-backdrop');
    this.refreshRetailMenuScreenArt('single-player', 'single-player-backdrop');
    this.applyMappedImageBackground(
      this.screenEls.get('challenge-select')?.querySelector('[data-ref="challenge-menu-background"]') as HTMLElement | null,
      CHALLENGE_MENU_BACKGROUND_IMAGE,
    );
    this.updateChallengeSelectContent();
    this.updateBriefingContent();
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

    const buttonsHtml = MAIN_MENU_BUTTON_LAYOUT.map((button) => renderRetailMenuButton(button)).join('');

    el.innerHTML = `
      <div class="retail-backdrop-layer" data-ref="main-menu-backdrop"></div>
      <div
        class="main-menu-ruler retail-source-rect"
        data-ref="retail-menu-ruler"
        style="${formatSourceRectStyle(FULL_SCREEN_SOURCE_RECT)}"
      ></div>
      <div
        class="main-menu-pulse"
        data-ref="retail-menu-pulse"
        style="${formatSourceSizeStyle(RETAIL_MENU_PULSE_SOURCE_SIZE.width, RETAIL_MENU_PULSE_SOURCE_SIZE.height)}"
      ></div>
      <div
        class="main-menu-preview-panel retail-source-rect"
        data-ref="main-menu-preview"
        data-source-rect="${formatSourceRectData(MAIN_MENU_PREVIEW_RECT)}"
        style="${formatSourceRectStyle(MAIN_MENU_PREVIEW_RECT)}"
      ></div>
      ${renderRetailMenuPanel('main-menu-action-panel', MAIN_MENU_ACTION_PANEL_RECT)}
      <div
        class="main-menu-logo retail-source-rect"
        data-ref="main-menu-logo"
        data-source-rect="${formatSourceRectData(MAIN_MENU_LOGO_RECT)}"
        style="${formatSourceRectStyle(MAIN_MENU_LOGO_RECT)}"
      ><div class="main-menu-logo-art" data-ref="retail-menu-logo-art"></div></div>
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
    this.refreshRetailArtwork();
  }

  // ──── Private: Single Player Menu ───────────────────────────────────────

  private renderSinglePlayerMenu(): void {
    if (this.screenEls.has('single-player')) return;

    const el = document.createElement('div');
    el.className = 'shell-screen hidden retail-main-menu-screen';
    el.id = 'single-player-screen';

    const buttonsHtml = SINGLE_PLAYER_BUTTON_LAYOUT.map((button) => renderRetailMenuButton(button)).join('');

    el.innerHTML = `
      <div class="retail-backdrop-layer" data-ref="single-player-backdrop"></div>
      <div
        class="main-menu-ruler retail-source-rect"
        data-ref="retail-menu-ruler"
        style="${formatSourceRectStyle(FULL_SCREEN_SOURCE_RECT)}"
      ></div>
      <div
        class="main-menu-pulse"
        data-ref="retail-menu-pulse"
        style="${formatSourceSizeStyle(RETAIL_MENU_PULSE_SOURCE_SIZE.width, RETAIL_MENU_PULSE_SOURCE_SIZE.height)}"
      ></div>
      <div
        class="main-menu-preview-panel retail-source-rect"
        data-ref="single-player-preview"
        data-source-rect="${formatSourceRectData(MAIN_MENU_PREVIEW_RECT)}"
        style="${formatSourceRectStyle(MAIN_MENU_PREVIEW_RECT)}"
      ></div>
      ${renderRetailMenuPanel('single-player-action-panel', SINGLE_PLAYER_ACTION_PANEL_RECT)}
      <div
        class="main-menu-logo retail-source-rect"
        data-ref="single-player-logo"
        data-source-rect="${formatSourceRectData(MAIN_MENU_LOGO_RECT)}"
        style="${formatSourceRectStyle(MAIN_MENU_LOGO_RECT)}"
      ><div class="main-menu-logo-art" data-ref="retail-menu-logo-art"></div></div>
      ${buttonsHtml}
    `;

    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'campaign-usa') {
        this.selectedCampaignFaction = 'usa';
        this.pendingSinglePlayerMode = 'CAMPAIGN';
        this.showScreen('campaign-difficulty');
      } else if (action === 'campaign-gla') {
        this.selectedCampaignFaction = 'gla';
        this.pendingSinglePlayerMode = 'CAMPAIGN';
        this.showScreen('campaign-difficulty');
      } else if (action === 'campaign-china') {
        this.selectedCampaignFaction = 'china';
        this.pendingSinglePlayerMode = 'CAMPAIGN';
        this.showScreen('campaign-difficulty');
      } else if (action === 'skirmish') {
        this.showScreen('skirmish-setup');
      } else if (action === 'challenge') {
        this.pendingSinglePlayerMode = 'CHALLENGE';
        this.showScreen('campaign-difficulty');
      } else if (action === 'back') {
        this.showScreen('main-menu');
      }
    });

    this.addScreen('single-player', el);
    this.refreshRetailArtwork();
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
        if (this.pendingSinglePlayerMode === 'CHALLENGE') {
          this.showScreen('challenge-select');
        } else {
          this.showScreen('campaign-briefing');
        }
      }
    });

    this.addScreen('campaign-difficulty', el);
  }

  // ──── Private: Campaign Briefing ────────────────────────────────────────

  private renderCampaignBriefing(): void {
    if (this.screenEls.has('campaign-briefing')) return;

    const el = document.createElement('div');
    el.className = 'shell-screen hidden retail-load-screen';
    el.id = 'campaign-briefing-screen';

    el.innerHTML = `
      <div
        class="retail-backdrop-layer retail-source-rect"
        data-ref="campaign-load-background"
        data-source-rect="${formatSourceRectData(CAMPAIGN_LOAD_BACKGROUND_RECT)}"
        style="${formatSourceRectStyle(CAMPAIGN_LOAD_BACKGROUND_RECT)}"
      ></div>
      <div
        class="retail-load-cameo-frame retail-source-rect"
        data-ref="campaign-load-cameo-frame"
        data-source-rect="${formatSourceRectData(CAMPAIGN_LOAD_CAMEO_FRAME_RECT)}"
        style="${formatSourceRectStyle(CAMPAIGN_LOAD_CAMEO_FRAME_RECT)}"
      ></div>
      ${CAMPAIGN_LOAD_CAMEO_WINDOW_LAYOUT.map((window) => `
        <div
          class="retail-load-cameo retail-source-rect"
          data-ref="campaign-load-${window.key}"
          data-source-rect="${formatSourceRectData(window.rect)}"
          style="${formatSourceRectStyle(window.rect)}"
        ></div>
      `).join('')}
      ${CAMPAIGN_LOAD_CAMEO_TEXT_LAYOUT.map((entry) => `
        <div
          class="retail-load-unit-text retail-source-rect"
          data-ref="campaign-load-${entry.key}-text"
          data-source-rect="${formatSourceRectData(entry.rect)}"
          style="${formatSourceRectStyle(entry.rect)}"
        ></div>
      `).join('')}
      <div
        class="retail-load-head retail-source-rect"
        data-ref="campaign-load-head"
        data-source-rect="${formatSourceRectData(CAMPAIGN_LOAD_HEAD_RECT)}"
        style="${formatSourceRectStyle(CAMPAIGN_LOAD_HEAD_RECT)}"
      ></div>
      <div
        class="retail-load-location retail-source-rect"
        data-ref="campaign-load-location"
        data-source-rect="${formatSourceRectData(CAMPAIGN_LOAD_LOCATION_RECT)}"
        style="${formatSourceRectStyle(CAMPAIGN_LOAD_LOCATION_RECT)}"
      ></div>
      <div
        class="retail-load-objectives retail-source-rect"
        data-ref="campaign-load-objectives"
        data-source-rect="${formatSourceRectData(CAMPAIGN_LOAD_OBJECTIVES_RECT)}"
        style="${formatSourceRectStyle(CAMPAIGN_LOAD_OBJECTIVES_RECT)}"
      ></div>
      ${CAMPAIGN_LOAD_OBJECTIVE_LINE_LAYOUT.map((line) => `
        <div
          class="retail-load-objective-line retail-source-rect"
          data-ref="campaign-load-line-${line.index}"
          data-source-rect="${formatSourceRectData(line.rect)}"
          style="${formatSourceRectStyle(line.rect)}"
        ></div>
      `).join('')}
      <button
        class="retail-load-progress retail-source-rect"
        data-action="start"
        data-ref="campaign-load-progress"
        data-source-rect="${formatSourceRectData(CAMPAIGN_LOAD_PROGRESS_RECT)}"
        style="${formatSourceRectStyle(CAMPAIGN_LOAD_PROGRESS_RECT)}"
      ></button>
      <div
        class="retail-load-percent retail-source-rect"
        data-ref="campaign-load-percent"
        data-source-rect="${formatSourceRectData(CAMPAIGN_LOAD_PERCENT_RECT)}"
        style="${formatSourceRectStyle(CAMPAIGN_LOAD_PERCENT_RECT)}"
      >100%</div>
      <button
        class="retail-load-action retail-source-rect"
        data-action="back"
        data-ref="campaign-load-back"
        style="${formatSourceRectStyle(CAMPAIGN_LOAD_BACK_ACTION_RECT)}"
      >Back</button>
      <button
        class="retail-load-action retail-source-rect"
        data-action="start"
        data-ref="campaign-load-start"
        style="${formatSourceRectStyle(CAMPAIGN_LOAD_START_ACTION_RECT)}"
      >Start</button>
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
    const campaign = this.campaigns.find(c => c.name === this.selectedCampaignFaction);
    if (!campaign || campaign.missions.length === 0) {
      const headEl = briefingEl.querySelector<HTMLElement>('[data-ref="campaign-load-head"]');
      if (headEl) {
        headEl.textContent = 'Mission Data Unavailable';
      }
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
    const headEl = briefingEl.querySelector<HTMLElement>('[data-ref="campaign-load-head"]');
    const locationEl = briefingEl.querySelector<HTMLElement>('[data-ref="campaign-load-location"]');
    const percentEl = briefingEl.querySelector<HTMLElement>('[data-ref="campaign-load-percent"]');

    if (headEl) {
      headEl.textContent = generalName || factionLabel;
    }
    if (locationEl) {
      locationEl.textContent = locationLabel || factionLabel;
    }
    if (percentEl) {
      percentEl.textContent = '100%';
    }

    for (const entry of CAMPAIGN_LOAD_CAMEO_TEXT_LAYOUT) {
      const cameoTextEl = briefingEl.querySelector<HTMLElement>(`[data-ref="campaign-load-${entry.key}-text"]`);
      if (cameoTextEl) {
        const unitIndex = Number(entry.key.replace('unit', ''));
        cameoTextEl.textContent = unitNames[unitIndex] ?? '';
      }
    }

    for (const line of CAMPAIGN_LOAD_OBJECTIVE_LINE_LAYOUT) {
      const lineEl = briefingEl.querySelector<HTMLElement>(`[data-ref="campaign-load-line-${line.index}"]`);
      if (lineEl) {
        lineEl.textContent = objectiveLines[line.index] ?? '';
      }
    }

    const backgroundImage = CAMPAIGN_LOAD_BACKGROUND_BY_CAMPAIGN[campaign.name];
    this.applyMappedImageBackground(
      briefingEl.querySelector<HTMLElement>('[data-ref="campaign-load-background"]'),
      backgroundImage,
    );
  }

  // ──── Private: Challenge Select ─────────────────────────────────────────

  private renderChallengeSelect(): void {
    if (this.screenEls.has('challenge-select')) return;

    const el = document.createElement('div');
    el.className = 'shell-screen hidden retail-challenge-screen';
    el.id = 'challenge-select-screen';

    const generalButtonsHtml = CHALLENGE_MENU_GENERAL_LAYOUT.map((entry) => {
      const persona = this.getChallengePersonaByIndex(entry.index);
      if (!persona) {
        return '';
      }

      return `
        <button
          class="retail-challenge-general retail-source-rect"
          data-ref="challenge-general-${entry.index}"
          data-challenge="${entry.index}"
          data-source-rect="${formatSourceRectData(entry.rect)}"
          style="${formatSourceRectStyle(entry.rect)}"
          aria-label="${esc(this.resolveChallengeName(persona))}"
        ></button>
      `;
    }).join('');

    el.innerHTML = `
      <div
        class="retail-backdrop-layer retail-source-rect"
        data-ref="challenge-menu-background"
        data-source-rect="${formatSourceRectData(CHALLENGE_MENU_BACKGROUND_RECT)}"
        style="${formatSourceRectStyle(CHALLENGE_MENU_BACKGROUND_RECT)}"
      ></div>
      <div
        class="retail-challenge-frame retail-source-rect"
        data-ref="challenge-menu-frame"
        data-source-rect="${formatSourceRectData(CHALLENGE_MENU_FRAME_RECT)}"
        style="${formatSourceRectStyle(CHALLENGE_MENU_FRAME_RECT)}"
      ></div>
      <div
        class="retail-challenge-main-backdrop retail-source-rect"
        data-ref="challenge-menu-main-backdrop"
        data-source-rect="${formatSourceRectData(CHALLENGE_MENU_MAIN_BACKDROP_RECT)}"
        style="${formatSourceRectStyle(CHALLENGE_MENU_MAIN_BACKDROP_RECT)}"
      ></div>
      <button
        class="retail-challenge-button retail-source-rect"
        data-action="back"
        data-ref="challenge-menu-back"
        data-source-rect="${formatSourceRectData(CHALLENGE_MENU_BACK_RECT)}"
        style="${formatSourceRectStyle(CHALLENGE_MENU_BACK_RECT)}"
      >Back</button>
      <button
        class="retail-challenge-button retail-source-rect hidden"
        data-action="start"
        data-ref="challenge-menu-start"
        data-source-rect="${formatSourceRectData(CHALLENGE_MENU_PLAY_RECT)}"
        style="${formatSourceRectStyle(CHALLENGE_MENU_PLAY_RECT)}"
      >Start</button>
      ${generalButtonsHtml}
      <div
        class="retail-challenge-bio retail-source-rect hidden"
        data-ref="challenge-bio-panel"
        data-source-rect="${formatSourceRectData(CHALLENGE_MENU_BIO_PARENT_RECT)}"
        style="${formatSourceRectStyle(CHALLENGE_MENU_BIO_PARENT_RECT)}"
      ></div>
      <div
        class="retail-challenge-bio-title retail-source-rect hidden"
        data-ref="challenge-bio-title"
        data-source-rect="${formatSourceRectData(CHALLENGE_MENU_BIO_TITLE_RECT)}"
        style="${formatSourceRectStyle(CHALLENGE_MENU_BIO_TITLE_RECT)}"
      >Biography</div>
      <div
        class="retail-challenge-portrait retail-source-rect hidden"
        data-ref="challenge-bio-portrait"
        data-source-rect="${formatSourceRectData(CHALLENGE_MENU_BIO_PORTRAIT_RECT)}"
        style="${formatSourceRectStyle(CHALLENGE_MENU_BIO_PORTRAIT_RECT)}"
      ></div>
      ${CHALLENGE_MENU_BIO_LABEL_LAYOUT.map((entry) => `
        <div
          class="retail-challenge-bio-label retail-source-rect hidden"
          data-ref="challenge-bio-label-${entry.text.toLowerCase()}"
          data-source-rect="${formatSourceRectData(entry.rect)}"
          style="${formatSourceRectStyle(entry.rect)}"
        >${entry.text}</div>
      `).join('')}
      ${CHALLENGE_MENU_BIO_ENTRY_LAYOUT.map((entry) => `
        <div
          class="retail-challenge-bio-entry retail-source-rect hidden"
          data-ref="challenge-bio-${entry.key}"
          data-source-rect="${formatSourceRectData(entry.rect)}"
          style="${formatSourceRectStyle(entry.rect)}"
        ></div>
      `).join('')}
    `;

    el.addEventListener('mouseover', (e) => {
      const target = (e.target as HTMLElement).closest('[data-challenge]') as HTMLElement | null;
      if (!target) return;
      this.hoveredChallengeIndex = Number(target.dataset.challenge);
      this.updateChallengeSelectContent();
    });

    el.addEventListener('mouseout', (e) => {
      const target = (e.target as HTMLElement).closest('[data-challenge]') as HTMLElement | null;
      if (!target) return;
      const related = e.relatedTarget;
      if (related instanceof Node && target.contains(related)) {
        return;
      }
      const targetIndex = Number(target.dataset.challenge);
      if (this.hoveredChallengeIndex === targetIndex) {
        this.hoveredChallengeIndex = null;
        this.updateChallengeSelectContent();
      }
    });

    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action], [data-challenge]') as HTMLElement | null;
      if (!target) return;

      if (target.dataset.challenge !== undefined) {
        this.selectedChallengeIndex = Number(target.dataset.challenge);
        this.challengeSelectionCommitted = true;
        this.hoveredChallengeIndex = this.selectedChallengeIndex;
        this.updateChallengeSelectContent();
        return;
      }

      if (target.dataset.action === 'back') {
        this.showScreen('single-player');
      } else if (target.dataset.action === 'start') {
        const general = this.challengeSelectionCommitted
          ? this.getChallengePersonaByIndex(this.selectedChallengeIndex)
          : null;
        if (general) {
          this.handleStartCampaign(general.campaignName, this.selectedDifficulty, 'CHALLENGE');
        }
      }
    });

    this.addScreen('challenge-select', el);
    this.refreshRetailArtwork();
    this.updateChallengeSelectContent();
  }

  private updateChallengeSelectContent(): void {
    const challengeEl = this.screenEls.get('challenge-select');
    if (!challengeEl) {
      return;
    }

    const previewPersona = this.getChallengePreviewPersona();
    const playButton = challengeEl.querySelector<HTMLElement>('[data-ref="challenge-menu-start"]');
    if (playButton) {
      playButton.classList.toggle('hidden', !this.challengeSelectionCommitted);
    }

    for (const buttonEl of challengeEl.querySelectorAll<HTMLElement>('[data-challenge]')) {
      const buttonIndex = Number(buttonEl.dataset.challenge);
      const persona = this.getChallengePersonaByIndex(buttonIndex);
      if (!persona) {
        buttonEl.style.display = 'none';
        continue;
      }

      const isSelected = this.challengeSelectionCommitted && buttonIndex === this.selectedChallengeIndex;
      const isHilite = this.hoveredChallengeIndex === buttonIndex && !isSelected;
      buttonEl.classList.toggle('is-selected', isSelected);
      buttonEl.classList.toggle('is-hilite', isHilite);

      const imageName = isSelected
        ? (persona.medallionSelectName ?? persona.medallionRegularName)
        : (isHilite ? (persona.medallionHiliteName ?? persona.medallionRegularName) : persona.medallionRegularName);
      this.applyMappedImageBackground(buttonEl, imageName, 'contain');
      const hasMappedImage = Boolean(imageName && this.getMappedImageDimensions(imageName));
      buttonEl.classList.toggle('is-fallback', !hasMappedImage);
      buttonEl.style.backgroundColor = hasMappedImage ? 'transparent' : (CHALLENGE_GENERAL_COLORS[buttonIndex] ?? '#51658e');
    }

    const bioElements = [
      challengeEl.querySelector<HTMLElement>('[data-ref="challenge-bio-panel"]'),
      challengeEl.querySelector<HTMLElement>('[data-ref="challenge-bio-title"]'),
      challengeEl.querySelector<HTMLElement>('[data-ref="challenge-bio-portrait"]'),
      ...CHALLENGE_MENU_BIO_LABEL_LAYOUT.map((entry) =>
        challengeEl.querySelector<HTMLElement>(`[data-ref="challenge-bio-label-${entry.text.toLowerCase()}"]`),
      ),
      ...CHALLENGE_MENU_BIO_ENTRY_LAYOUT.map((entry) =>
        challengeEl.querySelector<HTMLElement>(`[data-ref="challenge-bio-${entry.key}"]`),
      ),
    ];
    for (const element of bioElements) {
      element?.classList.toggle('hidden', !previewPersona);
    }

    if (!previewPersona) {
      return;
    }

    const portraitEl = challengeEl.querySelector<HTMLElement>('[data-ref="challenge-bio-portrait"]');
    this.applyMappedImageBackground(
      portraitEl,
      previewPersona.bioPortraitSmallName || previewPersona.generalImageName,
    );

    for (const entry of CHALLENGE_MENU_BIO_ENTRY_LAYOUT) {
      const textEl = challengeEl.querySelector<HTMLElement>(`[data-ref="challenge-bio-${entry.key}"]`);
      if (textEl) {
        textEl.textContent = this.resolveChallengeBioLine(previewPersona, entry.key);
      }
    }
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
